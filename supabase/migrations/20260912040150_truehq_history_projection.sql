-- The compatibility projection never replaces the canonical transition store.
create function public.history_stage_category(p_stage text) returns text
language sql immutable parallel safe set search_path=public,pg_temp as $$
 select case lower(trim(p_stage)) when 'met with customer' then 'met'
 when 'submitting offers' then 'offer' when 'under contract' then 'uc'
 when 'pending' then 'uc' when 'closed' then 'closed' when 'nurture' then 'nurture' end
$$;

create function public.history_project_job(p_job_id uuid) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.history_jobs; n integer;
begin
 select * into strict j from history_jobs where id=p_job_id for update;
 if j.state<>'published' then raise exception 'Only published history can change milestone projections'; end if;
 with earliest as (
  select distinct on(e.team_id,e.person_id,e.to_stage) e.*
  from history_stage_events e join history_job_people p on p.job_id=j.id and p.person_id=e.person_id and p.disposition='eligible'
  where e.account_id=j.account_id and e.occurred_at<j.cutoff and history_stage_category(e.to_stage) is not null
  order by e.team_id,e.person_id,e.to_stage,e.occurred_at,e.upstream_kind,e.upstream_id
 ), changed as (
  insert into person_stage_log(org_id,team_id,fub_person_id,stage,changed_at,stage_class,date_source)
  select org_id,team_id,person_id,to_stage,occurred_at,history_stage_category(to_stage),
   case upstream_kind when 'ChangeLog' then 'fub_change_log' else 'fub_webhook' end from earliest
  on conflict(team_id,fub_person_id,stage) do update set changed_at=excluded.changed_at,
   stage_class=excluded.stage_class,date_source=excluded.date_source
  where person_stage_log.changed_at is null or person_stage_log.date_source='seed' or person_stage_log.changed_at>excluded.changed_at
  returning 1
 ) select count(*) into n from changed;
 return n;
end $$;
revoke all on function public.history_project_job(uuid) from public,anon,authenticated;
grant execute on function public.history_project_job(uuid) to service_role;

create function public.history_snapshot_evidence_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.history_jobs; l jsonb; e public.history_stage_events; basis text;
begin
 select * into strict j from history_jobs where id=new.job_id;
 if new.snapshot->>'cohortPolicy' is distinct from 'created-ytd-2026-v1' or exists(
  select 1 from jsonb_array_elements(new.snapshot->'leads') p where p->>'fub_created' is null
   or (p->>'fub_created')::timestamptz<j.from_at or (p->>'fub_created')::timestamptz>=j.cutoff
   or not coalesce(lower(regexp_replace(trim(p->>'source_family'),'\s+',' ','g'))=any(array['zillow','zillow preferred','zillow premier agent','zillow flex','realtor.com','realtordotcom','realtor.com mvip','market vip via opcity bla']),false)
 ) then raise exception 'Snapshot creation cohort or source mismatch'; end if;
 for l in select value from jsonb_array_elements(new.snapshot->'stageLog') loop
  select * into strict e from history_stage_events where account_id=j.account_id
   and person_id=(l->>'fub_person_id')::bigint and upstream_kind=l->>'event_kind' and upstream_id=l->>'event_id';
  basis:=history_stage_category(e.to_stage);
  if basis is null or l->>'basis' is distinct from basis or l->>'stage_class' is null
   or not coalesce((l->>'stage_class'=basis or
    array_position(array['met','offer','uc','closed'],l->>'stage_class')<=array_position(array['met','offer','uc','closed'],basis)),false)
   or (l->>'changed_at')::timestamptz is distinct from e.occurred_at then raise exception 'Unevidenced milestone projection'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(new.snapshot->'stageLog'))<>
    (select count(distinct (x->>'fub_person_id',x->>'stage_class')) from jsonb_array_elements(new.snapshot->'stageLog') x) then raise exception 'Duplicate milestone projection'; end if;
 return new;
end $$;
create trigger history_snapshot_evidence before insert on public.history_snapshot_versions
for each row execute function public.history_snapshot_evidence_guard();
revoke all on function public.history_snapshot_evidence_guard() from public,anon,authenticated;
