-- ═══════════════════════════════════════════════════════════════════════════
-- Coach fresh start — run ONCE, the day the fresh-logic Hermes run lands
-- ═══════════════════════════════════════════════════════════════════════════
-- DO NOT run this ahead of time. Sequence (docs/HERMES_CONTRACT.md §7):
-- Codex ships the new rules → Hermes runs fresh → run this → ingest.
--
-- Why: every pattern in the store was produced by analysis that predates the
-- doctrine (docs/SALES_DOCTRINE.md, 2026-08-25). Letting a fresh-logic run
-- merge into stale-logic patterns would mix the two reasonings forever --
-- old misapplied lead_e rows would keep their occurrence counts, and the
-- ninety-day memory would keep vouching for claims made under rules Eric has
-- since overruled.
--
-- This clears only DERIVED data. coach_weekly_reports — the raw history of
-- every report ever received — is untouched, so nothing is unrecoverable.

-- The pattern store: rebuilt entirely by the next accepted ingest.
truncate coach_pattern_findings;
truncate coach_patterns cascade;
truncate coach_team_state;

-- The brief's said-it-already memory rides on coach_patterns rows, so it went
-- with them. brief_sends stays: it is the log of what was actually texted,
-- and history does not get rewritten.

notify pgrst, 'reload schema';
