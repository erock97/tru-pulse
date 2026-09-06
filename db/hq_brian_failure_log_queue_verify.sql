-- Synthetic integration assertions. All data and rate-window changes roll back.
begin;
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Failed: %',label; end if; end $$;
do $$
declare push jsonb; i jsonb; r jsonb; q jsonb; v integer; n integer; old_claim timestamptz;
begin
  i := jsonb_build_object('schemaVersion',1,'incidentId','synthetic-db-brian-a','fingerprint','synthetic-db-brian',
    'batchId','synthetic-db-brian','accountId','synthetic-test','occurredAt','2000-01-01T00:00:00Z',
    'severity','nonfatal','scope','event','stage','synthetic','code','SYNTHETIC_TEST','title','Synthetic queue test',
    'explanation','Synthetic evidence only.','impact','No production work affected.','nextStep','Review synthetic evidence.',
    'action','synthetic_test','continued',true);
  push := jsonb_build_object('batchId','synthetic-db-brian','status','attention_required','counts',jsonb_build_object('fatal',0,'nonfatal',1),'incidents',jsonb_build_array(i));
  r:=public.ingest_coach_run_events(push); perform pg_temp.check_true((r->>'incidentsNew')::integer=1,'ingestion');
  r:=public.ingest_coach_run_events(push); perform pg_temp.check_true((r->>'incidentsNew')::integer=0,'delivery idempotency');
  select version into v from public.coach_run_event_problems where fingerprint='synthetic-db-brian';
  perform pg_temp.check_true(v=1,'retry preserves version');
  r:=public.coach_agent_mutate('missing-synthetic','claim','{"agentId":"brian","expectedVersion":1,"leaseSeconds":300}');
  perform pg_temp.check_true(r->>'code'='INCIDENT_NOT_FOUND','missing');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim','{"agentId":"brian","expectedVersion":2,"leaseSeconds":300}');
  perform pg_temp.check_true(r->>'code'='VERSION_CONFLICT','version conflict');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim','{"agentId":"brian","expectedVersion":1,"leaseSeconds":300}');
  perform pg_temp.check_true(r->>'status'='investigating' and (r->>'version')::integer=2,'claim');
  old_claim := (r->'claim'->>'claimedAt')::timestamptz;
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim','{"agentId":"brian","expectedVersion":2,"leaseSeconds":300}');
  perform pg_temp.check_true(r->>'code'='CLAIM_CONFLICT','active claim cannot be stolen');
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(public.coach_agent_queue(5)) t where t->>'fingerprint'='synthetic-db-brian'),'claimed excluded');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','renew','{"agentId":"other","expectedVersion":2,"leaseSeconds":300}');
  perform pg_temp.check_true(r->>'code'='CLAIM_CONFLICT','other owner renewal');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','renew','{"agentId":"brian","expectedVersion":2,"leaseSeconds":600}');
  perform pg_temp.check_true((r->>'version')::integer=3 and (r->'claim'->>'claimedAt')::timestamptz=old_claim,'owner renewal');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update','{"agentId":"brian","expectedVersion":3,"status":"verified","diagnosis":"Synthetic diagnosis.","nextStep":"Review synthetic evidence."}');
  perform pg_temp.check_true(r->>'code'='INVALID_STATUS_TRANSITION','agent cannot verify');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update','{"agentId":"brian","expectedVersion":3,"status":"investigating","diagnosis":"Synthetic diagnosis.","nextStep":"Review synthetic evidence."}');
  perform pg_temp.check_true((r->>'version')::integer=4,'investigating update');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update','{"agentId":"brian","expectedVersion":3,"status":"investigating","diagnosis":"Synthetic diagnosis.","nextStep":"Review synthetic evidence."}');
  perform pg_temp.check_true(r->>'code'='VERSION_CONFLICT','duplicate update rejected');
  -- New occurrence cannot erase active diagnosis or lease.
  push:=jsonb_set(push,'{incidents}',jsonb_build_array(i||'{"incidentId":"synthetic-db-brian-b"}'::jsonb));
  perform public.ingest_coach_run_events(push);
  perform pg_temp.check_true(exists(select 1 from public.coach_run_event_problems where fingerprint='synthetic-db-brian' and version=4 and occurrence_count=2 and diagnosis='Synthetic diagnosis.' and claimed_at=old_claim),'active recurrence');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','release','{"agentId":"brian","expectedVersion":4}');
  perform pg_temp.check_true(r->>'status'='open' and r->'claim'='null'::jsonb,'release');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim','{"agentId":"brian","expectedVersion":5,"leaseSeconds":300}');
  -- Expiration is simulated solely on this synthetic fixture; audit stays intact.
  update public.coach_run_event_problems set claim_expires_at=clock_timestamp()-interval '1 second' where fingerprint='synthetic-db-brian';
  select version into v from public.coach_run_event_problems where fingerprint='synthetic-db-brian';
  r:=public.coach_agent_mutate('synthetic-db-brian-a','renew',jsonb_build_object('agentId','brian','expectedVersion',v,'leaseSeconds',300));
  perform pg_temp.check_true(r->>'code'='CLAIM_EXPIRED','expired renewal');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update',jsonb_build_object('agentId','brian','expectedVersion',v,'status','fixed'));
  perform pg_temp.check_true(r->>'code'='CLAIM_EXPIRED','expired update');
  perform pg_temp.check_true(exists(select 1 from jsonb_array_elements(public.coach_agent_queue(5)) t where t->>'fingerprint'='synthetic-db-brian'),'expired queue');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim',jsonb_build_object('agentId','brian','expectedVersion',v,'leaseSeconds',300));
  perform pg_temp.check_true((r->>'version')::integer=v+1,'expired reclaim'); v:=v+1;
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update',jsonb_build_object('agentId','brian','expectedVersion',v,'status','fixed','diagnosis','Synthetic diagnosis.','remediation','Synthetic repair.','nextStep','Await controlled verification.','filesChanged',jsonb_build_array('src/synthetic.mjs'),'testsRun',jsonb_build_array('synthetic regression')));
  perform pg_temp.check_true(r->>'status'='fixed' and r->'claim'='null'::jsonb,'fixed clears lease');v:=v+1;
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(public.coach_agent_queue(5)) t where t->>'fingerprint'='synthetic-db-brian'),'fixed excluded');
  push:=jsonb_set(push,'{incidents}',jsonb_build_array(i||'{"incidentId":"synthetic-db-brian-c"}'::jsonb));
  perform public.ingest_coach_run_events(push);v:=v+1;
  perform pg_temp.check_true(exists(select 1 from public.coach_run_event_problems where fingerprint='synthetic-db-brian' and status='open' and occurrence_count=3 and diagnosis='Synthetic diagnosis.'),'fixed recurrence reopens');
  r:=public.coach_admin_mutate('synthetic-db-brian',jsonb_build_object('expectedVersion',v,'status','verified'));
  perform pg_temp.check_true(r->>'code'='INVALID_STATUS_TRANSITION','admin verify requires fixed');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim',jsonb_build_object('agentId','brian','expectedVersion',v,'leaseSeconds',300));v:=v+1;
  r:=public.coach_admin_mutate('synthetic-db-brian',jsonb_build_object('expectedVersion',v,'releaseClaim',true));v:=v+1;
  perform pg_temp.check_true(r->>'status'='open','admin release');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update',jsonb_build_object('agentId','brian','expectedVersion',v-1,'status','fixed'));
  perform pg_temp.check_true(r->>'code'='VERSION_CONFLICT','admin invalidates stale writes');
  r:=public.coach_agent_mutate('synthetic-db-brian-a','claim',jsonb_build_object('agentId','brian','expectedVersion',v,'leaseSeconds',300));v:=v+1;
  r:=public.coach_agent_mutate('synthetic-db-brian-a','update',jsonb_build_object('agentId','brian','expectedVersion',v,'status','needs-human','diagnosis','Synthetic evidence needs review.','nextStep','Review synthetic evidence.'));v:=v+1;
  perform pg_temp.check_true(r->>'status'='needs-human','needs human transition');
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(public.coach_agent_queue(5)) t where t->>'fingerprint'='synthetic-db-brian'),'needs human excluded');
  r:=public.coach_admin_mutate('synthetic-db-brian',jsonb_build_object('expectedVersion',v,'status','fixed'));v:=v+1;
  r:=public.coach_admin_mutate('synthetic-db-brian',jsonb_build_object('expectedVersion',v,'status','verified'));v:=v+1;
  perform pg_temp.check_true(r->>'status'='verified','admin verification');
  select count(*) into n from public.coach_run_event_history where fingerprint='synthetic-db-brian';
  perform pg_temp.check_true(n=v,'complete one-entry-per-version history');
  begin
    update public.coach_run_event_history set operation='tampered' where fingerprint='synthetic-db-brian';
    raise exception 'History allowed update';
  exception when raise_exception then if sqlerrm <> 'HISTORY_IMMUTABLE' then raise; end if; end;
  -- Ordering across synthetic groups, including stable incident ID tie.
  for n in 1..3 loop
    i:=i||jsonb_build_object('incidentId','synthetic-order-'||n,'fingerprint','synthetic-order-'||n,'severity',case when n=1 then 'nonfatal' else 'fatal' end);
    perform public.ingest_coach_run_events(jsonb_set(push,'{incidents}',jsonb_build_array(i)));
  end loop;
  q:=public.coach_agent_queue(5);
  perform pg_temp.check_true(q->0->>'incidentId'='synthetic-order-2' and q->1->>'incidentId'='synthetic-order-3' and q->2->>'incidentId'='synthetic-order-1','fatal ordering and stable tie');
  -- Reset only transient rate-window data within this rollback transaction.
  delete from public.coach_agent_rate_windows where bucket='queue';
  for n in 1..60 loop perform pg_temp.check_true(public.coach_agent_rate_limit('queue'),'rate allowance'); end loop;
  perform pg_temp.check_true(not public.coach_agent_rate_limit('queue'),'rate denial');
  perform pg_temp.check_true(not has_function_privilege('anon','public.coach_agent_mutate(text,text,jsonb)','execute') and not has_function_privilege('authenticated','public.coach_agent_queue(integer)','execute'),'RPC privilege isolation');
end $$;
select 'PASS: synthetic lifecycle, recurrence, ordering, immutable history, rate limits and privilege assertions' as result;
rollback;
