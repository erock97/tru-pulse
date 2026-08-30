-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Zillow target/pacing tables (admin-only dashboard)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in the TRU-Pulse Supabase SQL Editor. ADDITIVE and idempotent — safe
-- on the live project, touches no existing data.
--
-- The fub-weekly-reports Worker scrapes each team's embedded Zillow/Tableau
-- report (Buyer Connections) and reports, per team, a "6-month target" and a
-- "ZHL target" figure alongside the team's current actual against each. It
-- pushes both via POST /zillow/targets (its own secret, not ADMIN_TOKEN or
-- COACH_INGEST_TOKEN). Only the platform owners (the `admins` table) ever see
-- this data — it is not a partner-facing metric.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Teams learn the slug fub-weekly-reports calls them by. Nullable: a team
--    without a slug simply never matches an incoming push.
alter table teams add column if not exists zillow_team_slug text;
create unique index if not exists teams_zillow_team_slug_idx
  on teams (zillow_team_slug) where zillow_team_slug is not null;

-- 1. Latest value per team per metric — what the dashboard renders. Upserted
--    on every push, so it always reflects the most recent scrape.
create table if not exists zillow_targets_snapshot (
  team_id            uuid not null references teams(id) on delete cascade,
  metric             text not null check (metric in ('six_month', 'zhl')),
  target_value       numeric not null,
  actual_value       numeric not null,
  unit               text not null default 'count',   -- 'count' | 'currency' | 'pct'
  period_label       text,
  period_start       date,
  period_end         date,
  source_refresh_date date,
  captured_at        timestamptz not null,
  raw                jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now(),
  primary key (team_id, metric)
);

-- 2. Every push, kept — a trend line is possible later with no further
--    migration.
create table if not exists zillow_targets_history (
  team_id      uuid not null references teams(id) on delete cascade,
  metric       text not null check (metric in ('six_month', 'zhl')),
  captured_at  timestamptz not null,
  target_value numeric not null,
  actual_value numeric not null,
  unit         text not null default 'count',
  period_label text,
  period_start date,
  period_end   date,
  raw          jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now(),
  primary key (team_id, metric, captured_at)
);
create index if not exists zillow_targets_history_team_idx
  on zillow_targets_history (team_id, metric, captured_at desc);

-- 3. RLS — service-role only, same as the `admins` table itself: no policy for
--    `authenticated`. The browser never talks to PostgREST for this data; only
--    the Worker (service role, after the admins-table check) does. This is
--    what makes it invisible to every partner/team login.
alter table zillow_targets_snapshot enable row level security;  -- no policy
alter table zillow_targets_history  enable row level security;  -- no policy

-- 4. Seed slugs for the teams already known. Add more the same way as each
--    new team's scrape comes online:
--      update teams set zillow_team_slug = '<slug>' where name = '<Team Name>';
update teams set zillow_team_slug = 'costigan'
  where name = 'Costigan' and zillow_team_slug is null;
update teams set zillow_team_slug = 'signature'
  where name = 'Signature Realty' and zillow_team_slug is null;
update teams set zillow_team_slug = 'scottmoore'
  where name = 'Scott Moore Group' and zillow_team_slug is null;
update teams set zillow_team_slug = 'woosley'
  where name = 'Woosley Group' and zillow_team_slug is null;

notify pgrst, 'reload schema';
