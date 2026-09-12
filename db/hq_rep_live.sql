-- Review-only additive migration. Run only in an isolated database until approved.
-- Sessions are durable. No quiz/progress/certification tables are altered.
begin;
create table if not exists public.rep_live_sessions (
 id uuid primary key, day integer not null check(day between 1 and 4),
 title text not null, version text not null, timezone text not null,
 definition jsonb not null, created_by uuid not null references auth.users(id),
 presenter_ids uuid[] not null, roster jsonb not null,
 current_activity_id text, current_slide_id text, opened_activity_ids text[] not null default '{}',
 revealed_activity_ids text[] not null default '{}', groups jsonb not null default '[]',
 timer_ends_at timestamptz, status text not null default 'active' check(status in ('active','ended')),
 created_at timestamptz not null default now(), ended_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.rep_live_progress (
 session_id uuid not null references rep_live_sessions(id), agent_id uuid not null references agents(id),
 activity_id text not null, status text not null check(status in ('working','submitted')),
 help text check(help in ('finding-control','practice')), actions text[] not null default '{}', dirty boolean not null default true,
 help_resolved_count integer not null default 0, joined_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
 primary key(session_id,agent_id,activity_id)
);
alter table rep_live_sessions add column if not exists current_slide_id text;
alter table rep_live_progress add column if not exists help_resolved_count integer not null default 0;
create table if not exists public.rep_live_presence (
 session_id uuid not null references rep_live_sessions(id), agent_id uuid not null references agents(id),
 joined_at timestamptz not null default now(), last_seen_at timestamptz not null default clock_timestamp(),
 primary key(session_id,agent_id)
);
create table if not exists public.rep_live_attempts (
 id uuid primary key, session_id uuid not null references rep_live_sessions(id), agent_id uuid not null references agents(id),
 activity_id text not null, attempt integer not null, response jsonb not null,
 assisted boolean not null, grade jsonb, submitted_at timestamptz not null default clock_timestamp(),
 unique(session_id,agent_id,activity_id,attempt)
);
create index if not exists rep_live_attempts_session on rep_live_attempts(session_id,submitted_at);
create table if not exists public.rep_live_observations (
 id uuid primary key, session_id uuid not null references rep_live_sessions(id), group_id text not null,
 activity_id text not null, agent_id uuid not null references agents(id), observer_id uuid not null references auth.users(id),
 round integer not null check(round>0), criteria jsonb not null, correction text not null, retry text not null,
 coach_reviewed boolean not null default false, submitted_at timestamptz not null default clock_timestamp(),
 unique(session_id,group_id,observer_id)
);
-- Same assignment shape and UI as existing coaching assignments, durable for live work.
create table if not exists public.rep_live_followups (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references rep_live_sessions(id),
 agent_id uuid not null references agents(id), org_id uuid not null references orgs(id),
 coach_id uuid not null references auth.users(id), checkpoint integer not null check(checkpoint in (1,3,7)),
 due_date date not null, record jsonb not null, updated_at timestamptz not null default clock_timestamp(),
 unique(session_id,agent_id,checkpoint)
);
create index if not exists rep_live_followups_due on rep_live_followups(due_date,coach_id);
create table if not exists public.rep_live_digests (
 user_id uuid not null references auth.users(id), day date not null, status text not null check(status in ('sending','sent','failed')),
 idempotency_key text not null unique, recipient text not null, payload jsonb not null,
 attempts integer not null default 0, last_error text, provider_id text,
 updated_at timestamptz not null default clock_timestamp(), primary key(user_id,day)
);
-- Private predicates never depend on editable user metadata.
create or replace function public.rep_live_is_admin(p_actor uuid) returns boolean
 language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from admins where id=p_actor)
$$;
create or replace function public.rep_live_team_coach(p_actor uuid,p_org uuid,p_team uuid) returns boolean
 language sql stable security definer set search_path=public,pg_temp as $$
 select rep_live_is_admin(p_actor) or exists(select 1 from memberships m where m.user_id=p_actor and m.org_id=p_org
 and (m.role in ('admin','leader') or (m.role='coach' and exists(select 1 from coach_teams ct where ct.user_id=p_actor and ct.team_id=p_team))))
$$;
create or replace function public.rep_live_can_see(p_actor uuid,p_agent uuid) returns boolean
 language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from agents a where a.id=p_agent and (a.auth_id=p_actor or rep_live_team_coach(p_actor,a.org_id,a.team_id)))
$$;
-- Raw definitions include unrevealed coach examples. Do not grant client table access.
alter table rep_live_sessions enable row level security;
alter table rep_live_progress enable row level security;
alter table rep_live_presence enable row level security;
alter table rep_live_attempts enable row level security;
alter table rep_live_observations enable row level security;
alter table rep_live_followups enable row level security;
alter table rep_live_digests enable row level security;
revoke all on rep_live_sessions,rep_live_progress,rep_live_presence,rep_live_attempts,rep_live_observations,rep_live_followups,rep_live_digests from anon,authenticated;
grant all on rep_live_sessions,rep_live_progress,rep_live_presence,rep_live_attempts,rep_live_observations,rep_live_followups,rep_live_digests to service_role;
grant select on rep_live_progress,rep_live_presence,rep_live_attempts,rep_live_observations,rep_live_followups to authenticated;
drop policy if exists rep_live_progress_read on rep_live_progress;
create policy rep_live_progress_read on rep_live_progress for select to authenticated using(rep_live_can_see((select auth.uid()),agent_id));
drop policy if exists rep_live_presence_read on rep_live_presence;
create policy rep_live_presence_read on rep_live_presence for select to authenticated using(rep_live_can_see((select auth.uid()),agent_id));
drop policy if exists rep_live_attempts_read on rep_live_attempts;
create policy rep_live_attempts_read on rep_live_attempts for select to authenticated using(rep_live_can_see((select auth.uid()),agent_id));
drop policy if exists rep_live_observations_read on rep_live_observations;
create policy rep_live_observations_read on rep_live_observations for select to authenticated using(observer_id=(select auth.uid()) or rep_live_can_see((select auth.uid()),agent_id));
drop policy if exists rep_live_followups_read on rep_live_followups;
create policy rep_live_followups_read on rep_live_followups for select to authenticated using(rep_live_can_see((select auth.uid()),agent_id));

-- All writes enter through this service-only transaction after cookie validation.
-- Rechecking actor permissions inside the transaction avoids stale authorization.
create or replace function public.rep_live_mutate(p_actor uuid,p_session uuid,p_action text,p_body jsonb) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare s rep_live_sessions%rowtype; item jsonb; a agents%rowtype; own_agent uuid;
 is_presenter boolean; activity text; attempt_row rep_live_attempts%rowtype; obs rep_live_observations%rowtype;
 old_follow rep_live_followups%rowtype; roster jsonb:='[]'; coach uuid; group_row jsonb; n integer; result jsonb;
 t timestamptz:=clock_timestamp(); v_checkpoint integer; commitment text; v_record jsonb; due date;
begin
 if not exists(select 1 from auth.users where id=p_actor) then raise exception 'Not signed in'; end if;
 if p_action='create' then
  if not rep_live_is_admin(p_actor) then raise exception 'Only a global administrator can create sessions'; end if;
  if jsonb_array_length(p_body->'participants') not between 1 and 100 then raise exception 'Choose 1 to 100 participants'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_body->>'timezone') then raise exception 'Invalid timezone'; end if;
  for item in select * from jsonb_array_elements(p_body->'participants') loop
   select * into a from agents where id=(item->>'agentId')::uuid;
   if not found then raise exception 'Participant unavailable'; end if;
   coach:=(item->>'coachId')::uuid;
   if not rep_live_team_coach(coach,a.org_id,a.team_id) then raise exception 'Choose an authorized coach for each participant'; end if;
   if exists(select 1 from jsonb_array_elements(roster) r where r->>'agentId'=a.id::text) then raise exception 'Duplicate participant'; end if;
   roster:=roster||jsonb_build_array(jsonb_build_object('agentId',a.id,'userId',a.auth_id,'orgId',a.org_id,'teamId',a.team_id,
    'name',a.name,'teamName',(select name from teams where id=a.team_id),'coachId',coach,'coachName',(select coalesce(raw_user_meta_data->>'name',email,id::text) from auth.users where id=coach)));
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p_body->'presenterIds','[]')) loop
   coach:=(item#>>'{}')::uuid;
   if not rep_live_is_admin(coach) and not exists(select 1 from jsonb_array_elements(roster) r where rep_live_team_coach(coach,(r->>'orgId')::uuid,(r->>'teamId')::uuid)) then raise exception 'Presenter unavailable'; end if;
  end loop;
  insert into rep_live_sessions(id,day,title,version,timezone,definition,created_by,presenter_ids,roster,current_slide_id)
   values(p_session,(p_body->'definition'->>'day')::integer,p_body->'definition'->>'title',p_body->'definition'->>'version',p_body->>'timezone',p_body->'definition',p_actor,
    array(select distinct x from unnest(array[p_actor]||array(select (value#>>'{}')::uuid from jsonb_array_elements(coalesce(p_body->'presenterIds','[]')))) x),roster,p_body->'definition'->'slides'->0->>'id')
   on conflict(id) do nothing;
  select * into s from rep_live_sessions where id=p_session;
  if s.created_by<>p_actor or s.roster<>roster or s.definition<>p_body->'definition' then raise exception 'Session id already used'; end if;
  return jsonb_build_object('ok',true,'id',s.id);
 end if;
 select * into s from rep_live_sessions where id=p_session for update;
 if not found then raise exception 'Session unavailable'; end if;
 is_presenter:=rep_live_is_admin(p_actor) or (p_actor=any(s.presenter_ids) and exists(select 1 from jsonb_array_elements(s.roster) member where rep_live_team_coach(p_actor,(member->>'orgId')::uuid,(member->>'teamId')::uuid)));
 select learner.id into own_agent from agents learner join jsonb_array_elements(s.roster) r on r->>'agentId'=learner.id::text where learner.auth_id=p_actor limit 1;
 if not is_presenter and own_agent is null and not (p_action='followup' and exists(select 1 from rep_live_followups f where f.id=(p_body->>'id')::uuid and f.session_id=s.id and f.coach_id=p_actor and rep_live_can_see(p_actor,f.agent_id))) then raise exception 'Session unavailable'; end if;
 activity:=p_body->>'activityId';
 if p_action in ('open','slide','reveal','timer','group','end') and not is_presenter then raise exception 'Presenter access required'; end if;
 if p_action in ('open','slide','reveal','timer','group') and s.status='ended' then raise exception 'Session ended'; end if;
 if p_action in ('open','reveal','progress','submit') and not exists(select 1 from jsonb_array_elements(s.definition->'activities') x where x->>'id'=activity) then raise exception 'Unknown activity'; end if;
 if p_action in ('progress','submit') and not activity=any(s.opened_activity_ids) then raise exception 'Activity is not open'; end if;
 if p_action in ('join','progress','submit') and own_agent is null then raise exception 'Join as an assigned learner'; end if;
 if p_action='join' then
  insert into rep_live_presence(session_id,agent_id,last_seen_at) values(s.id,own_agent,t)
   on conflict(session_id,agent_id) do update set last_seen_at=excluded.last_seen_at;
 elsif p_action='slide' then
  if not exists(select 1 from jsonb_array_elements(s.definition->'slides') x where x->>'id'=p_body->>'slideId') then raise exception 'Unknown slide'; end if;
  activity:=(select x->'activity'->>'id' from jsonb_array_elements(s.definition->'slides') x where x->>'id'=p_body->>'slideId');
  update rep_live_sessions set current_slide_id=p_body->>'slideId',current_activity_id=activity,opened_activity_ids=case when activity is null then opened_activity_ids else array(select distinct x from unnest(opened_activity_ids||activity) x) end,timer_ends_at=null where id=s.id;
 elsif p_action='open' then
  update rep_live_sessions set current_activity_id=activity,current_slide_id=(select x->>'slideId' from jsonb_array_elements(s.definition->'activities') x where x->>'id'=activity),opened_activity_ids=array(select distinct x from unnest(opened_activity_ids||activity) x),timer_ends_at=null where id=s.id;
 elsif p_action='timer' then
  n:=(p_body->>'seconds')::integer; if n not between 0 and 7200 then raise exception 'Timer must be between 0 and 7200 seconds'; end if;
  update rep_live_sessions set timer_ends_at=case when n=0 then null else t+make_interval(secs=>n) end where id=s.id;
 elsif p_action='reveal' then
  if not activity=any(s.opened_activity_ids) then raise exception 'Open the activity first'; end if;
  update rep_live_sessions set revealed_activity_ids=array(select distinct x from unnest(revealed_activity_ids||activity) x) where id=s.id;
 elsif p_action='progress' then
  if p_body->>'status' not in ('working','submitted') or coalesce(p_body->>'help','') not in ('','finding-control','practice') then raise exception 'Invalid progress'; end if;
  if (p_body-'activityId'-'status'-'help'-'actions'-'dirty')<>'{}'::jsonb then raise exception 'Progress must not contain response text'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_body->'actions','[]')) x where x not in ('stage-saved','note-saved','task-saved','deal-saved')) then raise exception 'Invalid action metadata'; end if;
  insert into rep_live_progress(session_id,agent_id,activity_id,status,help,actions,dirty,updated_at)
   values(s.id,own_agent,activity,coalesce(p_body->>'status','working'),nullif(p_body->>'help',''),array(select jsonb_array_elements_text(coalesce(p_body->'actions','[]'))),coalesce((p_body->>'dirty')::boolean,true),t)
   on conflict(session_id,agent_id,activity_id) do update set status=case when p_body?'status' then excluded.status else rep_live_progress.status end,help=case when p_body?'help' then excluded.help else rep_live_progress.help end,actions=case when p_body?'actions' then excluded.actions else rep_live_progress.actions end,dirty=case when p_body?'dirty' then excluded.dirty else rep_live_progress.dirty end,help_resolved_count=rep_live_progress.help_resolved_count+case when p_body?'help' and nullif(p_body->>'help','') is null and rep_live_progress.help is not null then 1 else 0 end,updated_at=t;
 elsif p_action='submit' then
  select * into attempt_row from rep_live_attempts where id=(p_body->>'id')::uuid;
  if found then
   if attempt_row.session_id<>s.id or attempt_row.agent_id<>own_agent or attempt_row.activity_id<>activity or attempt_row.response<>p_body->'response' then raise exception 'Submission id already used'; end if;
   return jsonb_build_object('ok',true,'attempt',to_jsonb(attempt_row));
  end if;
  -- A repair audit must pass before the original record grader is used.
  if exists(select 1 from jsonb_array_elements(s.definition->'activities') x where x->>'id'=activity and x->>'scenario'='avery-repair')
   and coalesce(p_body->'response'->'submission'->>'phase','')<>'audit'
   and not exists(select 1 from rep_live_attempts r where r.session_id=s.id and r.agent_id=own_agent and r.activity_id=activity and r.response->'submission'->>'phase'='audit' and (r.grade->>'passed')::boolean) then raise exception 'Complete the record diagnosis first'; end if;
  select coalesce(max(attempt),0)+1 into n from rep_live_attempts where session_id=s.id and agent_id=own_agent and activity_id=activity;
  insert into rep_live_attempts(id,session_id,agent_id,activity_id,attempt,response,assisted,grade,submitted_at)
   values((p_body->>'id')::uuid,s.id,own_agent,activity,n,p_body->'response',activity=any(s.revealed_activity_ids),nullif(p_body->'grade','null'),t) returning * into attempt_row;
  insert into rep_live_progress(session_id,agent_id,activity_id,status,dirty,updated_at) values(s.id,own_agent,activity,case when p_body->'response'->'submission'->>'phase'='audit' then 'working' else 'submitted' end,false,t)
   on conflict(session_id,agent_id,activity_id) do update set status=excluded.status,dirty=false,updated_at=t;
  result:=jsonb_build_object('ok',true,'attempt',to_jsonb(attempt_row));
 elsif p_action='group' then
  group_row:=p_body->'group'; activity:=group_row->>'activityId';
  if coalesce(group_row->>'id','')='' or (group_row->>'round')::integer<1 or not activity=any(s.opened_activity_ids) then raise exception 'Invalid practice group'; end if;
  if not exists(select 1 from jsonb_array_elements(s.definition->'activities') x where x->>'id'=activity and x->>'kind'='roleplay') then raise exception 'Choose a roleplay activity'; end if;
  for item in select * from jsonb_array_elements(jsonb_build_array(group_row->'agentId',group_row->'buyerId',group_row->'observerId')) loop
   if item<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(s.roster) r where r->>'agentId'=item#>>'{}') then raise exception 'Group member not assigned'; end if;
  end loop;
  if group_row->>'agentId' is null or group_row->>'agentId'=group_row->>'buyerId' or group_row->>'agentId'=group_row->>'observerId' then raise exception 'Each speaker needs a different observer'; end if;
  if nullif(group_row->>'coachId','') is not null and not ((group_row->>'coachId')::uuid=any(s.presenter_ids) or rep_live_is_admin((group_row->>'coachId')::uuid)) then raise exception 'Coach must be a presenter'; end if;
  if exists(select 1 from rep_live_observations where session_id=s.id and group_id=group_row->>'id') and group_row is distinct from (select g from jsonb_array_elements(s.groups) g where g->>'id'=group_row->>'id') then raise exception 'Start a new round to change an observed group'; end if;
  update rep_live_sessions set groups=coalesce((select jsonb_agg(g) from jsonb_array_elements(groups) g where g->>'id'<>group_row->>'id'),'[]')||jsonb_build_array(group_row) where id=s.id;
 elsif p_action='observe' then
  group_row:=(select g from jsonb_array_elements(s.groups) g where g->>'id'=p_body->>'groupId');
  if group_row is null then raise exception 'Practice group unavailable'; end if;
  if (is_presenter or group_row->>'coachId'=p_actor::text or coalesce(group_row->>'observerId',group_row->>'buyerId')=own_agent::text) is not true then raise exception 'Only the assigned observer may submit feedback'; end if;
  if (is_presenter or group_row->>'coachId'=p_actor::text) and not rep_live_can_see(p_actor,(group_row->>'agentId')::uuid) then raise exception 'Coach cannot review this team'; end if;
  if length(trim(coalesce(p_body->>'correction',''))) not between 1 and 1200 or length(trim(coalesce(p_body->>'retry',''))) not between 1 and 1200 then raise exception 'Feedback too long'; end if;
  if jsonb_typeof(p_body->'criteria')<>'object' or exists(select 1 from jsonb_each(p_body->'criteria') e where jsonb_typeof(e.value)<>'boolean' or not exists(select 1 from jsonb_array_elements(s.definition->'activities') ac,jsonb_array_elements(ac->'rubric') rub where ac->>'id'=group_row->>'activityId' and rub->>'id'=e.key)) then raise exception 'Invalid observation criteria'; end if;
  select * into obs from rep_live_observations where session_id=s.id and group_id=group_row->>'id' and observer_id=p_actor;
  if found then
   if obs.criteria=p_body->'criteria' and obs.correction=coalesce(p_body->>'correction','') and obs.retry=coalesce(p_body->>'retry','') then return jsonb_build_object('ok',true); else raise exception 'Create a new round for another observation'; end if;
  end if;
  insert into rep_live_observations(id,session_id,group_id,activity_id,agent_id,observer_id,round,criteria,correction,retry,coach_reviewed,submitted_at)
   values((p_body->>'id')::uuid,s.id,group_row->>'id',group_row->>'activityId',(group_row->>'agentId')::uuid,p_actor,(group_row->>'round')::integer,
    p_body->'criteria',coalesce(p_body->>'correction',''),coalesce(p_body->>'retry',''),is_presenter,t)
   on conflict(id) do nothing returning * into obs;
  if not found then select * into obs from rep_live_observations where id=(p_body->>'id')::uuid;
   if obs.session_id<>s.id or obs.observer_id<>p_actor or obs.group_id<>group_row->>'id' or obs.criteria<>p_body->'criteria' or obs.correction<>coalesce(p_body->>'correction','') or obs.retry<>coalesce(p_body->>'retry','') then raise exception 'Observation id already used'; end if;
  end if;
 elsif p_action='end' then
  if s.status='ended' then return jsonb_build_object('ok',true); end if;
  for item in select * from jsonb_array_elements(s.roster) loop
   foreach v_checkpoint in array array[1,3,7] loop
    commitment:=case v_checkpoint when 1 then 'Recall and retry the workshop skill without the example visible. Name the correction still needed.' when 3 then 'Try a different case and describe how you adapted the skill. Your coach will review the transfer.' else 'Bring one relevant real-work example to your coach. If no client opportunity occurred, complete another practice case and mark application not yet observed.' end;
    if v_checkpoint in (1,3) then
     commitment:=commitment||case s.day
      when 1 then case v_checkpoint when 1 then ' Fresh case: Morgan confirms a Saturday 11 a.m. showing. Describe where you would find the contact and the saved record actions you would complete before moving on.' else ' Fresh case: Taylor answered your call, confirmed a later move, and agreed to another call next Tuesday. Explain the record you would leave, who owns the next action, and the evidence you would discuss with your coach before considering nurture.' end
      when 2 then case v_checkpoint when 1 then ' Fresh case: Alex asks to see a home after work. Write your four-part introduction and the invitation you would actually use.' else ' Fresh case: Sam wants to see a property that is under contract. Write the truthful response and what is still possible, then explain why you chose the phone.' end
      when 3 then case v_checkpoint when 1 then ' Fresh case: Casey liked the location but felt the home was too noisy. Write your next question and what you need to learn.' else ' Fresh case: Drew rejects the homes you selected despite matching the original list. Ask a follow-up, record the preference you learned, and explain how it changes the next tour.' end
      else case v_checkpoint when 1 then ' Fresh case: Lee wants to compare options with a lender already in place. Write a buyer-specific offer of help and a genuine permission question.' else ' Fresh case: Robin accepts a lender introduction but nobody has confirmed the next step. Write the follow-up, identify the owner, and avoid promising an approval outcome.' end end;
    end if;
    due:=(t at time zone s.timezone)::date+v_checkpoint;
    v_record:=jsonb_build_object('agentId',item->>'agentId','orgId',item->>'orgId','createdBy',p_actor,'createdAt',t,'commitment',commitment,'moduleId',null,'moduleTitle',s.title,'dueDate',due,
     'practiceAt',null,'reflection','','reviewedAt',null,'reviewNote','','outcome',null,'passedAt',null,'trainingPassed',false,'history','[]'::jsonb,
     'sessionId',s.id,'skillId','day-'||s.day,'coachId',item->>'coachId','coachName',coalesce(item->>'coachName',(select coalesce(raw_user_meta_data->>'name',email,id::text) from auth.users where id=(item->>'coachId')::uuid)),'timezone',s.timezone,'checkpoint',v_checkpoint,'applicationObserved',null);
    insert into rep_live_followups(session_id,agent_id,org_id,coach_id,checkpoint,due_date,record)
     values(s.id,(item->>'agentId')::uuid,(item->>'orgId')::uuid,(item->>'coachId')::uuid,v_checkpoint,due,v_record) on conflict(session_id,agent_id,checkpoint) do nothing;
   end loop;
  end loop;
  update rep_live_sessions set status='ended',ended_at=t,timer_ends_at=null where id=s.id;
 elsif p_action='followup' then
  select * into old_follow from rep_live_followups where id=(p_body->>'id')::uuid and session_id=s.id for update;
  if not found or not rep_live_can_see(p_actor,old_follow.agent_id) then raise exception 'Assignment unavailable'; end if;
  v_record:=old_follow.record;
  if p_body->>'action'='review' and v_record->>'reviewedBy'=p_actor::text and v_record->>'outcome'=p_body->>'outcome' and v_record->>'reviewNote'=p_body->>'reviewNote' and v_record->'applicationObserved' is not distinct from coalesce(p_body->'applicationObserved','null'::jsonb) and (p_body->>'outcome'<>'continue' or v_record->>'dueDate'=p_body->>'dueDate') then return jsonb_build_object('ok',true,'patch',v_record); end if;
  if coalesce(v_record->>'outcome','') in ('complete','cancelled') then raise exception 'Assignment already closed'; end if;
  if p_body->>'action'='practice' then
   if own_agent<>old_follow.agent_id or own_agent is null then raise exception 'Only the assigned learner can submit practice'; end if;
   if length(trim(coalesce(p_body->>'reflection',''))) not between 1 and 1200 then raise exception 'Describe practice in up to 1200 characters'; end if;
   if v_record->>'reflection'=p_body->>'reflection' and coalesce(v_record->>'practiceAt','')>coalesce(v_record->>'reviewedAt','') then return jsonb_build_object('ok',true,'patch',v_record); end if;
   v_record:=v_record||jsonb_build_object('practiceAt',t,'reflection',p_body->>'reflection','applicationObserved',null);
   v_record:=jsonb_set(v_record,'{history}',coalesce(v_record->'history','[]')||jsonb_build_array(jsonb_build_object('kind','practice','at',t,'reflection',p_body->>'reflection')));
  elsif p_body->>'action'='review' then
   if p_actor<>old_follow.coach_id and not rep_live_is_admin(p_actor) then raise exception 'Named coach review required'; end if;
   if p_body->>'outcome' not in ('complete','continue','cancelled') or length(trim(coalesce(p_body->>'reviewNote',''))) not between 1 and 1200 then raise exception 'Choose an outcome and add a review note'; end if;
   if p_body?'applicationObserved' and jsonb_typeof(p_body->'applicationObserved') not in ('boolean','null') then raise exception 'Invalid application observation'; end if;
   due:=case when p_body->>'outcome'='continue' then (p_body->>'dueDate')::date else old_follow.due_date end;
   if due is null then raise exception 'Next date required'; end if;
   v_record:=v_record||jsonb_build_object('reviewedAt',t,'reviewedBy',p_actor,'reviewNote',p_body->>'reviewNote','outcome',p_body->>'outcome','dueDate',due,'applicationObserved',p_body->'applicationObserved');
   v_record:=jsonb_set(v_record,'{history}',coalesce(v_record->'history','[]')||jsonb_build_array(jsonb_build_object('kind','review','at',t,'reviewNote',p_body->>'reviewNote','outcome',p_body->>'outcome','dueDate',due,'previousDueDate',old_follow.due_date)));
  else raise exception 'Unknown assignment action'; end if;
  update rep_live_followups set record=v_record||jsonb_build_object('id',old_follow.id),due_date=coalesce(due,old_follow.due_date),updated_at=t where id=old_follow.id;
  result:=jsonb_build_object('ok',true,'patch',v_record||jsonb_build_object('id',old_follow.id));
 else raise exception 'Unknown session action'; end if;
 update rep_live_sessions set updated_at=t where id=s.id;
 return coalesce(result,jsonb_build_object('ok',true));
end $$;

-- Service-only read checks session membership, then returns only authorized rows.
drop function if exists public.rep_live_read(uuid,uuid);
create or replace function public.rep_live_read(p_actor uuid,p_session uuid,p_cursor text default null) returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s rep_live_sessions%rowtype; own_agent uuid; presenting boolean;
begin
 select * into s from rep_live_sessions where id=p_session;
 if not found then raise exception 'Session unavailable'; end if;
 select learner.id into own_agent from agents learner join jsonb_array_elements(s.roster) r on r->>'agentId'=learner.id::text where learner.auth_id=p_actor limit 1;
 presenting:=rep_live_is_admin(p_actor) or (p_actor=any(s.presenter_ids) and exists(select 1 from jsonb_array_elements(s.roster) member where rep_live_team_coach(p_actor,(member->>'orgId')::uuid,(member->>'teamId')::uuid)));
 if not presenting and own_agent is null then raise exception 'Session unavailable'; end if;
 if p_cursor is not null and p_cursor::timestamptz=s.updated_at then return jsonb_build_object('unchanged',true,'cursor',s.updated_at,'serverTime',clock_timestamp()); end if;
 return jsonb_build_object('session',to_jsonb(s),'myAgentId',own_agent,'canPresent',presenting,
  'participants',coalesce((select jsonb_agg(r||jsonb_build_object('joinedAt',p.joined_at,'lastSeenAt',p.last_seen_at,'coachName',coalesce(r->>'coachName',(select coalesce(raw_user_meta_data->>'name',email,id::text) from auth.users where id=(r->>'coachId')::uuid)))) from jsonb_array_elements(s.roster) r left join rep_live_presence p on p.session_id=s.id and p.agent_id=(r->>'agentId')::uuid where rep_live_can_see(p_actor,(r->>'agentId')::uuid)),'[]'),
  'progress',coalesce((select jsonb_agg(to_jsonb(x)) from rep_live_progress x where x.session_id=s.id and rep_live_can_see(p_actor,x.agent_id)),'[]'),
  'attempts',coalesce((select jsonb_agg(to_jsonb(x) order by x.submitted_at) from rep_live_attempts x where x.session_id=s.id and rep_live_can_see(p_actor,x.agent_id)),'[]'),
  'observations',coalesce((select jsonb_agg(to_jsonb(x)) from rep_live_observations x where x.session_id=s.id and (x.observer_id=p_actor or rep_live_can_see(p_actor,x.agent_id))),'[]'),
  'followups',coalesce((select jsonb_agg(x.record||jsonb_build_object('id',x.id)) from rep_live_followups x where x.session_id=s.id and rep_live_can_see(p_actor,x.agent_id)),'[]'));
end $$;
create or replace function public.rep_live_list(p_actor uuid) returns jsonb
 language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'day',s.day,'title',s.title,'version',s.version,'timezone',s.timezone,'status',s.status,'createdAt',s.created_at,'endedAt',s.ended_at,'currentActivityId',s.current_activity_id,'currentSlideId',s.current_slide_id,'presenterIds',s.presenter_ids,'canPresent',rep_live_is_admin(p_actor) or (p_actor=any(s.presenter_ids) and exists(select 1 from jsonb_array_elements(s.roster) member where rep_live_team_coach(p_actor,(member->>'orgId')::uuid,(member->>'teamId')::uuid)))) order by s.created_at desc),'[]')
 from rep_live_sessions s where rep_live_is_admin(p_actor) or (p_actor=any(s.presenter_ids) and exists(select 1 from jsonb_array_elements(s.roster) member where rep_live_team_coach(p_actor,(member->>'orgId')::uuid,(member->>'teamId')::uuid))) or exists(select 1 from agents a join jsonb_array_elements(s.roster) r on r->>'agentId'=a.id::text where a.auth_id=p_actor)
$$;
revoke all on function rep_live_is_admin(uuid),rep_live_team_coach(uuid,uuid,uuid),rep_live_can_see(uuid,uuid),rep_live_mutate(uuid,uuid,text,jsonb),rep_live_read(uuid,uuid,text),rep_live_list(uuid) from public,anon,authenticated;
grant execute on function rep_live_can_see(uuid,uuid) to authenticated;
grant execute on function rep_live_is_admin(uuid),rep_live_team_coach(uuid,uuid,uuid),rep_live_can_see(uuid,uuid),rep_live_mutate(uuid,uuid,text,jsonb),rep_live_read(uuid,uuid,text),rep_live_list(uuid) to service_role;
-- Preflight is a private admin inventory; login links do not grant session membership.
create or replace function public.rep_live_preflight(p_actor uuid) returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not rep_live_is_admin(p_actor) then return jsonb_build_object('canCreate',false,'agents','[]'::jsonb,'coaches','[]'::jsonb); end if;
 return jsonb_build_object('canCreate',true,
 'agents',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'orgId',a.org_id,'teamId',a.team_id,'teamName',t.name,'userId',a.auth_id,'email',a.email) order by t.name,a.name) from agents a join teams t on t.id=a.team_id where t.is_active),'[]'),
 'coaches',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'orgId',x.org_id)) from (
 select u.id,coalesce(u.raw_user_meta_data->>'name',u.email,u.id::text) as name,m.org_id from memberships m join auth.users u on u.id=m.user_id where m.role in ('leader','admin','coach')
 union select u.id,coalesce(u.raw_user_meta_data->>'name',u.email,u.id::text),null::uuid from admins a join auth.users u on u.id=a.id) x),'[]'));
end $$;
revoke all on function rep_live_preflight(uuid) from public,anon,authenticated;
grant execute on function rep_live_preflight(uuid) to service_role;

-- Lease the daily email once. Frozen payload + provider idempotency covers crashes.
create or replace function public.rep_live_digest_claim(p_user uuid,p_day date,p_email text,p_payload jsonb) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare r rep_live_digests%rowtype;
begin
 insert into rep_live_digests(user_id,day,status,idempotency_key,recipient,payload)
 values(p_user,p_day,'failed','rep-live:'||p_user||':'||p_day,p_email,p_payload) on conflict(user_id,day) do nothing;
 select * into r from rep_live_digests where user_id=p_user and day=p_day for update;
 if r.attempts=0 and r.recipient='' then update rep_live_digests set recipient=p_email,payload=p_payload where user_id=p_user and day=p_day returning * into r; end if;
 if r.status='sent' or (r.status='sending' and r.updated_at>clock_timestamp()-interval '10 minutes') or r.attempts>=8 then return null; end if;
 update rep_live_digests set status='sending',attempts=attempts+1,updated_at=clock_timestamp() where user_id=p_user and day=p_day returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function rep_live_digest_claim(uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function rep_live_digest_claim(uuid,date,text,jsonb) to service_role;

create or replace function public.rep_live_digest_lookup_failure(p_user uuid,p_day date,p_message text) returns void
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into rep_live_digests(user_id,day,status,idempotency_key,recipient,payload,last_error)
 values(p_user,p_day,'failed','rep-live:'||p_user||':'||p_day,'','{}',left(p_message,500))
 on conflict(user_id,day) do update set last_error=excluded.last_error,updated_at=clock_timestamp() where rep_live_digests.status<>'sent';
end $$;
revoke all on function rep_live_digest_lookup_failure(uuid,date,text) from public,anon,authenticated;
grant execute on function rep_live_digest_lookup_failure(uuid,date,text) to service_role;
commit;
