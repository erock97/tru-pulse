-- ═══════════════════════════════════════════════════════════════════════════
-- Coach patterns — the rolling ninety-day view over overlapping daily reports
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
-- Implements rules 3-10 of the Hermes daily handoff.
--
-- ── The problem this exists to solve ────────────────────────────────────────
-- Hermes sends a report every morning covering the previous SEVEN days. So the
-- same call arrives seven mornings running. Stored naively, one conversation
-- becomes seven occurrences, every recurring-pattern threshold is meaningless,
-- and a leader is told the same thing every day for a week.
--
-- Two identities from the payload make it tractable, and this schema is built
-- entirely around them:
--
--   findingId   A hash of team + agent + contact + timestamp + channel + the
--               normalised quote. The SAME evidence always hashes the same, so
--               "we have seen this before" is an exact test rather than a
--               guess. This is what makes rule 3 possible.
--
--   patternKey  One of thirteen fixed coaching categories, chosen from a global
--               taxonomy rather than derived from wording. Stable across runs,
--               days and weeks. Two agents sharing one are in the same
--               category, not colliding.
--
-- Neither is inferred here. An earlier version of this store guessed both from
-- the phrasing of each point, and guessed wrong often enough to matter.
--
-- ── Current view versus history ─────────────────────────────────────────────
-- A pattern is CURRENT while at least one of its findings falls inside the
-- newest successfully accepted report's seven-day window (rules 4, 5). Once
-- every finding ages out of that window the pattern stops being current, but it
-- does NOT disappear — it stays in the ninety-day history and is shown there
-- labelled "No new example this week" (rule 10). Presenting old evidence as new
-- is the one thing rule 5 forbids outright.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. What the newest ACCEPTED run said the window was ─────────────────────
-- Rule 6. The "last updated" a leader sees, and the window every currency test
-- is measured against. Only advanced by a run that was accepted and published;
-- a rejected or failed delivery must never move it, or the app would claim
-- freshness it does not have.
create table if not exists coach_team_state (
  team_id        uuid primary key references teams(id) on delete cascade,
  org_id         uuid not null references orgs(id) on delete cascade,
  last_run_id    text not null,
  window_start   date not null,
  window_end     date not null,
  generated_at   timestamptz,
  accepted_at    timestamptz not null default now()
);


-- ── 2. One row per (team, agent, coaching category) ─────────────────────────
-- Rule 7's grouping. Brokerage comes along as org_id; the unique key is the
-- rest of it.
create table if not exists coach_patterns (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id)  on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  agent_name     text not null,
  agent_id       uuid references agents(id) on delete set null,
  -- One of the thirteen fixed categories. Never derived from prose.
  pattern_key    text not null,

  -- The most recent wording from the analysis. Display only: the identity is
  -- the pattern key, so a reworded explanation updates this and changes nothing
  -- about which pattern it is.
  explanation    text,
  coaching_move  text,

  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (team_id, agent_name, pattern_key)
);

create index if not exists coach_patterns_team_idx on coach_patterns (team_id, agent_name);


-- ── 3. Evidence, deduplicated by findingId ──────────────────────────────────
-- Rule 3, enforced by the database rather than by remembering to check: the
-- primary key IS the dedup. The same finding arriving on seven consecutive
-- mornings inserts once and conflicts six times.
--
-- Rule 8 then falls out of it — "at least two different supported occurrences"
-- is a count of rows here, so repeated delivery of one finding can never reach
-- two however many times it is sent.
create table if not exists coach_pattern_findings (
  pattern_id   uuid not null references coach_patterns(id) on delete cascade,
  finding_id   text not null,
  org_id       uuid not null references orgs(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  -- When the interaction happened, NOT when we heard about it. Rules 4, 5 and 9
  -- are all measured against this; using the delivery date instead would keep a
  -- stale pattern looking current for as long as Hermes kept re-sending it.
  occurred_at  timestamptz,
  lead_name    text,
  lead_url     text,
  channel      text,
  quote        text,
  first_seen_at timestamptz not null default now(),
  primary key (pattern_id, finding_id)
);

create index if not exists coach_pattern_findings_when_idx
  on coach_pattern_findings (team_id, occurred_at desc);


-- ── 4. Ninety days, and no longer ───────────────────────────────────────────
-- Rule 9. Also a retention limit: this is the record of what a client's agents
-- were told they were doing wrong, and keeping it indefinitely is a liability
-- with no upside. Patterns with no surviving evidence go with it.
create or replace function purge_stale_coach_patterns() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from coach_pattern_findings
   where occurred_at is not null and occurred_at < now() - interval '90 days';
  delete from coach_patterns p
   where not exists (select 1 from coach_pattern_findings f where f.pattern_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;


-- ── 5. What the app reads ───────────────────────────────────────────────────
-- Rules 4, 5, 8 and 10 in one place, so no caller can implement them slightly
-- differently. `is_current` decides the coaching view; `is_recurring` decides
-- the trend area; `no_new_example_this_week` is exactly rule 10's label.
create or replace view coach_patterns_live as
select
  p.id, p.org_id, p.team_id, p.agent_name, p.agent_id, p.pattern_key,
  p.explanation, p.coaching_move, p.first_seen_at, p.last_seen_at,
  s.window_start, s.window_end, s.generated_at as last_update,

  -- Distinct findings, which is the only count rules 8 and 10 recognise.
  (select count(*) from coach_pattern_findings f where f.pattern_id = p.id) as occurrences,
  (select count(*) from coach_pattern_findings f
    where f.pattern_id = p.id
      and f.occurred_at >= s.window_start
      and f.occurred_at < (s.window_end + 1)) as occurrences_this_window,
  (select max(f.occurred_at) from coach_pattern_findings f where f.pattern_id = p.id) as latest_evidence,

  -- Rule 4/5: current while at least one finding sits inside the newest
  -- accepted window; gone from the current view the moment none do.
  exists (select 1 from coach_pattern_findings f
           where f.pattern_id = p.id
             and f.occurred_at >= s.window_start
             and f.occurred_at < (s.window_end + 1)) as is_current,

  -- Rule 8: two DIFFERENT supported occurrences, inside ninety days (rule 9).
  ((select count(*) from coach_pattern_findings f
     where f.pattern_id = p.id
       and (f.occurred_at is null or f.occurred_at >= now() - interval '90 days')) >= 2)
    as is_recurring,

  -- Rule 10: still in history, nothing new this window. The trend area shows
  -- it; the coaching view must not.
  (not exists (select 1 from coach_pattern_findings f
                where f.pattern_id = p.id
                  and f.occurred_at >= s.window_start
                  and f.occurred_at < (s.window_end + 1)))
    as no_new_example_this_week
from coach_patterns p
join coach_team_state s on s.team_id = p.team_id;


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role only, no policy. A leader reads this through a Worker route,
-- never directly; it is the record of what their people are doing wrong.
alter table coach_team_state       enable row level security;
alter table coach_patterns         enable row level security;
alter table coach_pattern_findings enable row level security;

notify pgrst, 'reload schema';
