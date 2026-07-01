-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Pulse — deals (closings metrics: Offer Rate, leads-per-closing)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synced from FUB /deals by the worker. Eric's rule: Under Contract and Closed
-- are treated the SAME (both are closings). Additive + idempotent.

create table if not exists deals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  team_id         uuid not null references teams(id) on delete cascade,
  fub_deal_id     bigint not null,
  name            text,
  stage           text,               -- raw FUB stage name
  stage_class     text,               -- offer | uc | closed | other (shared/flags.ts)
  status          text,
  price           numeric,
  commission      numeric,
  agent_name      text,               -- first assigned FUB user
  fub_person_id   bigint,
  projected_close timestamptz,        -- the close date (UC = forward-looking)
  fub_created     timestamptz,
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (team_id, fub_deal_id)
);
create index if not exists deals_team_idx  on deals (team_id, projected_close);
create index if not exists deals_class_idx on deals (team_id, stage_class);

alter table deals enable row level security;
drop policy if exists deals_org_read on deals;
create policy deals_org_read on deals for select to authenticated using (is_org_member(org_id));

notify pgrst, 'reload schema';
