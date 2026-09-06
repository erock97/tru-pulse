-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Coach run-event failure logs (admin-only Failure Logs tab)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in the TRU-Pulse Supabase SQL Editor. ADDITIVE and idempotent — safe
-- on the live project, touches no existing data.
--
-- The Hermes laptop's local pipeline reports sanitized, non-PII incident
-- summaries via POST /coach/run-events (COACH_INGEST_TOKEN — the same door and
-- secret as the coaching brief, see worker/src/coachBriefIngest.ts). Only the
-- platform owners (the `admins` table) ever read this data, through the
-- Failure Logs tab (GET/PATCH /admin/failure-logs, worker/src/failureLogsAdmin.ts).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. One batch summary per push. Upserted, so a retried send just overwrites
--    its own row.
create table if not exists coach_run_event_batches (
  batch_id       text primary key,
  status         text not null,
  fatal_count    integer not null default 0,
  nonfatal_count integer not null default 0,
  received_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 2. Every individual incident, kept forever, keyed by incidentId — the
--    idempotency key. Insert-once: a retried send of the same incidentId is
--    dropped before it reaches this table (see runEventsIngest.ts), so there
--    is never anything here for on-conflict to merge.
create table if not exists coach_run_event_incidents (
  incident_id  text primary key,
  fingerprint  text not null,
  batch_id     text not null references coach_run_event_batches(batch_id) on delete cascade,
  account_id   text not null,
  occurred_at  timestamptz not null,
  severity     text not null check (severity in ('nonfatal', 'fatal')),
  scope        text not null check (scope in ('event', 'contact', 'team', 'batch', 'delivery')),
  stage        text not null,
  code         text not null,
  title        text not null,
  explanation  text not null,
  impact       text not null,
  next_step    text not null,
  action       text not null,
  continued    boolean not null,
  position     integer,
  total        integer,
  technical    jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now()
);
create index if not exists coach_run_event_incidents_fingerprint_idx
  on coach_run_event_incidents (fingerprint, occurred_at desc);
create index if not exists coach_run_event_incidents_batch_idx
  on coach_run_event_incidents (batch_id);

-- 3. One row per recurring problem, grouped by fingerprint — what the Failure
--    Logs tab actually lists. `status` and `resolution_notes` are set by an
--    admin in the UI (PATCH /admin/failure-logs), never by the laptop.
create table if not exists coach_run_event_problems (
  fingerprint          text primary key,
  title                text not null,
  stage                text not null,
  severity             text not null check (severity in ('nonfatal', 'fatal')),
  first_seen           timestamptz not null,
  last_seen            timestamptz not null,
  occurrence_count     integer not null default 1,
  affected_batch_ids   text[] not null default '{}',
  affected_account_ids text[] not null default '{}',
  status               text not null default 'open'
                        check (status in ('open', 'investigating', 'fixed', 'needs-human', 'verified')),
  resolution_notes     text,
  latest_incident_id   text not null references coach_run_event_incidents(incident_id),
  updated_at           timestamptz not null default now()
);
create index if not exists coach_run_event_problems_status_idx
  on coach_run_event_problems (status, last_seen desc);

-- 4. RLS — service-role only, same as zillow_targets_* and admins itself: no
--    policy for `authenticated`. The browser never talks to PostgREST for this
--    data; only the Worker (service role, after the admins-table check in
--    index.ts) does.
alter table coach_run_event_batches   enable row level security;  -- no policy
alter table coach_run_event_incidents enable row level security;  -- no policy
alter table coach_run_event_problems  enable row level security;  -- no policy

notify pgrst, 'reload schema';

-- Atomic insert-once ingestion. Serializing this small diagnostic stream also
-- prevents cross-batch retries racing the same incident ID or fingerprint.
create or replace function public.ingest_coach_run_events(p_push jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  i jsonb;
  n integer := 0;
  inserted_id text;
begin
  perform pg_advisory_xact_lock(746281902);
  insert into public.coach_run_event_batches(batch_id,status,fatal_count,nonfatal_count)
  values(p_push->>'batchId',p_push->>'status',(p_push->'counts'->>'fatal')::integer,(p_push->'counts'->>'nonfatal')::integer)
  on conflict(batch_id) do update set status=excluded.status,fatal_count=excluded.fatal_count,
    nonfatal_count=excluded.nonfatal_count,updated_at=now();
  for i in select value from jsonb_array_elements(p_push->'incidents') loop
    inserted_id := null;
    insert into public.coach_run_event_incidents(incident_id,fingerprint,batch_id,account_id,occurred_at,
      severity,scope,stage,code,title,explanation,impact,next_step,action,continued,position,total,technical)
    values(i->>'incidentId',i->>'fingerprint',i->>'batchId',i->>'accountId',(i->>'occurredAt')::timestamptz,
      i->>'severity',i->>'scope',i->>'stage',i->>'code',i->>'title',i->>'explanation',i->>'impact',
      i->>'nextStep',i->>'action',(i->>'continued')::boolean,(i->>'position')::integer,
      (i->>'total')::integer,coalesce(i->'technical','{}'::jsonb))
    on conflict(incident_id) do nothing returning incident_id into inserted_id;
    if inserted_id is null then continue; end if;
    n := n+1;
    insert into public.coach_run_event_problems as p(fingerprint,title,stage,severity,first_seen,last_seen,
      occurrence_count,affected_batch_ids,affected_account_ids,status,latest_incident_id)
    values(i->>'fingerprint',i->>'title',i->>'stage',i->>'severity',(i->>'occurredAt')::timestamptz,
      (i->>'occurredAt')::timestamptz,1,array[i->>'batchId'],array[i->>'accountId'],
      case when (i->>'code') ~* '(AUTH|MFA|LOGIN|CREDENTIAL)' then 'needs-human' else 'open' end,inserted_id)
    on conflict(fingerprint) do update set
      first_seen=least(p.first_seen,excluded.first_seen),last_seen=greatest(p.last_seen,excluded.last_seen),
      occurrence_count=p.occurrence_count+1,
      affected_batch_ids=array(select distinct unnest(p.affected_batch_ids || excluded.affected_batch_ids)),
      affected_account_ids=array(select distinct unnest(p.affected_account_ids || excluded.affected_account_ids)),
      title=case when excluded.last_seen>=p.last_seen then excluded.title else p.title end,
      stage=case when excluded.last_seen>=p.last_seen then excluded.stage else p.stage end,
      severity=case when excluded.last_seen>=p.last_seen then excluded.severity else p.severity end,
      latest_incident_id=case when excluded.last_seen>=p.last_seen then excluded.latest_incident_id else p.latest_incident_id end,
      updated_at=now();
  end loop;
  return jsonb_build_object('incidentsNew',n);
end;
$$;
revoke all on function public.ingest_coach_run_events(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_coach_run_events(jsonb) to service_role;
revoke all on public.coach_run_event_batches,public.coach_run_event_incidents,public.coach_run_event_problems from anon,authenticated;
grant select,insert,update on public.coach_run_event_batches,public.coach_run_event_incidents,public.coach_run_event_problems to service_role;
notify pgrst, 'reload schema';

