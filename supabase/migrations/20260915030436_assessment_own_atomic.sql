-- Agent-owned writes stay subject to RLS. No service-role bypass or membership grants.
alter table public.assessments add column if not exists submission_id uuid;
create unique index if not exists assessments_agent_submission_idx
  on public.assessments(agent_id, submission_id) where submission_id is not null;

create policy assessments_self_insert on public.assessments for insert to authenticated
with check (exists (select 1 from public.agents a where a.id = agent_id
  and a.auth_id = auth.uid() and a.org_id = assessments.org_id and a.team_id = assessments.team_id));
create policy agents_self_profile_update on public.agents for update to authenticated
using (auth_id = auth.uid()) with check (auth_id = auth.uid());

-- RLS restricts rows; this guard restricts columns for agents without leader membership.
-- It also applies to direct REST writes, so the new policy cannot edit role/team/access.
create or replace function public.guard_agent_self_profile_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and not public.is_org_member(old.org_id) then
    if old.auth_id is distinct from auth.uid()
       or (to_jsonb(new) - array['personal_code','personal_axes'])
          is distinct from (to_jsonb(old) - array['personal_code','personal_axes']) then
      raise exception 'Only your assessment profile can be updated' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_agent_self_profile_update() from public, anon;
create trigger guard_agent_self_profile_update before update on public.agents
for each row execute function public.guard_agent_self_profile_update();

create or replace function public.submit_own_assessment(p_agent_id uuid, p_submission_id uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.agents%rowtype; existing public.assessments%rowtype; result_id uuid; k text;
begin
  if auth.uid() is null then raise exception 'Sign in to save' using errcode = '42501'; end if;
  select * into a from public.agents where id = p_agent_id and auth_id = auth.uid() for update;
  if not found then raise exception 'Not your agent account' using errcode = '42501'; end if;
  if p_submission_id is null then raise exception 'Submission ID required'; end if;
  if coalesce(p_result->>'personalCode','') !~ '^[PT]-(Pro|Rec)-[RV]-[DI]$'
     or coalesce(p_result->>'businessCode','') !~ '^[PT]-(Pro|Rec)-[RV]-[DI]$'
     or jsonb_typeof(p_result->'personalAxes') is distinct from 'object'
     or jsonb_typeof(p_result->'answers'->'personal') is distinct from 'array'
     or jsonb_typeof(p_result->'answers'->'pro') is distinct from 'array' then
    raise exception 'Incomplete assessment';
  end if;
  if jsonb_array_length(p_result->'answers'->'personal') <> 20
     or jsonb_array_length(p_result->'answers'->'pro') <> 32 then raise exception 'Incomplete answers'; end if;
  if exists(select 1 from jsonb_array_elements(p_result->'answers'->'personal') v where v::text !~ '^(-[123]|[0123])$')
     or exists(select 1 from jsonb_array_elements(p_result->'answers'->'pro') v where v::text !~ '^[0-5]$') then
    raise exception 'Invalid answers';
  end if;
  foreach k in array array['energy_p','energy_t','approach_pro','approach_rec','deal_r','deal_v','decision_d','decision_i'] loop
    if coalesce(p_result->'tallies'->>k,'') !~ '^[0-9]{1,3}$'
       or (p_result->'tallies'->>k)::int > 100 then raise exception 'Invalid scores'; end if;
  end loop;
  select * into existing from public.assessments where agent_id=p_agent_id and submission_id=p_submission_id;
  if found then
    if existing.answers is distinct from p_result->'answers' or existing.code is distinct from p_result->>'businessCode' then
      raise exception 'Submission ID already used';
    end if;
    return jsonb_build_object('id',existing.id); -- A lost response must not create a duplicate or roll back a newer profile.
  end if;
  insert into public.assessments(org_id,team_id,agent_id,submission_id,code,answers,
    energy_p,energy_t,approach_pro,approach_rec,deal_r,deal_v,decision_d,decision_i)
  values(a.org_id,a.team_id,a.id,p_submission_id,p_result->>'businessCode',p_result->'answers',
    (p_result->'tallies'->>'energy_p')::int,(p_result->'tallies'->>'energy_t')::int,
    (p_result->'tallies'->>'approach_pro')::int,(p_result->'tallies'->>'approach_rec')::int,
    (p_result->'tallies'->>'deal_r')::int,(p_result->'tallies'->>'deal_v')::int,
    (p_result->'tallies'->>'decision_d')::int,(p_result->'tallies'->>'decision_i')::int) returning id into result_id;
  update public.agents set personal_code=p_result->>'personalCode',personal_axes=p_result->'personalAxes' where id=a.id;
  if not found then raise exception 'Profile did not save'; end if;
  return jsonb_build_object('id',result_id);
end $$;
revoke all on function public.submit_own_assessment(uuid,uuid,jsonb) from public, anon;
grant execute on function public.submit_own_assessment(uuid,uuid,jsonb) to authenticated;
