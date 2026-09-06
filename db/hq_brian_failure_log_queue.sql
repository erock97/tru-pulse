-- Brian's pull queue: one lease/version per existing fingerprint group.
-- Existing incident ingestion stays insert-once. No customer tables are accessed.
alter table public.coach_run_event_problems
  add column if not exists version integer not null default 1,
  add column if not exists claim_agent text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists diagnosis text,
  add column if not exists remediation text,
  add column if not exists agent_next_step text,
  add column if not exists files_changed jsonb not null default '[]',
  add column if not exists tests_run jsonb not null default '[]';

create table public.coach_run_event_history (
  id bigint generated always as identity primary key,
  fingerprint text not null references public.coach_run_event_problems(fingerprint),
  incident_id text not null references public.coach_run_event_incidents(incident_id),
  version integer not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor text not null check(actor in ('brian','administrator','ingestion')),
  operation text not null,
  from_status text,
  to_status text not null,
  detail jsonb not null,
  unique(fingerprint, version)
);
create index coach_run_event_history_group_idx on public.coach_run_event_history(fingerprint, version);
alter table public.coach_run_event_history enable row level security;
revoke all on public.coach_run_event_history from public,anon,authenticated;
grant select,insert on public.coach_run_event_history to service_role;
grant usage on sequence public.coach_run_event_history_id_seq to service_role;

create function public.coach_history_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'HISTORY_IMMUTABLE'; end $$;
create trigger coach_history_no_change before update or delete on public.coach_run_event_history
for each row execute function public.coach_history_immutable();

-- Serialize all changes to a group via its row lock. Recurrence preserves agent
-- fields and claims, but reopens fixed problems. Every change has one version.
create function public.coach_problem_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op = 'UPDATE' then
    -- Recurrence metadata alone must not strand the owner with an unreadable
    -- version (active tickets are deliberately absent from the pull queue).
    new.version := case when new.occurrence_count > old.occurrence_count and old.status <> 'fixed' then old.version else old.version + 1 end;
    if new.occurrence_count > old.occurrence_count and old.status = 'fixed' then
      new.status := 'open'; new.claim_agent := null; new.claimed_at := null; new.claim_expires_at := null;
    end if;
  end if;
  return new;
end $$;
create trigger coach_problem_version_before before update on public.coach_run_event_problems
for each row execute function public.coach_problem_version();

create function public.coach_problem_audit() returns trigger language plpgsql security invoker set search_path='' as $$
declare actor_name text; operation_name text;
begin
  if tg_op='UPDATE' and new.version=old.version then return new; end if;
  actor_name := coalesce(nullif(current_setting('truhq.agent_actor',true),''),'ingestion');
  operation_name := coalesce(nullif(current_setting('truhq.agent_operation',true),''),case when tg_op='INSERT' then 'ingested' else 'recurrence' end);
  insert into public.coach_run_event_history(fingerprint,incident_id,version,actor,operation,from_status,to_status,detail)
  values(new.fingerprint,new.latest_incident_id,new.version,actor_name,operation_name,
    case when tg_op='UPDATE' then old.status else null end,new.status,
    jsonb_build_object('diagnosis',new.diagnosis,'remediation',new.remediation,'nextStep',new.agent_next_step,
      'filesChanged',new.files_changed,'testsRun',new.tests_run,'resolutionNotes',new.resolution_notes,
      'claim',case when new.claim_agent is null then null else jsonb_build_object('agentId',new.claim_agent,'claimedAt',new.claimed_at,'expiresAt',new.claim_expires_at) end));
  return new;
end $$;
create trigger coach_problem_audit_after after insert or update on public.coach_run_event_problems
for each row execute function public.coach_problem_audit();

-- Preserve a baseline of pre-queue statuses; no invented historical transitions.
insert into public.coach_run_event_history(fingerprint,incident_id,version,actor,operation,to_status,detail)
select fingerprint,latest_incident_id,version,'ingestion','baseline',status,jsonb_build_object('resolutionNotes',resolution_notes)
from public.coach_run_event_problems;

create table public.coach_agent_rate_windows(bucket text primary key, started_at timestamptz not null, requests integer not null);
alter table public.coach_agent_rate_windows enable row level security;
revoke all on public.coach_agent_rate_windows from public,anon,authenticated;
grant select,insert,update on public.coach_agent_rate_windows to service_role;
create function public.coach_agent_rate_limit(p_bucket text) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; begin
  if p_bucket not in ('queue','mutation') then return false; end if;
  insert into public.coach_agent_rate_windows as w values(p_bucket,clock_timestamp(),1)
  on conflict(bucket) do update set
    requests=case when w.started_at <= clock_timestamp()-interval '60 seconds' then 1 else least(w.requests+1,61) end,
    started_at=case when w.started_at <= clock_timestamp()-interval '60 seconds' then clock_timestamp() else w.started_at end
  returning requests into n;
  return n <= 60;
end $$;

create function public.coach_agent_queue(p_limit integer default 1) returns jsonb language sql security invoker set search_path='' as $$
  select coalesce(jsonb_agg(ticket order by fatal_order,occurred_at,incident_id),'[]'::jsonb) from (
    select (case when i.severity='fatal' then 0 else 1 end) fatal_order,i.occurred_at,i.incident_id,
      jsonb_build_object('schemaVersion',1,'incidentId',i.incident_id,'fingerprint',i.fingerprint,
        'batchId',i.batch_id,'accountId',i.account_id,'occurredAt',i.occurred_at,'severity',i.severity,
        'scope',i.scope,'stage',i.stage,'code',i.code,'title',i.title,'explanation',i.explanation,
        'impact',i.impact,'nextStep',i.next_step,'action',i.action,'continued',i.continued,
        'position',i.position,'total',i.total,'technical',i.technical,'status',p.status,
        'occurrenceCount',p.occurrence_count,'firstSeenAt',p.first_seen,'lastSeenAt',p.last_seen,
        'version',p.version,'claim',case when p.claim_agent is null then null else
          jsonb_build_object('agentId',p.claim_agent,'claimedAt',p.claimed_at,'expiresAt',p.claim_expires_at) end) ticket
    from public.coach_run_event_problems p
    -- Choose the oldest most severe occurrence deterministically per group.
    cross join lateral (select * from public.coach_run_event_incidents e where e.fingerprint=p.fingerprint
      order by case when e.severity='fatal' then 0 else 1 end,e.occurred_at,e.incident_id limit 1) i
    where p_limit between 1 and 5 and (p.status='open' or (p.status='investigating' and p.claim_expires_at<=clock_timestamp()))
      and (p.claim_expires_at is null or p.claim_expires_at<=clock_timestamp())
    order by fatal_order,i.occurred_at,i.incident_id limit least(greatest(p_limit,1),5)
  ) q;
$$;

create function public.coach_agent_mutate(p_incident_id text,p_operation text,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.coach_run_event_problems; target_fingerprint text; t timestamptz; v_status text;
begin
  select fingerprint into target_fingerprint from public.coach_run_event_incidents where incident_id=p_incident_id;
  select * into p from public.coach_run_event_problems where fingerprint=target_fingerprint for update;
  if not found then return jsonb_build_object('code','INCIDENT_NOT_FOUND'); end if;
  t := clock_timestamp();
  if p_body->>'agentId' is distinct from 'brian' then return jsonb_build_object('code','CLAIM_CONFLICT'); end if;
  if p_operation='claim' and p.claim_expires_at>t then return jsonb_build_object('code','CLAIM_CONFLICT'); end if;
  if p.version is distinct from (p_body->>'expectedVersion')::integer then return jsonb_build_object('code','VERSION_CONFLICT'); end if;
  if p_operation='claim' then
    if p.status not in ('open','investigating') then return jsonb_build_object('code','INVALID_STATUS_TRANSITION'); end if;
  else
    if p.claim_agent is distinct from 'brian' then return jsonb_build_object('code','CLAIM_CONFLICT'); end if;
    -- Release may clean up an expired lease; renewal/update may not.
    if p_operation<>'release' and (p.claim_expires_at is null or p.claim_expires_at<=t) then return jsonb_build_object('code','CLAIM_EXPIRED'); end if;
    if p.status<>'investigating' then return jsonb_build_object('code','INVALID_STATUS_TRANSITION'); end if;
  end if;
  perform set_config('truhq.agent_actor','brian',true);
  perform set_config('truhq.agent_operation',p_operation,true);
  if p_operation in ('claim','renew') then
    if (p_body->>'leaseSeconds')::integer not between 300 and 3600 then return jsonb_build_object('code','VALIDATION_ERROR'); end if;
    update public.coach_run_event_problems set status='investigating',claim_agent='brian',
      claimed_at=case when p_operation='claim' then t else claimed_at end,
      claim_expires_at=t+make_interval(secs=>(p_body->>'leaseSeconds')::integer),updated_at=t
    where fingerprint=target_fingerprint returning * into p;
  elsif p_operation='update' then
    v_status := p_body->>'status';
    if v_status is null or v_status not in ('investigating','fixed','needs-human') then return jsonb_build_object('code','INVALID_STATUS_TRANSITION'); end if;
    update public.coach_run_event_problems set status=v_status,diagnosis=p_body->>'diagnosis',
      remediation=coalesce(p_body->>'remediation',remediation),agent_next_step=p_body->>'nextStep',
      files_changed=coalesce(p_body->'filesChanged',files_changed),tests_run=coalesce(p_body->'testsRun',tests_run),
      claim_agent=case when v_status='investigating' then claim_agent else null end,
      claimed_at=case when v_status='investigating' then claimed_at else null end,
      claim_expires_at=case when v_status='investigating' then claim_expires_at else null end,updated_at=t
    where fingerprint=target_fingerprint returning * into p;
  elsif p_operation='release' then
    update public.coach_run_event_problems set status='open',claim_agent=null,claimed_at=null,claim_expires_at=null,
      diagnosis=coalesce(p_body->>'diagnosis',diagnosis),agent_next_step=coalesce(p_body->>'nextStep',agent_next_step),updated_at=t
    where fingerprint=target_fingerprint returning * into p;
  else return jsonb_build_object('code','INVALID_STATUS_TRANSITION'); end if;
  return jsonb_build_object('ok',true,'incidentId',p_incident_id,'status',p.status,'version',p.version,
    'claim',case when p.claim_agent is null then null else jsonb_build_object('agentId',p.claim_agent,'claimedAt',p.claimed_at,'expiresAt',p.claim_expires_at) end);
end $$;

-- This function is reachable only after the Worker's existing admins-table gate.
create function public.coach_admin_mutate(p_fingerprint text,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.coach_run_event_problems; s text;
begin
  select * into p from public.coach_run_event_problems where fingerprint=p_fingerprint for update;
  if not found then return jsonb_build_object('code','INCIDENT_NOT_FOUND'); end if;
  if p.version is distinct from (p_body->>'expectedVersion')::integer then return jsonb_build_object('code','VERSION_CONFLICT'); end if;
  s := coalesce(p_body->>'status',p.status);
  if s='verified' and p.status<>'fixed' then return jsonb_build_object('code','INVALID_STATUS_TRANSITION'); end if;
  if coalesce((p_body->>'releaseClaim')::boolean,false) then s := case when p.status in ('open','investigating') then 'open' else p.status end; end if;
  perform set_config('truhq.agent_actor','administrator',true);
  perform set_config('truhq.agent_operation',case when coalesce((p_body->>'releaseClaim')::boolean,false) then 'release' else 'update' end,true);
  update public.coach_run_event_problems set status=s,resolution_notes=coalesce(p_body->>'notes',resolution_notes),
    claim_agent=case when s<>p.status or coalesce((p_body->>'releaseClaim')::boolean,false) then null else claim_agent end,
    claimed_at=case when s<>p.status or coalesce((p_body->>'releaseClaim')::boolean,false) then null else claimed_at end,
    claim_expires_at=case when s<>p.status or coalesce((p_body->>'releaseClaim')::boolean,false) then null else claim_expires_at end,updated_at=clock_timestamp()
  where fingerprint=p_fingerprint returning * into p;
  return jsonb_build_object('ok',true,'version',p.version,'status',p.status);
end $$;

revoke all on function public.coach_history_immutable(), public.coach_problem_version(), public.coach_problem_audit(), public.coach_agent_rate_limit(text), public.coach_agent_queue(integer), public.coach_agent_mutate(text,text,jsonb), public.coach_admin_mutate(text,jsonb) from public,anon,authenticated;
grant execute on function public.coach_history_immutable(), public.coach_problem_version(), public.coach_problem_audit(), public.coach_agent_rate_limit(text), public.coach_agent_queue(integer), public.coach_agent_mutate(text,text,jsonb), public.coach_admin_mutate(text,jsonb) to service_role;
notify pgrst,'reload schema';
