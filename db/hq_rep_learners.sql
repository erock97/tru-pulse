-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — the learner spine: one identity for agents AND org members
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor via the Supabase MCP connector.
-- Additive + idempotent.
--
-- WHY: rep_progress.agent_id references agents(id). A team leader is a
-- memberships row, not an agent, so a leader can watch the course but can never
-- complete a module. rep_learners unifies both kinds so progress, assignments,
-- sim attempts and certificates all key on ONE id.

create table if not exists rep_learners (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  kind       text not null,                                   -- 'agent' | 'member'
  agent_id   uuid references agents(id) on delete cascade,    -- set when kind='agent'
  user_id    uuid references auth.users(id) on delete cascade,-- set when kind='member'
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rep_learners_kind_check') then
    alter table rep_learners add constraint rep_learners_kind_check
      check (kind in ('agent','member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rep_learners_one_ref_check') then
    alter table rep_learners add constraint rep_learners_one_ref_check
      check ((kind = 'agent'  and agent_id is not null and user_id is null)
          or (kind = 'member' and user_id  is not null and agent_id is null));
  end if;
end $$;

-- Partial uniques: one learner row per agent, one per (org, user).
create unique index if not exists rep_learners_agent_uk  on rep_learners (agent_id) where agent_id is not null;
create unique index if not exists rep_learners_member_uk on rep_learners (org_id, user_id) where user_id is not null;
create index        if not exists rep_learners_org_idx   on rep_learners (org_id);

-- ── Backfill: every existing agent becomes a learner ─────────────────────────
insert into rep_learners (org_id, kind, agent_id, name, email)
select a.org_id, 'agent', a.id, a.name, a.email
  from agents a
 where a.org_id is not null
   and not exists (select 1 from rep_learners l where l.agent_id = a.id);

-- ── rep_progress migration: add learner_id, relax agent_id ───────────────────
-- agent_id stays (nullable, dual-written) for ONE release so the existing leader
-- roster in Rep.tsx keeps rendering while the UI moves over. Dropping it is a
-- separate, later migration.
alter table rep_progress add column if not exists learner_id uuid references rep_learners(id) on delete cascade;
alter table rep_progress alter column agent_id drop not null;

update rep_progress p
   set learner_id = l.id
  from rep_learners l
 where l.agent_id = p.agent_id
   and p.learner_id is null;

-- NOT partial. PostgREST's on_conflict=learner_id,module_id emits a bare
-- ON CONFLICT (learner_id, module_id); Postgres can only infer a PARTIAL index
-- when the statement repeats its WHERE clause, so a partial index here would
-- make every /rep/grade upsert fail. Postgres treats NULLs as distinct, so
-- legacy rows with a null learner_id still never collide.
create unique index if not exists rep_progress_learner_module_uk
  on rep_progress (learner_id, module_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table rep_learners enable row level security;

-- An org member (leader) sees their org's learners; a learner sees their own row.
drop policy if exists rep_learners_org_read on rep_learners;
create policy rep_learners_org_read on rep_learners for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_learners_self_read on rep_learners;
create policy rep_learners_self_read on rep_learners for select to authenticated
  using (user_id = auth.uid()
      or agent_id in (select id from agents where auth_id = auth.uid()));

-- rep_progress: the existing agent self-read policy only matches agent_id. Add
-- the learner_id equivalent so a MEMBER learner can read their own progress.
drop policy if exists rep_progress_learner_self on rep_progress;
create policy rep_progress_learner_self on rep_progress for select to authenticated
  using (learner_id in (
    select id from rep_learners
     where user_id = auth.uid()
        or agent_id in (select id from agents where auth_id = auth.uid())));

-- ── rep_ensure_learner() ─────────────────────────────────────────────────────
-- The /data/* routes read AS THE USER and never hold the service-role key
-- (worker/src/asUser.ts), but a first-time learner has no rep_learners row yet
-- and there is deliberately no client INSERT policy on the table. This is the
-- one sanctioned way to create it: SECURITY DEFINER, keyed strictly on
-- auth.uid(), so a caller can only ever mint their OWN learner row.
--
-- Mirrors worker/src/repLearner.ts exactly, including agent-identity-wins.
create or replace function rep_ensure_learner(p_org uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_agent record;
  v_org   uuid;
  v_row   rep_learners;
  v_name  text;
  v_email text;
begin
  if v_uid is null then return null; end if;

  -- ── Agent path ─────────────────────────────────────────────────────────────
  select a.id, a.org_id, a.name, a.email into v_agent
    from agents a where a.auth_id = v_uid and a.org_id is not null limit 1;

  if found then
    select * into v_row from rep_learners where agent_id = v_agent.id limit 1;
    if not found then
      insert into rep_learners (org_id, kind, agent_id, name, email)
      values (v_agent.org_id, 'agent', v_agent.id, v_agent.name, v_agent.email)
      returning * into v_row;
    end if;
    return jsonb_build_object(
      'id', v_row.id, 'org_id', v_row.org_id, 'kind', v_row.kind, 'agent_id', v_row.agent_id);
  end if;

  -- ── Member path ────────────────────────────────────────────────────────────
  -- Ordered so a multi-org leader with no hint lands on the same org every call.
  select m.org_id into v_org
    from memberships m
   where m.user_id = v_uid and (p_org is null or m.org_id = p_org)
   order by m.org_id limit 1;
  if v_org is null then
    select m.org_id into v_org
      from memberships m where m.user_id = v_uid order by m.org_id limit 1;
  end if;
  if v_org is null then return null; end if;

  select * into v_row from rep_learners
   where user_id = v_uid and org_id = v_org limit 1;
  if not found then
    select l.name, l.email into v_name, v_email from leaders l where l.id = v_uid limit 1;
    insert into rep_learners (org_id, kind, user_id, name, email)
    values (v_org, 'member', v_uid, coalesce(v_name, v_email, 'Team leader'), v_email)
    returning * into v_row;
  end if;
  return jsonb_build_object(
    'id', v_row.id, 'org_id', v_row.org_id, 'kind', v_row.kind, 'agent_id', v_row.agent_id);
end $$;

-- Supabase's default privileges re-grant EXECUTE to anon and authenticated when
-- the function is created, so the revoke has to come AFTER the grant and name
-- anon explicitly. The function is keyed on auth.uid() and returns null for a
-- signed-out caller either way, but a definer function should not be reachable
-- by anon at all.
revoke all on function rep_ensure_learner(uuid) from public;
grant execute on function rep_ensure_learner(uuid) to authenticated;
revoke execute on function rep_ensure_learner(uuid) from anon;

notify pgrst, 'reload schema';
