-- SMS consent — the record that makes texting a team member lawful, and the
-- switches that let them stop it.
--
-- Idempotent + additive. Safe to run more than once. Depends on schema.sql
-- (agents) and hq_agent_experience.sql (agent_home, the auth_id link).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE IS FOR
--
-- A2P 10DLC campaign review, and later a TCPA complaint, both ask the same
-- question: prove this person agreed. Not "we had their number" — agreed, on a
-- date, to a specific sentence, by their own action. A boolean column cannot
-- answer that, so the answer lives in an append-only ledger and the boolean is
-- derived from it.
--
-- Three rules this file exists to enforce, in order of how expensive they are to
-- get wrong:
--
--   1. Consent is never inferred. Importing a number from Follow Up Boss, or
--      from anywhere else, is not consent and must never write an opt-in row.
--      The only writer of an 'opt_in' row is the agent's own session.
--   2. Opt-out is absolute and immediate, and works by PHONE NUMBER rather than
--      by account — someone who texts STOP may not be signed in, may have left
--      the team, or may have been given a recycled number. sms_opt_out_by_phone
--      exists for exactly that and stops every row holding that number.
--   3. Nothing is ever deleted from the ledger. An opt-out is a new row, not an
--      edit. The trigger below makes that structural rather than a promise.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The ledger ────────────────────────────────────────────────────────────

create table if not exists sms_consent_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references orgs(id)  on delete set null,
  team_id      uuid references teams(id) on delete set null,
  -- Nullable on purpose: a STOP can arrive from a number we cannot match to an
  -- agent, and that event still has to be recorded and honoured.
  agent_id     uuid references agents(id) on delete set null,
  phone_e164   text not null,
  action       text not null check (action in ('opt_in', 'opt_out', 'declined')),
  -- The exact sentence shown, copied from shared/smsConsent.ts by the Worker.
  -- Never taken from the browser: a client that supplies its own consent text can
  -- claim agreement to words it never displayed.
  consent_text text,
  consent_version text,
  source       text not null check (source in ('web_form', 'sms_reply', 'admin', 'system')),
  ip           inet,
  user_agent   text,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists sms_consent_agent_idx on sms_consent_events (agent_id, created_at desc);
create index if not exists sms_consent_phone_idx on sms_consent_events (phone_e164, created_at desc);

-- Append-only, structurally. Without this the table is one careless UPDATE away
-- from being worthless as evidence, and the carelessness would leave no trace.
create or replace function sms_consent_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'sms_consent_events is append-only (attempted %). Record a new event instead of changing an old one.', tg_op;
end $$;

drop trigger if exists sms_consent_events_no_change on sms_consent_events;
create trigger sms_consent_events_no_change
  before update or delete on sms_consent_events
  for each row execute function sms_consent_events_immutable();

-- RLS on with no policies at all: nothing reaches this table except the
-- SECURITY DEFINER functions below and the service role. An agent does not need
-- to read the raw ledger, and no other tenant may ever see it.
alter table sms_consent_events enable row level security;
revoke all on sms_consent_events from anon, authenticated;

-- ── 2. Current state on the agent row ────────────────────────────────────────
-- Derived from the ledger, kept alongside it so the send path is one cheap read
-- instead of a window function over history on every message.

alter table agents add column if not exists sms_phone           text;
alter table agents add column if not exists sms_consent_at      timestamptz;
alter table agents add column if not exists sms_consent_text    text;
alter table agents add column if not exists sms_consent_version text;
alter table agents add column if not exists sms_opt_out_at      timestamptz;
-- Stamped when we have asked, whatever the answer. Keeps the onboarding step from
-- reappearing forever in front of someone who has already said no — a consent
-- prompt you cannot get past is not consent, it is coercion.
alter table agents add column if not exists sms_prompted_at     timestamptz;

-- The one definition of "may we text this person". Mirrors isSmsReachable() in
-- shared/smsConsent.ts; if you change one, change both.
--
-- Takes three scalars rather than an `agents` row on purpose. A row-typed argument
-- reads better but cannot be called with a CTE row — `select * from agents` in a
-- WITH clause is a `record`, not an `agents`, and the call fails at runtime with
-- "function does not exist". Scalars work from every call site.
create or replace function sms_reachable(
  p_phone text, p_consent_at timestamptz, p_opt_out_at timestamptz
) returns boolean language sql immutable as $$
  select p_phone is not null
     and p_consent_at is not null
     and (p_opt_out_at is null or p_opt_out_at < p_consent_at);
$$;
-- Pure arithmetic over its arguments, but nothing outside this file has a reason
-- to call it. The SECURITY DEFINER functions below still can: they execute as the
-- owner, who is not affected by this revoke.
revoke execute on function sms_reachable(text, timestamptz, timestamptz) from public, anon;

-- ── 3. The agent's own switches ──────────────────────────────────────────────
-- One validated RPC each, keyed on auth.uid(). There is no path by which an
-- agent turns SMS on for anybody but themselves.

create or replace function agent_sms_opt_in(
  p_phone text, p_consent_text text, p_consent_version text,
  p_ip text default null, p_user_agent text default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_team uuid; v_org uuid; v_ip inet;
begin
  if p_phone is null or p_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' then
    raise exception 'phone must be a valid US number in E.164';
  end if;
  if coalesce(p_consent_text, '') = '' then
    raise exception 'consent text is required';
  end if;

  select id, team_id, org_id into v_agent, v_team, v_org
    from agents where auth_id = auth.uid();
  if v_agent is null then raise exception 'not an agent'; end if;

  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;

  -- Ledger first. If the second statement fails we would rather hold a consent
  -- we are not acting on than act on one we cannot prove.
  insert into sms_consent_events (
    org_id, team_id, agent_id, phone_e164, action,
    consent_text, consent_version, source, ip, user_agent)
  values (
    v_org, v_team, v_agent, p_phone, 'opt_in',
    p_consent_text, p_consent_version, 'web_form', v_ip, left(p_user_agent, 500));

  update agents set
    sms_phone           = p_phone,
    sms_consent_at      = now(),
    sms_consent_text    = p_consent_text,
    sms_consent_version = p_consent_version,
    sms_opt_out_at      = null,   -- a fresh, deliberate opt-in clears the old stop
    sms_prompted_at     = coalesce(sms_prompted_at, now())
  where id = v_agent;

  return json_build_object('ok', true, 'phone', p_phone);
end $$;
revoke execute on function agent_sms_opt_in(text, text, text, text, text) from public, anon;
grant  execute on function agent_sms_opt_in(text, text, text, text, text) to authenticated;

create or replace function agent_sms_opt_out()
returns json language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_team uuid; v_org uuid; v_phone text;
begin
  select id, team_id, org_id, sms_phone into v_agent, v_team, v_org, v_phone
    from agents where auth_id = auth.uid();
  if v_agent is null then raise exception 'not an agent'; end if;

  insert into sms_consent_events (
    org_id, team_id, agent_id, phone_e164, action, source)
  values (
    v_org, v_team, v_agent, coalesce(v_phone, 'unknown'), 'opt_out', 'web_form');

  -- The number stays on the row deliberately. Blanking it would lose the link
  -- between this person and the number we must NOT text, which is precisely the
  -- fact an opt-out exists to record.
  update agents set sms_opt_out_at = now() where id = v_agent;
  return json_build_object('ok', true);
end $$;
revoke execute on function agent_sms_opt_out() from public, anon;
grant  execute on function agent_sms_opt_out() to authenticated;

-- "Not now." Stamps that we asked so onboarding moves on, and records the refusal
-- so the ledger shows we took no for an answer.
create or replace function agent_sms_decline()
returns json language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_team uuid; v_org uuid;
begin
  select id, team_id, org_id into v_agent, v_team, v_org
    from agents where auth_id = auth.uid();
  if v_agent is null then raise exception 'not an agent'; end if;

  if (select sms_prompted_at from agents where id = v_agent) is null then
    insert into sms_consent_events (org_id, team_id, agent_id, phone_e164, action, source)
    values (v_org, v_team, v_agent, 'none', 'declined', 'web_form');
  end if;

  update agents set sms_prompted_at = coalesce(sms_prompted_at, now()) where id = v_agent;
  return json_build_object('ok', true);
end $$;
revoke execute on function agent_sms_decline() from public, anon;
grant  execute on function agent_sms_decline() to authenticated;

-- ── 4. agent_home(), with the SMS block ──────────────────────────────────────
-- Supersedes the definition in db/hq_agent_experience.sql. Kept whole rather than
-- patched so there is one readable current version; if you edit agent_home in the
-- older file, edit it here too or your change will be overwritten on next run.

create or replace function agent_home()
returns json language sql security definer set search_path = public as $$
  with me as (
    select * from agents where auth_id = auth.uid() limit 1
  )
  select json_build_object(
    'agent',           (select json_build_object('id', m.id, 'name', m.name) from me m),
    'welcome_seen_at', (select m.welcome_seen_at from me m),
    'gated',           (select coalesce(m.gated, false) from me m),
    'sms', (select json_build_object(
              -- Never the whole number: this screen gets shown in team meetings.
              'last_four',   right(coalesce(m.sms_phone, ''), 4),
              'has_phone',   m.sms_phone is not null,
              'consent_at',  m.sms_consent_at,
              'opt_out_at',  m.sms_opt_out_at,
              'prompted_at', m.sms_prompted_at,
              'reachable',   sms_reachable(m.sms_phone, m.sms_consent_at, m.sms_opt_out_at)
            ) from me m),
    'assessment', (
      select json_build_object('code', s.code, 'personal_code', a.personal_code,
                               'taken_at', s.taken_at)
        from assessments s
        join agents a on a.id = s.agent_id
       where a.id = (select m.id from me m)
       order by s.taken_at desc
       limit 1),
    'commitments', (
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
revoke execute on function agent_home() from public, anon;
grant  execute on function agent_home() to authenticated;

-- ── 5. The send path, and the stop that has to work from outside ─────────────

-- The ONLY supported way to get numbers to text. It returns consented agents and
-- nobody else, so a caller cannot accidentally message a team roster.
create or replace function sms_recipients(p_team_id uuid)
returns table (agent_id uuid, name text, phone_e164 text)
language sql security definer set search_path = public as $$
  select a.id, a.name, a.sms_phone
    from agents a
   where a.team_id = p_team_id
     and sms_reachable(a.sms_phone, a.sms_consent_at, a.sms_opt_out_at);
$$;
revoke execute on function sms_recipients(uuid) from public, anon, authenticated;
grant  execute on function sms_recipients(uuid) to service_role;

-- STOP, arriving over SMS from someone we may not be able to identify.
-- Stops the number everywhere it appears, records one ledger row per match, and
-- records the event even when it matches nobody — an unmatched STOP is still a
-- suppression we must honour if that number ever turns up again.
create or replace function sms_opt_out_by_phone(p_phone text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_hits int;
begin
  insert into sms_consent_events (org_id, team_id, agent_id, phone_e164, action, source, note)
  select a.org_id, a.team_id, a.id, p_phone, 'opt_out', 'sms_reply', p_note
    from agents a where a.sms_phone = p_phone;
  get diagnostics v_hits = row_count;

  if v_hits = 0 then
    insert into sms_consent_events (phone_e164, action, source, note)
    values (p_phone, 'opt_out', 'sms_reply', coalesce(p_note, 'no matching agent'));
  end if;

  update agents set sms_opt_out_at = now() where sms_phone = p_phone;
  return json_build_object('ok', true, 'agents_stopped', v_hits);
end $$;
revoke execute on function sms_opt_out_by_phone(text, text) from public, anon, authenticated;
grant  execute on function sms_opt_out_by_phone(text, text) to service_role;

-- Belt and braces for the send path: ask this before every single message, even
-- when the list came from sms_recipients. Lists go stale between building one and
-- sending it, and the window is exactly where a post-STOP message slips through.
create or replace function sms_may_text(p_phone text)
returns boolean language sql security definer set search_path = public as $$
  select exists (
       select 1 from agents a
        where a.sms_phone = p_phone
          and sms_reachable(a.sms_phone, a.sms_consent_at, a.sms_opt_out_at))
     and not exists (
       -- Any opt-out for this number that is newer than the newest opt-in, from
       -- ANY source, including one that never matched an agent row.
       select 1 from sms_consent_events e
        where e.phone_e164 = p_phone and e.action = 'opt_out'
          and e.created_at > coalesce(
                (select max(i.created_at) from sms_consent_events i
                  where i.phone_e164 = p_phone and i.action = 'opt_in'),
                '-infinity'::timestamptz));
$$;
revoke execute on function sms_may_text(text) from public, anon, authenticated;
grant  execute on function sms_may_text(text) to service_role;

notify pgrst, 'reload schema';
