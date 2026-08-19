-- Agent experience — auth-keyed agent home, self-report on commitments, and the
-- onboarding state behind the assessment gate.
--
-- Idempotent + additive. Safe to run more than once. Depends on schema.sql
-- (agents), hq_coach.sql (assessments), hq_coach_1on1_structured.sql
-- (checkin_items), hq_rep_agent.sql (claim_agent).
--
-- Everything here is keyed on auth.uid(). The agent-facing surface that predates
-- this file is keyed on a `token` UUID that travels in a URL; that surface is
-- retired in the "one front door" section at the bottom of this migration.
--
-- NEVER read checkin_leader from anything in this file. That contract is stated
-- permanently at db/hq_coach_1on1_structured.sql:52-56 and the agent-visibility
-- promise in the design spec depends on it holding forever.

-- ── 1. Columns ────────────────────────────────────────────────────────────────

-- The agent's own self-report on a commitment, kept deliberately distinct from
-- checkin_items.status, which is the LEADER's review verdict at the next 1:1.
-- One must never overwrite the other: "I did it" and "your lead agrees you did
-- it" are different claims, and collapsing them would let the agent grade
-- themselves in the leader's column.
alter table checkin_items add column if not exists agent_done boolean not null default false;

-- Onboarding state. `gated` is set true only when a FIRST invite is minted from
-- the cutover forward, so every row that exists today stays false and nobody
-- already using the product is ever sent through the new assessment gate.
alter table agents add column if not exists welcome_seen_at timestamptz;
alter table agents add column if not exists gated           boolean not null default false;

-- ── 2. The agent's own home ──────────────────────────────────────────────────
-- Replaces get_agent_home(p_token). Keyed on the auth link, reads checkin_items
-- (the structured 1:1 record) rather than the legacy commitments table.
create or replace function agent_home()
returns json language sql security definer set search_path = public as $$
  with me as (select id, name, welcome_seen_at, gated from agents where auth_id = auth.uid() limit 1)
  select json_build_object(
    'agent',           (select json_build_object('id', m.id, 'name', m.name) from me m),
    'welcome_seen_at', (select m.welcome_seen_at from me m),
    'gated',           (select coalesce(m.gated, false) from me m),
    'assessment', (
      select json_build_object('code', s.code, 'personal_code', a.personal_code,
                               'taken_at', s.taken_at)
        from assessments s
        join agents a on a.id = s.agent_id
       where a.id = (select m.id from me m)
       order by s.taken_at desc
       limit 1),
    'commitments', (
      -- Open commitments only. Once the lead has reviewed one at the next 1:1
      -- (status set), it belongs to history, not to what to do today.
      select coalesce(json_agg(json_build_object(
               'id', i.id, 'body', i.body, 'agent_done', i.agent_done,
               'status', i.status, 'created_at', i.created_at)
             order by i.position, i.created_at), '[]'::json)
        from checkin_items i
       where i.agent_id = (select m.id from me m)
         and i.kind = 'commitment'
         and i.status is null),
    'latest_checkin', (
      select max(k.created_at) from checkins k where k.agent_id = (select m.id from me m))
  );
$$;
-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` inherits it.
-- A `grant ... to authenticated` alone therefore leaves the function anon-callable.
-- auth.uid() is null for anon so nothing leaks, but the whole point of this work is
-- that no agent surface is reachable without a session — so say it explicitly.
revoke execute on function agent_home() from public, anon;
grant  execute on function agent_home() to authenticated;

-- ── 3. Agent writes — one validated RPC each, never raw table access ──────────

create or replace function agent_set_commitment_done(p_item_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update checkin_items i set agent_done = p_done
   where i.id = p_item_id
     and i.kind = 'commitment'
     and i.agent_id = (select id from agents where auth_id = auth.uid());
  if not found then raise exception 'not your commitment'; end if;
end $$;
revoke execute on function agent_set_commitment_done(uuid, boolean) from public, anon;
grant  execute on function agent_set_commitment_done(uuid, boolean) to authenticated;

create or replace function agent_mark_welcome_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  update agents set welcome_seen_at = now()
   where auth_id = auth.uid() and welcome_seen_at is null;
end $$;
revoke execute on function agent_mark_welcome_seen() from public, anon;
grant  execute on function agent_mark_welcome_seen() to authenticated;

-- The in-account twin of submit_cohort_assessment. Keyed on the auth link, so it
-- needs no join token — and deliberately does NOT require coaching_enabled: a
-- freshly invited agent is not in a cohort yet and must still be able to clear
-- the gate that stands between them and the rest of the product.
create or replace function submit_my_assessment(
  p_personal_code text, p_personal_axes jsonb,
  p_business_code text, p_tallies jsonb, p_answers jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_team uuid; v_org uuid;
begin
  select id, team_id, org_id into v_agent, v_team, v_org
    from agents where auth_id = auth.uid();
  if v_agent is null then raise exception 'not an agent'; end if;

  update agents set personal_code = p_personal_code, personal_axes = p_personal_axes
   where id = v_agent;

  insert into assessments (
    org_id, team_id, agent_id, code, answers,
    energy_p, energy_t, approach_pro, approach_rec,
    deal_r, deal_v, decision_d, decision_i
  ) values (
    v_org, v_team, v_agent, p_business_code, p_answers,
    (p_tallies->>'energy_p')::int,     (p_tallies->>'energy_t')::int,
    (p_tallies->>'approach_pro')::int, (p_tallies->>'approach_rec')::int,
    (p_tallies->>'deal_r')::int,       (p_tallies->>'deal_v')::int,
    (p_tallies->>'decision_d')::int,   (p_tallies->>'decision_i')::int
  );
  return json_build_object('ok', true);
end $$;
revoke execute on function submit_my_assessment(text, jsonb, text, jsonb, jsonb) from public, anon;
grant  execute on function submit_my_assessment(text, jsonb, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ── 4. One front door ─────────────────────────────────────────────────────────
-- Three ways into this product existed: the invite, self-serve signup at the end
-- of the public assessment, and a legacy token portal reachable with no login at
-- all. Only the invite survives.

-- claim_agent() binds an agents row to whoever signs in with a matching email.
-- With self-serve signup gone from the assessment, the remaining signup path is
-- the org-owner one on the login screen — so require a CONFIRMED address before
-- handing over someone's coaching record.
--
-- Deliberately checks auth.users.email_confirmed_at rather than a JWT claim: the
-- claim's shape and location have moved between GoTrue versions, and a guard that
-- silently stops matching is worse than no guard. This function is SECURITY
-- DEFINER, so it can read auth.users directly and ask the authoritative question.
create or replace function claim_agent()
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if not exists (
    select 1 from auth.users u
     where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    -- Unconfirmed: never bind a NEW row. An already-linked agent still gets their id.
    return (select id from agents where auth_id = auth.uid() limit 1);
  end if;

  update agents
     set auth_id = auth.uid()
   where auth_id is null
     and email is not null
     and lower(email) = lower(auth.jwt() ->> 'email')
  returning id into aid;

  if aid is null then
    select id into aid from agents where auth_id = auth.uid() limit 1;
  end if;
  return aid;
end $$;
revoke execute on function claim_agent() from public, anon;
grant  execute on function claim_agent() to authenticated;

-- The old token-URL agent portal. Nothing in the app calls these; each one is an
-- anon-reachable read or write keyed on a UUID that travels in a URL.
revoke execute on function get_agent_home(uuid)                                     from public, anon, authenticated;
revoke execute on function agent_toggle_commitment(uuid, uuid, boolean)             from public, anon, authenticated;
revoke execute on function agent_save_checkin(uuid, text, int, int, text, text)     from public, anon, authenticated;
revoke execute on function enroll_agent(uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
