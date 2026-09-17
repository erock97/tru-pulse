-- Retain a previously observed stage before a current-stage refresh replaces it.
-- Timestamps are observation times, never inferred achievement dates.
alter table public.leads add column if not exists pipeline_observed_stages jsonb not null default '{}'::jsonb;
create or replace function public.retain_pipeline_stage_observation()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.pipeline_observed_stages := coalesce(new.pipeline_observed_stages,'{}'::jsonb) || old.pipeline_observed_stages;
  if old.stage is not null and old.synced_at is not null and not (new.pipeline_observed_stages ? old.stage) then
    new.pipeline_observed_stages := new.pipeline_observed_stages || pg_catalog.jsonb_build_object(old.stage,old.synced_at);
  end if;
  return new;
end;
$$;
revoke all on function public.retain_pipeline_stage_observation() from public;
drop trigger if exists retain_pipeline_stage_observation on public.leads;
create trigger retain_pipeline_stage_observation before update of stage on public.leads
for each row when (old.stage is distinct from new.stage)
execute function public.retain_pipeline_stage_observation();
