-- Partial reports may be released only by an explicitly authorized receiver control.
-- Unknown coverage remains private/held. Existing immutable payload and audit rules remain unchanged.
create or replace function public.coach_receipt_control(p_team uuid,p_actor text,p_command jsonb,p_canonical text,p_allow_partial boolean default false) returns jsonb
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
  if r.coverage_state='unknown' then raise exception 'coverage_unknown'; end if;
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
  if r.publication='published' and replacement.coverage_state='unknown' then raise exception 'coverage_unknown'; end if;
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
