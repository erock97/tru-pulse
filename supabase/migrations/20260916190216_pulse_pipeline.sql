-- Additive only. Review and apply separately from code deployment.
alter table public.leads add column if not exists stage_id bigint;
alter table public.leads add column if not exists assigned_user_id bigint;
alter table public.leads add column if not exists assigned_pond_id bigint;
alter table public.teams add column if not exists pipeline_stage_mappings jsonb not null default '{}'::jsonb;
-- Existing table policies/grants remain intact. Mapping writes go through the
-- authenticated Worker, which verifies both team visibility and leader/admin role.
-- Do not backfill identities from names: the next FUB sync supplies stable IDs.
