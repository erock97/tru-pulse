create or replace function public.coach_problem_version() returns trigger language plpgsql security invoker set search_path='' as $$
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


create or replace function public.coach_problem_audit() returns trigger language plpgsql security invoker set search_path='' as $$
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
