begin; do $test$ declare p jsonb := '{"batchId":"synthetic-db-batch","status":"attention_required","counts":{"fatal":0,"nonfatal":1},"incidents":[{"incidentId":"synthetic-db-1","fingerprint":"synthetic-db-fingerprint","batchId":"synthetic-db-batch","accountId":"synthetic-account","occurredAt":"2026-09-05T10:00:00Z","severity":"nonfatal","scope":"contact","stage":"synthetic_verification","code":"SYNTHETIC_CHECK","title":"Synthetic verification","explanation":"A synthetic check completed.","impact":"No production processing was affected.","nextStep":"No action required.","action":"synthetic_check","continued":true}]}'::jsonb; r jsonb; begin
r:=public.ingest_coach_run_events(p);
if (r->>'incidentsNew')::int<>1 then raise exception 'first insert failed'; end if;
r:=public.ingest_coach_run_events(p);
if (r->>'incidentsNew')::int<>0 then raise exception 'idempotency failed'; end if;
update public.coach_run_event_problems set status='investigating',resolution_notes='Synthetic notes' where fingerprint='synthetic-db-fingerprint';
p:=jsonb_set(p,'{incidents,0,incidentId}','"synthetic-db-2"');
p:=jsonb_set(p,'{incidents,0,occurredAt}','"2026-09-04T10:00:00Z"');
r:=public.ingest_coach_run_events(p);
if not exists(select 1 from public.coach_run_event_problems where fingerprint='synthetic-db-fingerprint' and occurrence_count=2 and first_seen='2026-09-04T10:00:00Z' and last_seen='2026-09-05T10:00:00Z' and latest_incident_id='synthetic-db-1' and status='investigating' and resolution_notes='Synthetic notes') then raise exception 'recurrence ordering or status failed'; end if;
if has_function_privilege('anon','public.ingest_coach_run_events(jsonb)','EXECUTE') or has_function_privilege('authenticated','public.ingest_coach_run_events(jsonb)','EXECUTE') then raise exception 'public RPC access'; end if;
end $test$; rollback;
