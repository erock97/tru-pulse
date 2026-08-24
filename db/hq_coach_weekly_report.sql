-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Coach — weekly coaching brief ingest (the Hermes/FUB report)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in the TRU-Pulse Supabase SQL Editor. ADDITIVE and idempotent — safe
-- on the live project, touches no existing data.
--
-- An automation on Eric's always-on laptop (Hermes, built with Codex) reviews a
-- team's Follow Up Boss activity weekly and produces a structured coaching brief
-- (JSON). The Worker ingests it at POST /coach/weekly-report (its own secret,
-- not ADMIN_TOKEN) and the Coach tab renders it. The laptop never talks to this
-- database — only the Worker's service role writes here.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Teams learn the slug the laptop calls them by ("costigan" → Costigan).
--    Nullable: a team without a slug simply never matches an incoming report.
alter table teams add column if not exists report_slug text;
create unique index if not exists teams_report_slug_idx
  on teams (report_slug) where report_slug is not null;

-- 1. One row per report run. The whole brief lives in `payload` — the table
--    stores runs, not a normalized copy of the report's inner structure, so the
--    laptop's schema can grow without another migration here.
create table if not exists coach_weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  -- The laptop's stable run id — the idempotency key. A retried send upserts
  -- onto this and can never create a duplicate report.
  run_id       text not null unique,
  -- Resolved from team_slug at ingest. NULL = the slug wasn't mapped yet (e.g.
  -- a report arriving before its team is set up); the row is held, invisible to
  -- RLS reads, and re-resolved on a later ingest.
  org_id       uuid references orgs(id)  on delete cascade,
  team_id      uuid references teams(id) on delete cascade,
  team_slug    text not null,
  -- 'weekly' publishes to the Coach tab; anything else ('personal', on-demand)
  -- is stored but never shown, per the handoff's publishing policy.
  run_trigger  text not null default 'weekly',
  status       text not null default 'held',   -- 'published' | 'held'
  week_start   date not null,
  week_end     date not null,
  generated_at timestamptz,
  -- The full brief as sent (validated): run, agents[], findings[].
  payload      jsonb not null,
  -- agentName → agents.id for every unambiguous name match at ingest time.
  -- Ambiguous/unknown names are ABSENT here by design — never guessed.
  agent_links  jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now()
);
create index if not exists coach_weekly_reports_team_idx
  on coach_weekly_reports (team_id, week_end desc);
create index if not exists coach_weekly_reports_status_idx
  on coach_weekly_reports (status);

-- 2. RLS — org members read their org's PUBLISHED reports; nothing else is
--    visible to the browser. All writes come through the Worker (service role),
--    so there is deliberately no insert/update policy for authenticated.
alter table coach_weekly_reports enable row level security;
drop policy if exists coach_weekly_reports_read on coach_weekly_reports;
create policy coach_weekly_reports_read on coach_weekly_reports
  for select to authenticated
  using (status = 'published' and org_id is not null and is_org_member(org_id));

-- 3. Seed the one slug in use today. New teams (Scott Moore, and Woosley /
--    Synergy when their runs turn on) get theirs the same way:
--      update teams set report_slug = '<slug>' where name = '<Team Name>';
update teams set report_slug = 'costigan'
  where name = 'Costigan' and report_slug is null;
