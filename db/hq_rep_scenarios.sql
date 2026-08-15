-- TRU Rep — Day 1 lab scenarios and attempts.
-- Additive. Expected records live in this table for the Worker only (service role).
-- Do not select expected from the browser.

create table if not exists rep_scenarios (
  id         text primary key,
  title      text not null,
  kind       text not null default 'repair',
  active     boolean not null default true,
  facts      jsonb not null default '{}'::jsonb,
  expected   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists rep_lab_attempts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references orgs(id) on delete cascade,
  agent_id    uuid references agents(id) on delete cascade,
  user_id     uuid,
  scenario_id text not null references rep_scenarios(id),
  phase       text not null,
  passed      boolean not null,
  critical    boolean not null default false,
  checks      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists rep_lab_attempts_agent_idx on rep_lab_attempts (agent_id, created_at desc);
create index if not exists rep_lab_attempts_scenario_idx on rep_lab_attempts (scenario_id, created_at desc);

alter table rep_scenarios enable row level security;
alter table rep_lab_attempts enable row level security;

-- Browser may read learner-visible facts only. expected is not in this view.
drop view if exists rep_scenarios_public;
create view rep_scenarios_public as
  select id, title, kind, active, facts
  from rep_scenarios
  where active = true;

drop policy if exists rep_scenarios_read on rep_scenarios;
create policy rep_scenarios_read on rep_scenarios for select to authenticated
  using (false);

drop policy if exists rep_lab_attempts_org_read on rep_lab_attempts;
create policy rep_lab_attempts_org_read on rep_lab_attempts for select to authenticated
  using (org_id is not null and is_org_member(org_id));

drop policy if exists rep_lab_attempts_self on rep_lab_attempts;
create policy rep_lab_attempts_self on rep_lab_attempts for select to authenticated
  using (agent_id in (select id from agents where auth_id = auth.uid()));

drop policy if exists rep_lab_attempts_user_self on rep_lab_attempts;
create policy rep_lab_attempts_user_self on rep_lab_attempts for select to authenticated
  using (user_id = auth.uid());

insert into rep_scenarios (id, title, kind, facts, expected) values
(
  'priya-repair',
  'Priya Shah — repair a finished-looking record',
  'repair',
  '{
    "contact": "Priya Shah",
    "source": "Zillow property inquiry",
    "property": "406 Juniper Ln, Puyallup, WA",
    "activity": ["viewed 406 Juniper Ln 4 times", "saved 422 Juniper Ln", "viewed 510 Pinecrest Ct"],
    "starting": {
      "stage": "Appointment set",
      "note": "Talked. Interested. Follow up later.",
      "task": null
    }
  }'::jsonb,
  '{
    "stage": "Spoke with customer",
    "risks": ["wrong_stage", "weak_note", "missing_task", "ignored_activity"],
    "taskTitleNeedles": ["comparison", "juniper", "priya"]
  }'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  facts = excluded.facts,
  expected = excluded.expected,
  active = true;

insert into rep_scenarios (id, title, kind, facts, expected) values
(
  'elena-homework',
  'Elena Brooks — complete the record',
  'closer',
  '{
    "contact": "Elena Brooks",
    "source": "Zillow property inquiry",
    "property": "908 Alder Creek Rd, Olympia, WA",
    "method": "Phone after 4:30 PM",
    "activity": ["viewed 908 Alder Creek Rd twice", "saved 908", "viewed 875 Alder Creek Rd once"],
    "outcome": "Reached at 4:46 PM. Buying with her sister. Wants Olympia or Lacey, 3+ bedrooms, before November. No appointment. Asked for a side-by-side of the two Alder Creek homes by Monday morning."
  }'::jsonb,
  '{
    "stage": "Spoke with customer",
    "pass": 8,
    "max": 10
  }'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  facts = excluded.facts,
  expected = excluded.expected,
  active = true;

notify pgrst, 'reload schema';
