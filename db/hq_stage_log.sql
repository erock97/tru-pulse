-- ═══════════════════════════════════════════════════════════════════════════
-- person_stage_log — forward stage-progression history
-- ═══════════════════════════════════════════════════════════════════════════
-- The reliable dated closings/offer/UC signal. FUB exposes NO stage history via
-- its API (verified: /events is inbound-only, the person object is current-state
-- only), so we accrue our own log: one dated "hit" the first time a lead reaches
-- an achievement stage (offer / under contract / closed), stamped with the agent.
--
-- Populated automatically by syncTeam for EVERY team on every sync (cron every
-- 30 min + on key-entry + on the FUB webhook) — zero per-team setup. A lead that
-- climbs Submitting Offers -> Under Contract -> Closed produces three dated hits,
-- each creditable to its agent within the window it happened.
--
-- Idempotent + NON-DESTRUCTIVE: safe to run anytime, including against a live prod
-- DB. Uses `create ... if not exists`, so re-running never drops the table or its
-- accrued data (sync upserts regardless). To intentionally reset in dev, drop it by
-- hand first. (Previously used `drop table ... cascade` — removed so a production
-- cutover can never destroy stage history by accident.)

create table if not exists person_stage_log (
  id            bigint generated always as identity primary key,
  org_id        uuid   not null,
  team_id       uuid   not null,
  fub_person_id bigint not null,
  stage         text   not null,                    -- raw FUB stage name
  stage_class   text   not null,                    -- offer | uc | closed
  agent_name    text,                               -- assigned agent at time of the hit
  agent_user_id bigint,                             -- FUB user id (stable join key)
  changed_at    timestamptz,                        -- best-known date reached; NULL = pre-history seed
  detected_at   timestamptz not null default now(), -- when we first logged it
  date_source   text not null default 'live',       -- live | deal_close_date | seed | tableau
  unique (team_id, fub_person_id, stage)            -- one dated hit per (lead, stage)
);

create index if not exists person_stage_log_win_idx   on person_stage_log (team_id, stage_class, changed_at);
create index if not exists person_stage_log_agent_idx on person_stage_log (team_id, agent_user_id, stage_class, changed_at);

-- RLS mirrors every other org-scoped table: a signed-in member reads only their org.
alter table person_stage_log enable row level security;
drop policy if exists person_stage_log_org_read on person_stage_log;
create policy person_stage_log_org_read on person_stage_log
  for select to authenticated using (is_org_member(org_id));
