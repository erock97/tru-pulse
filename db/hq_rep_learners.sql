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

create unique index if not exists rep_progress_learner_module_uk
  on rep_progress (learner_id, module_id) where learner_id is not null;

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

notify pgrst, 'reload schema';
