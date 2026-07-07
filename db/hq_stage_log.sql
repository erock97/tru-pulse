-- ═══════════════════════════════════════════════════════════════════════════
-- person_stage_log — forward stage-progression history
-- ═══════════════════════════════════════════════════════════════════════════
-- The reliable dated closings/offer/UC signal. FUB exposes NO stage history via
-- its API (verified: /events is inbound-only, the person object is current-state
-- only), so we accrue our own log: one dated "hit" the first time a lead reaches
-- an achievement stage (offer / under contract / closed), stamped with the agent.
--
-- Populated automatically by syncTeam for EVERY team on every sync (cron every
-- 30 min + on key-entry + on the FUB webhook) — zero per-team setup.
--
-- Idempotent + NON-DESTRUCTIVE, and self-healing: create-if-not-exists PLUS
-- add-column-if-not-exists, so it works whether the table is brand-new OR already
-- exists on an older schema (e.g. missing stage_class). Never drops data.

create table if not exists person_stage_log (
  id bigint generated always as identity primary key
);

alter table person_stage_log add column if not exists org_id        uuid;
alter table person_stage_log add column if not exists team_id       uuid;
alter table person_stage_log add column if not exists fub_person_id bigint;
alter table person_stage_log add column if not exists stage         text;          -- raw FUB stage name
alter table person_stage_log add column if not exists stage_class   text;          -- offer | uc | closed
alter table person_stage_log add column if not exists agent_name    text;          -- assigned agent at time of the hit
alter table person_stage_log add column if not exists agent_user_id bigint;        -- FUB user id (stable join key)
alter table person_stage_log add column if not exists changed_at    timestamptz;   -- best-known date reached; NULL = pre-history seed
alter table person_stage_log add column if not exists detected_at   timestamptz not null default now();
alter table person_stage_log add column if not exists date_source   text not null default 'live'; -- live | deal_close_date | seed | tableau

create unique index if not exists person_stage_log_uniq      on person_stage_log (team_id, fub_person_id, stage);
create index        if not exists person_stage_log_win_idx   on person_stage_log (team_id, stage_class, changed_at);
create index        if not exists person_stage_log_agent_idx on person_stage_log (team_id, agent_user_id, stage_class, changed_at);

-- RLS mirrors every other org-scoped table: a signed-in member reads only their org.
alter table person_stage_log enable row level security;
drop policy if exists person_stage_log_org_read on person_stage_log;
create policy person_stage_log_org_read on person_stage_log
  for select to authenticated using (is_org_member(org_id));
