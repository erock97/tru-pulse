alter table public.history_jobs add column live_capture_from timestamptz;
alter table public.history_jobs add column webhook_verified_at timestamptz;
alter table public.history_jobs add column reconciliation_verified_at timestamptz;
alter table public.history_jobs add column overlap_verified_at timestamptz;
alter table public.history_coverage add column account_id bigint not null;
alter table public.history_coverage add foreign key(account_id,person_id,content_hash)
 references public.history_receipts(account_id,person_id,content_hash);
create table public.history_job_people (
 job_id uuid not null references public.history_jobs(id),
 person_id bigint not null,
 source_raw text not null,
 disposition text not null check(disposition in ('eligible','excluded','review','inaccessible')),
 primary key(job_id,person_id)
);
alter table public.history_job_people enable row level security;
revoke all on public.history_job_people from public,anon,authenticated;
grant select,insert,update on public.history_job_people to service_role;
revoke update on public.history_snapshot_versions,public.history_stage_events,public.history_receipts from service_role;

create function public.history_validate_job(p_job_id uuid) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.history_jobs; a public.history_accounts; eligible bigint;
begin
 select * into strict j from history_jobs where id=p_job_id for update;
 select * into strict a from history_accounts where account_id=j.account_id;
 if not j.census_complete or j.expected_people is null or j.unresolved_people is distinct from 0::bigint then raise exception 'Census or unresolved coverage prevents validation'; end if;
 if jsonb_array_length(j.failures)>0 then raise exception 'Unresolved collection failures prevent validation'; end if;
 if j.source_policy<>'truehq-exact-sources-2026-v1' then raise exception 'Unsupported source policy'; end if;
 if j.live_capture_from is null or j.live_capture_from>j.cutoff or j.webhook_verified_at is null or j.reconciliation_verified_at is null or j.overlap_verified_at is null then raise exception 'Historical live overlap is not verified'; end if;
 select count(*) into eligible from history_job_people where job_id=j.id and disposition='eligible';
 if eligible<>j.expected_people then raise exception 'Census count mismatch'; end if;
 if exists(select 1 from history_job_people p where p.job_id=j.id and p.disposition='eligible' and not coalesce(
  (select range_agg(tstzrange(c.from_at,c.through_at,'[)')) @> tstzrange(j.from_at,j.cutoff,'[)') from history_coverage c
   where c.job_id=j.id and c.account_id=j.account_id and c.person_id=p.person_id and c.pagination_complete and c.state in ('validated','published')),false)) then raise exception 'Historical interval gaps remain'; end if;
 if exists(select 1 from history_job_people where job_id=j.id and disposition='inaccessible') then raise exception 'Inaccessible people remain'; end if;
 if jsonb_array_length(j.profile_dispositions)<>(select count(*) from agents where team_id=a.team_id) or exists(
  select 1 from agents p where p.team_id=a.team_id and not exists(select 1 from jsonb_array_elements(j.profile_dispositions) d
   where d->>'id'=p.id::text and d->>'team_id'=p.team_id::text and d->>'org_id'=p.org_id::text
   and coalesce((d->>'excluded')::boolean,false)=coalesce(p.excluded,false)
   and d->>'disposition'=any(case when p.excluded then array['excluded'] else array['covered','no_eligible_leads'] end))) then raise exception 'Profile dispositions are incomplete or stale'; end if;
 update history_jobs set state='validated' where id=j.id and state<>'published';
end $$;
revoke all on function public.history_validate_job(uuid) from public,anon,authenticated;
grant execute on function public.history_validate_job(uuid) to service_role;

create function public.history_publish(p_job_id uuid,p_version_id text,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.history_jobs; a public.history_accounts; previous text; saved jsonb; receipt public.history_publications;
begin
 perform history_validate_job(p_job_id);
 select * into strict j from history_jobs where id=p_job_id for update;
 select * into strict a from history_accounts where account_id=j.account_id;
 perform pg_advisory_xact_lock(j.account_id);
 if p_version_id !~ '^[a-f0-9]{64}$' or p_snapshot->>'orgId' is distinct from a.org_id::text or p_snapshot->>'teamId' is distinct from a.team_id::text
  or p_snapshot->>'sourcePolicyVersion' is distinct from j.source_policy or (p_snapshot->>'through')::timestamptz is distinct from j.cutoff
  or jsonb_typeof(p_snapshot->'leads') is distinct from 'array' or jsonb_typeof(p_snapshot->'stageLog') is distinct from 'array' then raise exception 'Snapshot identity or scope mismatch'; end if;
 if jsonb_array_length(p_snapshot->'leads')<>j.expected_people then raise exception 'Snapshot lead count mismatch'; end if;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'stageLog') l where l->>'team_id' is distinct from a.team_id::text
  or (l->>'changed_at')::timestamptz>=j.cutoff or not exists(select 1 from history_job_people p where p.job_id=j.id and p.disposition='eligible' and p.person_id=(l->>'fub_person_id')::bigint)
  or not exists(select 1 from history_stage_events e where e.account_id=j.account_id and e.person_id=(l->>'fub_person_id')::bigint
   and e.upstream_id=l->>'event_id' and e.upstream_kind=l->>'event_kind' and e.occurred_at=(l->>'changed_at')::timestamptz)) then raise exception 'Snapshot stage scope mismatch'; end if;
 if exists(select 1 from history_job_people p where p.job_id=j.id and p.disposition='eligible' and not exists(
  select 1 from jsonb_array_elements(p_snapshot->'leads') l where (l->>'fub_person_id')::bigint=p.person_id and l->>'team_id'=a.team_id::text)) then raise exception 'Snapshot people do not match census'; end if;
 select snapshot into saved from history_snapshot_versions where version_id=p_version_id;
 if found and saved<>p_snapshot then raise exception 'Immutable snapshot version conflict'; end if;
 insert into history_snapshot_versions(version_id,job_id,org_id,team_id,snapshot) values(p_version_id,j.id,a.org_id,a.team_id,p_snapshot) on conflict(version_id) do nothing;
 select version_id into previous from history_publications where team_id=a.team_id order by id desc limit 1;
 if previous=p_version_id then return jsonb_build_object('reused',true,'versionId',previous); end if;
 insert into history_publications(team_id,version_id,previous_version_id,legacy_rollback_key)
 values(a.team_id,p_version_id,previous,case when previous is null then 'pulse-history:v1:'||a.org_id::text else null end) returning * into receipt;
 update history_jobs set state='published' where id=j.id;
 return to_jsonb(receipt);
end $$;
revoke all on function public.history_publish(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.history_publish(uuid,text,jsonb) to service_role;
