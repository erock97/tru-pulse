-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — agent onboarding & certification (Phase A schema + starter curriculum)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
-- Modules with org_id = NULL are the shared TRU curriculum (every team sees them);
-- a team can later add its own (org_id set). Progress is per shared agent.

create table if not exists rep_modules (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references orgs(id) on delete cascade,   -- NULL = global TRU curriculum
  idx        int  not null default 0,                      -- display order
  title      text not null,
  summary    text,
  body       text,                                         -- lesson content (markdown-ish)
  archetype  text,                                         -- NULL = all agents; or a TRU code prefix
  pass_pct   int  not null default 80,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rep_modules_org_idx on rep_modules (org_id, idx);

create table if not exists rep_questions (
  id        uuid primary key default gen_random_uuid(),
  module_id uuid not null references rep_modules(id) on delete cascade,
  idx       int  not null default 0,
  prompt    text not null,
  choices   jsonb not null,        -- ["...","...","..."]
  answer    int  not null,         -- index of the correct choice
  explain   text
);
create index if not exists rep_questions_mod_idx on rep_questions (module_id, idx);

create table if not exists rep_progress (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references orgs(id) on delete cascade,
  agent_id      uuid not null references agents(id) on delete cascade,
  module_id     uuid not null references rep_modules(id) on delete cascade,
  status        text not null default 'not_started',   -- not_started | in_progress | passed
  score         int,
  attempts      int  not null default 0,
  passed_at     timestamptz,
  signed_off_by text,
  signed_off_at timestamptz,
  updated_at    timestamptz not null default now(),
  unique (agent_id, module_id)
);
create index if not exists rep_progress_org_idx on rep_progress (org_id);
create index if not exists rep_progress_agent_idx on rep_progress (agent_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table rep_modules   enable row level security;
alter table rep_questions enable row level security;
alter table rep_progress  enable row level security;

-- Modules: global (org_id null) readable by anyone signed in or via agent token (anon);
-- org-specific readable by that org's members.
drop policy if exists rep_modules_read on rep_modules;
create policy rep_modules_read on rep_modules for select to anon, authenticated
  using (org_id is null or is_org_member(org_id));
-- Questions inherit their module's visibility.
drop policy if exists rep_questions_read on rep_questions;
create policy rep_questions_read on rep_questions for select to anon, authenticated
  using (exists (select 1 from rep_modules m where m.id = module_id and (m.org_id is null or is_org_member(m.org_id))));
-- Progress: an org member (leader) manages their org's rows; agent writes go via RPC.
drop policy if exists rep_progress_org on rep_progress;
create policy rep_progress_org on rep_progress for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ── Starter TRU curriculum (global; edit/replace anytime) ────────────────────
insert into rep_modules (id, org_id, idx, title, summary, body, pass_pct) values
 ('a1111111-1111-1111-1111-111111111111', null, 1, 'The TRU Way: Speed to Lead',
  'Why the first five minutes decide the deal.',
  'A paid lead is a stopwatch, not a to-do. Contact within 5 minutes and you are up to 100x more likely to connect; wait 30 and the odds fall off a cliff. On a Zillow live-connect, answer and stay on — that call may never log in the CRM, so the connection IS the proof of work. The job on the first touch is not to qualify or pitch — it is to be human, fast, and set the next step. Miss the window and you have paid for a lead you will fight uphill to ever reach.', 80),
 ('a2222222-2222-2222-2222-222222222222', null, 2, 'The ALMS Call Framework',
  'Appointment, Location, Motivation, Summarize — the whole call.',
  'ALMS is the spine of every first call. APPOINTMENT: the only goal is the next meeting — get it on the calendar. LOCATION: where are they looking / do they own now — anchor the search. MOTIVATION: why now, what changes for them — the real driver. SUMMARIZE: play it back so they feel heard and the next step is locked. What ALMS is NOT: do not prequalify finances, do not ask if they already have an agent, do not interrogate. Warmth + these four beats, and you book the appointment.', 80),
 ('a3333333-3333-3333-3333-333333333333', null, 3, 'Working a Paid Lead End to End',
  'From new lead to worked — what "worked" actually means.',
  'A lead counts as WORKED when it gets real effort: one call (either direction) OR two-plus outbound texts, OR a Zillow live-connect. A lead sitting in the "Lead"/new stage with no outreach is STUCK — and a paid lead nobody touched is money on the table (out of pocket for Realtor.com, untapped GCI for Zillow/pay-at-close). The standard: every paid lead gets a genuine first touch the day it lands, and its stage in the CRM is moved the moment you have a real conversation so it never looks abandoned.', 80),
 ('a4444444-4444-4444-4444-444444444444', null, 4, 'Follow-Up Discipline & the CRM',
  'The system only works if the CRM tells the truth.',
  'Your CRM is the single source of truth — if the work is not logged, it did not happen (and your leader cannot coach what they cannot see). Text and call THROUGH the CRM so activity is captured. Move a lead out of "Lead" the moment you speak with them. Set the next task before you hang up — a lead with no next step is a lead you will forget. Discipline here is not busywork: it is what turns a pile of paid leads into a predictable pipeline, and it is exactly what your Hustle Score measures.', 80)
on conflict (id) do nothing;

insert into rep_questions (module_id, idx, prompt, choices, answer, explain) values
 ('a1111111-1111-1111-1111-111111111111', 1, 'How fast should you contact a brand-new paid lead?',
  '["Within 5 minutes","Same business day","Within 24 hours","Whenever you have time"]'::jsonb, 0, 'Speed to lead is everything — within 5 minutes you are dramatically more likely to connect.'),
 ('a1111111-1111-1111-1111-111111111111', 2, 'On a Zillow live-connect call, why does answering matter so much?',
  '["It may never log in the CRM, so the live connect is your proof of work","It is worth extra commission","It skips the appointment","It counts as two texts"]'::jsonb, 0, 'The live call often is not recorded in the CRM — connecting is the proof you worked it.'),
 ('a1111111-1111-1111-1111-111111111111', 3, 'What is the goal of the very first touch?',
  '["Be human and fast, and set the next step","Fully qualify their finances","Pitch three listings","Ask who their current agent is"]'::jsonb, 0, 'First touch = human, fast, next step. Qualifying and pitching come later.'),
 ('a2222222-2222-2222-2222-222222222222', 1, 'What does the "A" in ALMS stand for — and what is its goal?',
  '["Appointment — book the next meeting","Application — take their mortgage app","Address — get their home address","Agreement — sign a buyer rep"]'::jsonb, 0, 'A = Appointment. The single aim of the call is the next meeting.'),
 ('a2222222-2222-2222-2222-222222222222', 2, 'Which of these should you NOT do on an ALMS call?',
  '["Ask if they already have an agent","Ask where they are looking","Ask what is motivating the move","Summarize and set the next step"]'::jsonb, 0, 'Do not prequalify finances or ask about a current agent — it kills the connection.'),
 ('a2222222-2222-2222-2222-222222222222', 3, 'What is the point of the "Summarize" step?',
  '["Play it back so they feel heard and the next step is locked","Recap your credentials","List every home in their price range","Confirm their credit score"]'::jsonb, 0, 'Summarizing makes them feel heard and cements the next step.'),
 ('a3333333-3333-3333-3333-333333333333', 1, 'A paid lead counts as "worked" when it gets which of these?',
  '["One call, or 2+ outbound texts, or a Zillow live-connect","One email","Being assigned to you","Sitting in the Lead stage"]'::jsonb, 0, 'Worked = real effort: a call, 2+ outbound texts, or a live connect.'),
 ('a3333333-3333-3333-3333-333333333333', 2, 'A paid lead with no outreach, still in the new/Lead stage, is:',
  '["Stuck — money on the table","Worked","Closed","Not your responsibility"]'::jsonb, 0, 'No touch = stuck. A paid lead nobody worked is lost commission.'),
 ('a3333333-3333-3333-3333-333333333333', 3, 'When should you move a lead out of the "Lead" stage?',
  '["The moment you have a real conversation","At the end of the month","Only after they tour a home","Never — leave it for the leader"]'::jsonb, 0, 'Advance the stage as soon as you actually connect, so it never looks abandoned.'),
 ('a4444444-4444-4444-4444-444444444444', 1, 'Why call and text THROUGH the CRM?',
  '["So the activity is captured and your work is visible","It is faster to dial","It hides the lead from your leader","It avoids TCPA"]'::jsonb, 0, 'Through the CRM = activity is logged, so your work counts and can be coached.'),
 ('a4444444-4444-4444-4444-444444444444', 2, 'What should you always do before ending a call with a lead?',
  '["Set the next task/step","Delete the lead","Mark it closed","Forward it to your leader"]'::jsonb, 0, 'A lead with no next step is a lead you will forget — always set the next task.'),
 ('a4444444-4444-4444-4444-444444444444', 3, 'What does honest CRM logging directly power?',
  '["Your Hustle Score and your leader''s ability to coach you","Your commission rate","The office rent","Zillow''s pricing"]'::jsonb, 0, 'Logged work drives your Hustle Score and lets your leader actually coach you.')
on conflict do nothing;

notify pgrst, 'reload schema';
