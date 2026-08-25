-- ═══════════════════════════════════════════════════════════════════════════
-- Coach issues — a ninety-day memory of what each agent keeps doing
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
-- Hermes will start sending a report every day rather than every week. Each one
-- is a snapshot: here is what these calls showed. On its own a snapshot cannot
-- answer either of the two questions that actually matter to a team leader.
--
--   "Is this a habit, or did it just happen once?"
--        A seven-person team in one week often has no repeated behaviour at all
--        — Costigan and Scott Moore currently have none. Across ninety days
--        they will. Patterns need a longer lens than one report.
--
--   "Didn't we already deal with this?"
--        If a leader is told about an agent on Monday, has the conversation,
--        and sees the same line again on Tuesday, the brief has wasted their
--        time and taught them to stop reading it. A daily brief without a
--        memory of what it has already said is worse than a weekly one.
--
-- So the reports stay immutable in coach_weekly_reports, and this table is the
-- accumulated view over them: one row per issue per agent, carrying how often
-- it has been seen, across how many different buyers, whether it has been
-- raised, and what happened when it was.
--
-- ── The lifecycle, which is the whole point ─────────────────────────────────
--
--   open        Seen, not yet put in front of anyone.
--   raised      Put in a brief. SILENCED from here on — it must not reappear
--               just because tomorrow's report mentions the same thing about
--               the same calls.
--   contacted   The agent-side conversation happened; there is an answer.
--   recurring   THE IMPORTANT ONE. The behaviour turned up again in calls dated
--               AFTER it was raised. That is not a repeat of the old news, it is
--               new news: they were told and it did not change. This is what
--               lets the brief say "I raised this with you on the 3rd, and this
--               is the third time I have seen it."
--   resolved    Stopped happening, or closed by hand.
--
-- Note what silences an issue: being RAISED, not time passing. And note what
-- un-silences it: fresh evidence dated after the conversation, never a clock.
-- An issue that was genuinely fixed stays quiet forever, which is correct.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists coach_issues (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id)  on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,

  -- The agent as the analysis names them. Not a foreign key: a report can name
  -- somebody who is not on the roster yet, and losing the issue because the
  -- roster is behind would be the wrong trade.
  agent_name    text not null,
  agent_id      uuid references agents(id) on delete set null,

  -- A stable identity for "the same issue", so a point worded slightly
  -- differently tomorrow lands on the same row. Derived, never typed by hand.
  issue_key     text not null,
  -- How the brief says it. Short, behavioural, and about the pattern rather
  -- than about one buyer: "Texting first instead of calling", not "Call Feng".
  title         text not null,
  -- Which half of the analysis it came from.
  source_kind   text not null default 'coachingAction',

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Every report that has evidenced this, with its date and the buyers involved:
  --   [{ "reportDate":"2026-08-24", "leads":["Gina Smith","Alice Choa"], "n":2 }]
  -- Kept rather than only counted, because "three different buyers this week"
  -- is a far stronger claim to put to an agent than "three times", and because
  -- it is what proves the behaviour continued AFTER a conversation.
  occurrences   jsonb not null default '[]'::jsonb,
  -- Rolling counts, maintained alongside occurrences so the brief does not have
  -- to unpack the array to rank anything.
  times_seen    int not null default 0,
  distinct_leads int not null default 0,

  status        text not null default 'open',
  -- Raised how many times, and when. This is what the brief counts out loud:
  -- "this is now the third time I have seen this."
  raised_count  int not null default 0,
  first_raised_at timestamptz,
  last_raised_at  timestamptz,
  -- What the agent said when asked. Free text: it is a human answer.
  response      text,
  responded_at  timestamptz,
  resolved_at   timestamptz,
  resolution    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (team_id, agent_name, issue_key)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coach_issues_status_check') then
    alter table coach_issues add constraint coach_issues_status_check
      check (status in ('open','raised','contacted','recurring','resolved'));
  end if;
end $$;

-- The brief's own query: this team's live issues, worst first.
create index if not exists coach_issues_live_idx
  on coach_issues (team_id, status, distinct_leads desc, last_seen_at desc);
-- Ageing out: nothing here is meant to outlive its ninety-day window.
create index if not exists coach_issues_age_idx on coach_issues (last_seen_at);


-- ── The escalation trail ────────────────────────────────────────────────────
-- Every time an issue is put in front of somebody, or somebody answers, that is
-- a row here. The issue carries the current state; this carries how it got
-- there, which is what the agent reads back when it says "I raised this with
-- you on the 3rd and again on the 11th".
create table if not exists coach_issue_events (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references coach_issues(id) on delete cascade,
  org_id     uuid not null references orgs(id) on delete cascade,
  kind       text not null,   -- observed | raised | contacted | replied | recurred | resolved
  -- Who it went to or came from, redacted to a first name where it is a person.
  actor      text,
  detail     text,
  -- The report that evidenced it, when the event is an observation.
  report_date date,
  created_at timestamptz not null default now()
);

create index if not exists coach_issue_events_issue_idx
  on coach_issue_events (issue_id, created_at desc);


-- ── Retention ───────────────────────────────────────────────────────────────
-- Ninety days, and it is a hard window rather than a preference: this table
-- holds what a client's agents were told they were doing wrong, and keeping
-- that indefinitely is a liability with no upside. A resolved issue that has
-- not been seen in ninety days is history, not signal.
create or replace function purge_stale_coach_issues() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from coach_issues
  where last_seen_at < now() - interval '90 days'
    and (last_raised_at is null or last_raised_at < now() - interval '90 days');
  get diagnostics n = row_count;
  return n;
end $$;


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role only, no policy, same as every other table the Worker owns.
-- A team lead reads their issues through a Worker route, never directly: this
-- is the record of what their people are doing wrong and it is not something to
-- hand a browser a key to.
alter table coach_issues enable row level security;
alter table coach_issue_events enable row level security;

notify pgrst, 'reload schema';
