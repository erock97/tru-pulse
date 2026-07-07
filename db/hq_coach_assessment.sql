-- Coach assessment intake — cohort flag + gated public submit RPCs.
-- Idempotent + additive. Safe to run more than once. Depends on schema.sql
-- (agents/teams/memberships/is_org_member) AND hq_coach.sql (the assessments
-- table, including its not-null org_id column). Prerequisite columns are
-- guarded so this is self-contained.

-- ── Prerequisite columns (no-ops if earlier coach migrations already added them) ──
alter table teams  add column if not exists join_token    uuid default gen_random_uuid();
update teams set join_token = gen_random_uuid() where join_token is null;
alter table agents add column if not exists token         uuid default gen_random_uuid();
alter table agents add column if not exists personal_code text;

-- ── New for this feature ──
alter table agents add column if not exists coaching_enabled boolean not null default false;
alter table agents add column if not exists personal_axes    jsonb;
create index if not exists agents_coaching_idx on agents (team_id) where coaching_enabled;

-- Leader toggles cohort membership for an agent in their own org.
-- Reuses the vetted is_org_member(org_id) helper from schema.sql.
create or replace function set_coaching(p_agent_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update agents set coaching_enabled = p_on
   where id = p_agent_id and is_org_member(org_id);
  if not found then raise exception 'not authorized for this agent'; end if;
end $$;
grant execute on function set_coaching(uuid, boolean) to authenticated;

-- Public (anon): the cohort's pick-your-name list for a team link (names only).
create or replace function resolve_cohort_roster(p_token uuid)
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name) order by a.name), '[]'::json)
  from teams t join agents a on a.team_id = t.id
  where t.join_token = p_token and a.coaching_enabled;
$$;
grant execute on function resolve_cohort_roster(uuid) to anon, authenticated;

-- Public (anon): write a cohort member's assessment. NEVER creates agent rows;
-- requires the agent to be a coaching_enabled member of the team owning p_token.
create or replace function submit_cohort_assessment(
  p_token uuid, p_agent_id uuid, p_personal_code text, p_personal_axes jsonb,
  p_business_code text, p_tallies jsonb, p_answers jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare v_team_id uuid; v_org_id uuid;
begin
  select a.team_id, a.org_id into v_team_id, v_org_id
    from teams t join agents a on a.team_id = t.id
   where t.join_token = p_token and a.id = p_agent_id and a.coaching_enabled;
  if v_team_id is null then raise exception 'not a cohort member for this team'; end if;

  insert into assessments (
    org_id, team_id, agent_id, code, answers,
    energy_p, energy_t, approach_pro, approach_rec,
    deal_r, deal_v, decision_d, decision_i
  ) values (
    v_org_id, v_team_id, p_agent_id, p_business_code, p_answers,
    (p_tallies->>'energy_p')::int, (p_tallies->>'energy_t')::int,
    (p_tallies->>'approach_pro')::int, (p_tallies->>'approach_rec')::int,
    (p_tallies->>'deal_r')::int, (p_tallies->>'deal_v')::int,
    (p_tallies->>'decision_d')::int, (p_tallies->>'decision_i')::int
  );
  update agents set personal_code = p_personal_code, personal_axes = p_personal_axes
   where id = p_agent_id;

  return json_build_object('agent_id', p_agent_id, 'token', (select token from agents where id = p_agent_id));
end $$;
grant execute on function submit_cohort_assessment(uuid, uuid, text, jsonb, text, jsonb, jsonb) to anon, authenticated;
