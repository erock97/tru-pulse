-- OFFLINE REVIEW ONLY. Apply only in a separately authorized deployment.
-- Existing coverage/responseTiming JSON contracts are not changed.
alter table public.coach_weekly_reports add column if not exists receipt_managed boolean not null default false;
create table public.coach_report_receipts (
 report_id uuid primary key references public.coach_weekly_reports(id),
 team_id uuid not null references public.teams(id),
 run_id text not null unique,
 canonical_payload text not null,
 payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
 publication text not null default 'held' check(publication in ('held','published','withdrawn','superseded')),
 derived_status text not null default 'not_required' check(derived_status in ('not_required','complete')),
 revision integer not null default 1 check(revision>0),
 coverage_state text not null check(coverage_state in ('complete','partial','unknown')),
 stored_at timestamptz not null default clock_timestamp(),
 changed_at timestamptz not null default clock_timestamp(),
 superseded_by uuid references public.coach_report_receipts(report_id),
 unique(team_id,run_id)
);
create table public.coach_report_operations (
 team_id uuid not null references public.teams(id), operation_id text not null,
 actor text not null, canonical_command text not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(team_id,operation_id)
);
create table public.coach_report_audit (
 id bigint generated always as identity primary key,
 team_id uuid not null, report_id uuid not null references public.coach_report_receipts(report_id),
 operation_id text, actor text not null, action text not null, reason text,
 before_state jsonb, after_state jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table public.coach_report_evidence_sources (
 report_id uuid not null references public.coach_weekly_reports(id),
 pattern_id uuid not null references public.coach_patterns(id) on delete cascade,
 finding_id text not null, primary key(report_id,pattern_id,finding_id)
);
alter table public.coach_report_receipts enable row level security;
alter table public.coach_report_operations enable row level security;
alter table public.coach_report_audit enable row level security;
alter table public.coach_report_evidence_sources enable row level security;
revoke all on public.coach_report_receipts,public.coach_report_operations,public.coach_report_audit,public.coach_report_evidence_sources from public,anon,authenticated;
grant all on public.coach_report_receipts,public.coach_report_operations,public.coach_report_audit,public.coach_report_evidence_sources to service_role;
grant usage,select on sequence public.coach_report_audit_id_seq to service_role;

create function public.coach_receipt_lookup(p_team uuid,p_run text) returns jsonb
language sql stable security invoker set search_path = public,pg_temp as $$
 select jsonb_build_object('reportId',report_id,'teamId',team_id,'runId',run_id,
 'hashScheme','receipt-jcs-sha256-v1','payloadHash',payload_hash,'storageStatus','stored',
 'publicationStatus',publication,'derivedProcessing',jsonb_build_object('status',derived_status,'scope','coach_patterns'),
 'revision',revision,'coverageState',coverage_state,'storedAt',stored_at,'changedAt',changed_at,
 'holdReason',case when publication='held' then 'explicit_release_required' else null end,'supersededBy',superseded_by)
 from public.coach_report_receipts where team_id=p_team and run_id=p_run;
$$;

create function public.coach_receipt_accept(p_team uuid,p_run text,p_canonical text,p_payload jsonb,p_links jsonb,p_actor text) returns jsonb
language plpgsql security invoker set search_path = public,pg_temp as $$
declare r public.coach_report_receipts; rid uuid; org uuid; h text; cv text; result jsonb;
begin
 -- Serialize all publication/accept operations per team, plus global run IDs.
 perform pg_advisory_xact_lock(hashtextextended('coach-team:'||p_team::text,0));
 perform pg_advisory_xact_lock(hashtextextended('coach-run:'||p_run,0));
 h:=encode(sha256(convert_to(p_canonical,'UTF8')),'hex');
 select * into r from public.coach_report_receipts where run_id=p_run;
 if found then
  if r.team_id<>p_team then raise exception 'identity_conflict'; end if;
  if r.payload_hash<>h or r.canonical_payload<>p_canonical then raise exception 'payload_conflict'; end if;
  return jsonb_build_object('replayed',true,'receipt',public.coach_receipt_lookup(p_team,p_run));
 end if;
 if exists(select 1 from public.coach_weekly_reports where run_id=p_run) then raise exception 'legacy_conflict'; end if;
 if p_payload#>>'{run,teamId}'<>p_team::text or p_payload#>>'{run,runId}'<>p_run or p_canonical::jsonb#>>'{run,teamId}'<>p_team::text or p_canonical::jsonb#>>'{run,runId}'<>p_run then raise exception 'identity_conflict'; end if;
 select org_id into org from public.teams where id=p_team and is_active=true;
 if not found then raise exception 'team_unavailable'; end if;
 cv:=case when not(p_payload ? 'coverage') then 'unknown' when p_payload#>>'{coverage,rosterComplete}'='true' and not exists(select 1 from jsonb_array_elements(p_payload#>'{coverage,contacts}') c where c->>'status'<>'reviewed') then 'complete' else 'partial' end;
 insert into public.coach_weekly_reports(run_id,team_id,org_id,team_slug,run_trigger,status,week_start,week_end,generated_at,payload,agent_links,receipt_managed)
 values(p_run,p_team,org,p_team::text,p_payload#>>'{run,trigger}','held',(p_payload#>>'{run,startDate}')::date,(p_payload#>>'{run,endDate}')::date,(p_payload#>>'{run,generatedAt}')::timestamptz,p_payload,p_links,true) returning id into rid;
 insert into public.coach_report_receipts(report_id,team_id,run_id,canonical_payload,payload_hash,coverage_state) values(rid,p_team,p_run,p_canonical,h,cv);
 result:=public.coach_receipt_lookup(p_team,p_run);
 insert into public.coach_report_audit(team_id,report_id,actor,action,after_state) values(p_team,rid,p_actor,'accepted',result);
 return jsonb_build_object('replayed',false,'receipt',result);
end $$;

-- Full, transactional team projection. Evidence keeps its report provenance.
-- Report payloads remain immutable; only these derived tables are rebuilt.
create function public.coach_receipt_rebuild(p_team uuid) returns void
language plpgsql security invoker set search_path = public,pg_temp as $$
declare rep record; a jsonb; o jsonb; f jsonb; evidence jsonb; pid uuid; touched uuid[]:='{}'; t timestamptz; q text; prior record; latest record;
begin
 delete from public.coach_report_evidence_sources s using public.coach_weekly_reports r where s.report_id=r.id and r.team_id=p_team;
 delete from public.coach_pattern_findings where team_id=p_team;
 for rep in select * from public.coach_weekly_reports where team_id=p_team and status='published' order by coalesce(generated_at,received_at),id loop
  t:=coalesce(rep.generated_at,rep.received_at);
  for a in select value from jsonb_array_elements(coalesce(rep.payload->'agents','[]')) loop
   if lower(regexp_replace(trim(a->>'agentName'),'[^a-zA-Z0-9]+',' ','g'))='eric and adam' then continue; end if;
   for o in select value from jsonb_array_elements(coalesce(a->'opportunityPoints','[]')) loop
    if nullif(o->>'patternKey','') is null then continue; end if;
    select coalesce(jsonb_agg(x),'[]') into evidence from jsonb_array_elements(coalesce(rep.payload->'findings','[]')) x
     where x->>'agentName'=a->>'agentName' and (o->'findingIds') ? (x->>'findingId');
    if jsonb_array_length(evidence)=0 and o ? 'findingIndex' then
     select coalesce(jsonb_agg(x),'[]') into evidence from jsonb_array_elements(coalesce(rep.payload->'findings','[]')) x
      where x->>'agentName'=a->>'agentName' and x->'findingIndex'=o->'findingIndex';
    end if;
    -- A point without durable linked evidence cannot enter the projection.
    if not exists(select 1 from jsonb_array_elements(evidence) x where nullif(x->>'findingId','') is not null) then continue; end if;
    insert into public.coach_patterns(org_id,team_id,agent_name,agent_id,pattern_key,explanation,coaching_move,first_seen_at,last_seen_at,updated_at)
     values(rep.org_id,p_team,a->>'agentName',(rep.agent_links->>(a->>'agentName'))::uuid,o->>'patternKey',o->>'explanation',o->>'coachingMove',t,t,t)
     on conflict(team_id,agent_name,pattern_key) do update set explanation=excluded.explanation,coaching_move=excluded.coaching_move,agent_id=excluded.agent_id,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
     returning id into pid;
    if not(pid=any(touched)) then update public.coach_patterns set first_seen_at=t where id=pid; touched:=array_append(touched,pid); end if;
    for f in select value from jsonb_array_elements(evidence) loop
     if nullif(f->>'findingId','') is null then continue; end if;
     q:=coalesce(f->>'quote',case when jsonb_array_length(evidence)=1 and o->>'sourceQuality'='verbatim' then o->>'sourceQuote' end);
     select * into prior from public.coach_pattern_findings where pattern_id=pid and finding_id=f->>'findingId';
     if found and (prior.quote is distinct from q or prior.occurred_at is distinct from (f->>'occurredAt')::timestamptz or prior.lead_name is distinct from f->>'leadName' or prior.channel is distinct from f->>'channel') then raise exception 'evidence_conflict'; end if;
     insert into public.coach_pattern_findings(pattern_id,finding_id,org_id,team_id,occurred_at,lead_name,lead_url,channel,quote)
      values(pid,f->>'findingId',rep.org_id,p_team,(f->>'occurredAt')::timestamptz,f->>'leadName',f->>'leadUrl',f->>'channel',q) on conflict do nothing;
     insert into public.coach_report_evidence_sources(report_id,pattern_id,finding_id) values(rep.id,pid,f->>'findingId') on conflict do nothing;
    end loop;
   end loop;
  end loop;
 end loop;
 delete from public.coach_patterns where team_id=p_team and not(id=any(touched));
 select * into latest from public.coach_weekly_reports where team_id=p_team and status='published' order by coalesce(generated_at,received_at) desc,id desc limit 1;
 if found then
  insert into public.coach_team_state(team_id,org_id,last_run_id,window_start,window_end,generated_at,accepted_at)
  values(p_team,latest.org_id,latest.run_id,latest.week_start,latest.week_end,latest.generated_at,coalesce(latest.generated_at,latest.received_at))
  on conflict(team_id) do update set last_run_id=excluded.last_run_id,window_start=excluded.window_start,window_end=excluded.window_end,generated_at=excluded.generated_at,accepted_at=excluded.accepted_at;
 else delete from public.coach_team_state where team_id=p_team; end if;
end $$;

create function public.coach_receipt_control(p_team uuid,p_actor text,p_command jsonb,p_canonical text,p_allow_partial boolean default false) returns jsonb
language plpgsql security invoker set search_path = public,pg_temp as $$
declare r public.coach_report_receipts; replacement public.coach_report_receipts; op public.coach_report_operations; before_r jsonb; before_replacement jsonb; result jsonb; act text:=p_command->>'action';
begin
 perform pg_advisory_xact_lock(hashtextextended('coach-team:'||p_team::text,0));
 if p_command->>'teamId'<>p_team::text or p_canonical::jsonb<>p_command then raise exception 'identity_conflict'; end if;
 select * into op from public.coach_report_operations where team_id=p_team and operation_id=p_command->>'operationId';
 if found then
  if op.actor<>p_actor or op.canonical_command<>p_canonical then raise exception 'operation_conflict'; end if;
  return op.result||jsonb_build_object('replayed',true,'receipt',public.coach_receipt_lookup(p_team,op.result#>>'{receipt,runId}'),'replacementReceipt',case when op.result ? 'replacementReceipt' then public.coach_receipt_lookup(p_team,op.result#>>'{replacementReceipt,runId}') else null end);
 end if;
 select * into r from public.coach_report_receipts where team_id=p_team and run_id=p_command->>'runId' for update;
 if not found then raise exception 'receipt_not_found'; end if;
 if r.payload_hash<>p_command->>'expectedHash' or r.revision<>(p_command->>'expectedRevision')::int then raise exception 'revision_conflict'; end if;
 before_r:=public.coach_receipt_lookup(p_team,r.run_id);
 if act='release' then
  if r.publication not in ('held','withdrawn') then raise exception 'invalid_transition'; end if;
  if r.coverage_state='partial' and not p_allow_partial then raise exception 'partial_release_disabled'; end if;
  update public.coach_report_receipts set publication='published',derived_status='complete',revision=revision+1,changed_at=clock_timestamp() where report_id=r.report_id;
 elsif act='withdraw' then
  if r.publication not in ('held','published') then raise exception 'invalid_transition'; end if;
  update public.coach_report_receipts set publication='withdrawn',derived_status=case when r.publication='published' then 'complete' else 'not_required' end,revision=revision+1,changed_at=clock_timestamp() where report_id=r.report_id;
 elsif act='supersede' then
  if r.publication not in ('held','published','withdrawn') then raise exception 'invalid_transition'; end if;
  select * into replacement from public.coach_report_receipts where team_id=p_team and run_id=p_command#>>'{replacement,runId}' for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if replacement.report_id=r.report_id or replacement.publication<>'held' then raise exception 'invalid_transition'; end if;
  if replacement.payload_hash<>p_command#>>'{replacement,expectedHash}' or replacement.revision<>(p_command#>>'{replacement,expectedRevision}')::int then raise exception 'revision_conflict'; end if;
  if r.publication='published' and replacement.coverage_state='partial' and not p_allow_partial then raise exception 'partial_release_disabled'; end if;
  before_replacement:=public.coach_receipt_lookup(p_team,replacement.run_id);
  update public.coach_report_receipts set publication='superseded',superseded_by=replacement.report_id,derived_status=case when r.publication='published' then 'complete' else 'not_required' end,revision=revision+1,changed_at=clock_timestamp() where report_id=r.report_id;
  update public.coach_report_receipts set publication=case when r.publication='published' then 'published' else 'held' end,derived_status=case when r.publication='published' then 'complete' else 'not_required' end,revision=revision+1,changed_at=clock_timestamp() where report_id=replacement.report_id;
 else raise exception 'invalid_transition'; end if;
 perform set_config('tru.receipt_write','on',true);
 update public.coach_weekly_reports w set status=case when x.publication='published' then 'published' else 'held' end
  from public.coach_report_receipts x where x.report_id=w.id and x.team_id=p_team and (x.report_id=r.report_id or x.report_id=replacement.report_id);
 -- Failures roll back status changes, audit, operation receipt AND derived writes.
 if act='release' or r.publication='published' then perform public.coach_receipt_rebuild(p_team); end if;
 result:=jsonb_build_object('replayed',false,'operationId',p_command->>'operationId','receipt',public.coach_receipt_lookup(p_team,r.run_id));
 insert into public.coach_report_audit(team_id,report_id,operation_id,actor,action,reason,before_state,after_state)
  values(p_team,r.report_id,p_command->>'operationId',p_actor,act,p_command->>'reason',before_r,result->'receipt');
 if act='supersede' then
  result:=result||jsonb_build_object('replacementReceipt',public.coach_receipt_lookup(p_team,replacement.run_id));
  insert into public.coach_report_audit(team_id,report_id,operation_id,actor,action,reason,before_state,after_state)
   values(p_team,replacement.report_id,p_command->>'operationId',p_actor,'replacement',p_command->>'reason',before_replacement,result->'replacementReceipt');
 end if;
 insert into public.coach_report_operations(team_id,operation_id,actor,canonical_command,result) values(p_team,p_command->>'operationId',p_actor,p_canonical,result);
 return result;
end $$;

create function public.coach_receipt_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.coach_report_receipts where report_id=old.id) then
  if TG_OP='DELETE' then raise exception 'immutable_receipt'; end if;
  if new.payload is distinct from old.payload or new.run_id<>old.run_id or new.team_id is distinct from old.team_id or new.org_id is distinct from old.org_id or new.team_slug<>old.team_slug or new.agent_links<>old.agent_links or not new.receipt_managed or new.run_trigger<>old.run_trigger or new.week_start<>old.week_start or new.week_end<>old.week_end or new.generated_at is distinct from old.generated_at then raise exception 'immutable_receipt'; end if;
  if new.status<>old.status and current_setting('tru.receipt_write',true) is distinct from 'on' then raise exception 'explicit_control_required'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger coach_receipt_immutable before update or delete on public.coach_weekly_reports for each row execute function public.coach_receipt_guard();
revoke all on function public.coach_receipt_lookup(uuid,text),public.coach_receipt_accept(uuid,text,text,jsonb,jsonb,text),public.coach_receipt_rebuild(uuid),public.coach_receipt_control(uuid,text,jsonb,text,boolean),public.coach_receipt_guard() from public,anon,authenticated;
grant execute on function public.coach_receipt_lookup(uuid,text),public.coach_receipt_accept(uuid,text,text,jsonb,jsonb,text),public.coach_receipt_control(uuid,text,jsonb,text,boolean),public.coach_receipt_rebuild(uuid),public.coach_receipt_guard() to service_role;

-- Audit entries and operation results are append-only through ordinary roles.
revoke update,delete,truncate on public.coach_report_audit,public.coach_report_operations from service_role;
