-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — the Live Sim: practice-call attempts + ALMS grades
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse SQL Editor. Additive + idempotent.
create table if not exists rep_practice (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references orgs(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  scenario    text not null,                          -- persona key
  call_id     text,                                   -- Retell call id
  status      text not null default 'started',        -- started | graded | failed
  score       int,
  passed      boolean,
  breakdown   jsonb,                                  -- ALMS scores, flags, coach note
  transcript  text,
  duration_s  int,
  created_at  timestamptz not null default now(),
  graded_at   timestamptz
);
create index if not exists rep_practice_agent_idx on rep_practice (agent_id, created_at desc);
create index if not exists rep_practice_org_idx on rep_practice (org_id);

alter table rep_practice enable row level security;

-- Leaders (org members) read their org's attempts; writes come from the Worker.
drop policy if exists rep_practice_org_read on rep_practice;
create policy rep_practice_org_read on rep_practice for select to authenticated
  using (is_org_member(org_id));

-- An agent reads their own attempts (scores/history in the course).
drop policy if exists rep_practice_agent_self on rep_practice;
create policy rep_practice_agent_self on rep_practice for select to authenticated
  using (agent_id in (select id from agents where auth_id = auth.uid()));

notify pgrst, 'reload schema';
