-- ═══════════════════════════════════════════════════════════════════════════
-- Coach brief memory — say it once, not every morning for a week
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
-- Applied to production 2026-08-25.
--
-- The store already knows the same CALL must not be counted twice (rule 3).
-- This is the other half of that: the same HABIT must not be TOLD twice.
--
-- A pattern is true for as long as the agent keeps doing it, so "current" stays
-- true for days. A brief that reprints everything current says the same three
-- names every morning until the evidence ages out — which is precisely how a
-- text channel gets muted, and then the one morning it says something new is
-- the morning nobody reads it.
--
-- So the brief remembers what it has already said, and how much evidence there
-- was when it said it. A pattern comes back only when it has genuinely moved:
-- new evidence we had not seen last time. Everything else stays in the app,
-- where looking at it is the broker's choice rather than an interruption.
--
-- Only a real send writes these. A preview must never mark something as told —
-- looking at what would be sent would otherwise consume it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table coach_patterns
  add column if not exists last_briefed_at      timestamptz,
  add column if not exists briefed_occurrences  integer not null default 0;

-- The view gains `brief_worthy` and passes the two columns through. Recreated
-- rather than replaced because a new column in the middle of the select list
-- is a rename as far as `create or replace view` is concerned.
drop view if exists coach_patterns_live;

create view coach_patterns_live as
select
  p.id, p.org_id, p.team_id, p.agent_name, p.agent_id, p.pattern_key,
  p.explanation, p.coaching_move, p.first_seen_at, p.last_seen_at,
  p.last_briefed_at, p.briefed_occurrences,
  s.window_start, s.window_end, s.generated_at as last_update,

  (select count(*) from coach_pattern_findings f where f.pattern_id = p.id) as occurrences,
  (select count(*) from coach_pattern_findings f
    where f.pattern_id = p.id
      and f.occurred_at >= s.window_start
      and f.occurred_at < (s.window_end + 1)) as occurrences_this_window,
  (select max(f.occurred_at) from coach_pattern_findings f where f.pattern_id = p.id) as latest_evidence,

  exists (select 1 from coach_pattern_findings f
           where f.pattern_id = p.id
             and f.occurred_at >= s.window_start
             and f.occurred_at < (s.window_end + 1)) as is_current,

  ((select count(*) from coach_pattern_findings f
     where f.pattern_id = p.id
       and (f.occurred_at is null or f.occurred_at >= now() - interval '90 days')) >= 2)
    as is_recurring,

  (not exists (select 1 from coach_pattern_findings f
                where f.pattern_id = p.id
                  and f.occurred_at >= s.window_start
                  and f.occurred_at < (s.window_end + 1)))
    as no_new_example_this_week,

  -- Worth a broker's attention this morning: never told, or there is evidence
  -- we did not have when we told them. Counted, not timestamped, so a report
  -- redelivering the identical week can never make a pattern look like it moved.
  (p.last_briefed_at is null
   or (select count(*) from coach_pattern_findings f where f.pattern_id = p.id)
        > p.briefed_occurrences) as brief_worthy

from coach_patterns p
join coach_team_state s on s.team_id = p.team_id;

notify pgrst, 'reload schema';
