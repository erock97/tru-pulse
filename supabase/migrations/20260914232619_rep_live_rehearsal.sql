-- Test evidence lives on the empty-roster session, never in agent/coaching tables.
alter table public.rep_live_sessions add column if not exists rehearsal_evidence jsonb not null default '{}';

create or replace function public.rep_live_rehearse(p_actor uuid,p_session uuid,p_action text,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 s rep_live_sessions%rowtype; e jsonb; item jsonb; old_item jsonb; g jsonb;
 activity text:=p_body->>'activityId'; t timestamptz:=clock_timestamp(); result jsonb:='{"ok":true}'; n integer;
begin
 select * into s from rep_live_sessions where id=p_session for update;
 if not found or not rep_live_is_admin(p_actor) or s.day<>2 or s.roster<>'[]'::jsonb then raise exception 'Rehearsal access required'; end if;
 e:=s.rehearsal_evidence;
 if s.status='ended' then raise exception 'Session ended'; end if;
 if p_action in ('submit','progress') and not activity=any(s.opened_activity_ids) then raise exception 'Activity is not open'; end if;
 if p_action in ('submit','progress') and not exists(select 1 from jsonb_array_elements(s.definition->'activities') a where a->>'id'=activity) then raise exception 'Unknown activity'; end if;
 if p_action='join' then
  e:=e||jsonb_build_object('joinedAt',coalesce(e->>'joinedAt',t::text),'lastSeenAt',t);
 elsif p_action='submit' then
  select a into old_item from jsonb_array_elements(coalesce(e->'attempts','[]')) a where a->>'id'=p_body->>'id';
  if old_item is not null then
   if old_item->>'activity_id'<>activity or old_item->'response'<>p_body->'response' then raise exception 'Submission id already used'; end if;
   return jsonb_build_object('ok',true,'attempt',old_item);
  end if;
  select count(*)+1 into n from jsonb_array_elements(coalesce(e->'attempts','[]')) a where a->>'activity_id'=activity;
  item:=jsonb_build_object('id',(p_body->>'id')::uuid,'agent_id',s.id,'activity_id',activity,'attempt',n,'response',p_body->'response','grade',p_body->'grade','assisted',activity=any(s.revealed_activity_ids),'submitted_at',t);
  e:=e||jsonb_build_object('attempts',coalesce(e->'attempts','[]')||jsonb_build_array(item));
  result:=jsonb_build_object('ok',true,'attempt',item);
  item:=jsonb_build_object('agent_id',s.id,'activity_id',activity,'status','submitted','dirty',false,'actions','[]'::jsonb,'help',null,'updated_at',t);
  e:=e||jsonb_build_object('progress',coalesce((select jsonb_agg(a) from jsonb_array_elements(coalesce(e->'progress','[]')) a where a->>'activity_id'<>activity),'[]')||jsonb_build_array(item));
 elsif p_action='progress' then
  if p_body->>'status' not in ('working','submitted') or coalesce(p_body->>'help','') not in ('','finding-control','practice') then raise exception 'Invalid progress'; end if;
  select a into old_item from jsonb_array_elements(coalesce(e->'progress','[]')) a where a->>'activity_id'=activity;
  item:=coalesce(old_item,jsonb_build_object('status','working','dirty',false,'actions','[]'::jsonb,'help',null))||
   (p_body-'activityId')||jsonb_build_object('agent_id',s.id,'activity_id',activity,'updated_at',t);
  e:=e||jsonb_build_object('progress',coalesce((select jsonb_agg(a) from jsonb_array_elements(coalesce(e->'progress','[]')) a where a->>'activity_id'<>activity),'[]')||jsonb_build_array(item));
 elsif p_action='group' then
  g:=p_body->'group';
  if g->>'agentId'<>s.id::text or nullif(g->>'buyerId','') is not null or nullif(g->>'observerId','') is not null then raise exception 'Solo rehearsal uses the test learner and presenter'; end if;
  if not exists(select 1 from jsonb_array_elements(s.definition->'activities') a where a->>'id'=g->>'activityId') or (g->>'round')::integer not between 1 and 10 then raise exception 'Invalid group'; end if;
  perform (g->>'id')::uuid;
  g:=g||jsonb_build_object('coachId',p_actor);
  e:=e||jsonb_build_object('groups',coalesce((select jsonb_agg(a) from jsonb_array_elements(coalesce(e->'groups','[]')) a where a->>'id'<>g->>'id'),'[]')||jsonb_build_array(g));
 elsif p_action='observe' then
  select a into g from jsonb_array_elements(coalesce(e->'groups','[]')) a where a->>'id'=p_body->>'groupId';
  if g is null then raise exception 'Group unavailable'; end if;
  if length(trim(coalesce(p_body->>'correction',''))) not between 1 and 1200 or length(trim(coalesce(p_body->>'retry',''))) not between 1 and 1200 then raise exception 'Add feedback and retry notes (up to 1200 characters)'; end if;
  if p_body->'speakingObserved' is distinct from 'true'::jsonb then raise exception 'Confirm you observed this learner speak'; end if;
  if jsonb_typeof(p_body->'criteria') is distinct from 'object' or exists(select 1 from jsonb_each(p_body->'criteria') c where jsonb_typeof(c.value)<>'boolean' or not exists(select 1 from jsonb_array_elements(s.definition->'activities') a,jsonb_array_elements(a->'rubric') r where a->>'id'=g->>'activityId' and r->>'id'=c.key)) then raise exception 'Invalid observation criteria'; end if;
  item:=jsonb_build_object('id',(p_body->>'id')::uuid,'group_id',g->>'id','activity_id',g->>'activityId','agent_id',s.id,'observer_id',p_actor,'round',g->'round','criteria',coalesce(p_body->'criteria','{}'),'correction',p_body->>'correction','retry',p_body->>'retry','speaking_observed',coalesce((p_body->>'speakingObserved')::boolean,false),'retry_observed',coalesce((p_body->>'retryObserved')::boolean,false),'coach_reviewed',true,'submitted_at',t);
  e:=e||jsonb_build_object('observations',coalesce((select jsonb_agg(a) from jsonb_array_elements(coalesce(e->'observations','[]')) a where a->>'id'<>item->>'id'),'[]')||jsonb_build_array(item));
 else raise exception 'Unknown rehearsal action'; end if;
 update rep_live_sessions set rehearsal_evidence=e,updated_at=t where id=s.id;
 return result;
end $$;
revoke all on function public.rep_live_rehearse(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rep_live_rehearse(uuid,uuid,text,jsonb) to service_role;
