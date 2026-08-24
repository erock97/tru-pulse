-- Roles on the Team tab. Proposed 2026-08-24 (Eric applies via the SQL editor).
--
-- Follow Up Boss reports every user on an account, so agent rows arrive for
-- people and things that are not agents: team leaders (Ana Caetano, a Synergy
-- leader, rode in under a personal email), admins, and pond/lead accounts
-- ("Iron 65"). The Team tab needs a one-time, leader-settable role so the
-- invite machinery knows who must never be mailed an agent login and an
-- assessment. Eric's role list, verbatim: team lead, admin, agent, pond agent.
--
-- The role changes INVITE behavior only. Excluding someone from Pulse/Coach/
-- Rep remains the existing "On the team" tick — orthogonal on purpose, since
-- a pond account's leads may still need to count while it never gets a login.

-- 1) The column. 'agent' is the default: that is what most FUB users are.
alter table agents
  add column if not exists role text not null default 'agent'
  check (role in ('agent', 'lead', 'admin', 'pond'));

-- 2) One-time backfill: anyone matching a leaders row for a team in their own
--    org (by email, or by normalized name — leaders often ride in under a
--    different email) starts as 'lead'. After this, the dropdown is the truth.
update agents a
set role = 'lead'
where a.role = 'agent'
  and exists (
    select 1
    from leaders l
    join teams lt on lt.id = l.team_id
    where lt.org_id = a.org_id
      and (
        lower(l.email) = lower(a.email)
        or lower(regexp_replace(l.name, '[^a-zA-Z0-9]+', ' ', 'g'))
           = lower(regexp_replace(a.name, '[^a-zA-Z0-9]+', ' ', 'g'))
      )
  );

-- 3) The setter, matching set_excluded's shape: SECURITY DEFINER, gated to
--    leaders/admins of the agent's own org, and it reports refusal (false)
--    rather than pretending the write happened.
create or replace function public.set_agent_role(p_agent_id uuid, p_role text)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  with u as (
    update agents a
    set role = p_role
    where a.id = p_agent_id
      and p_role in ('agent', 'lead', 'admin', 'pond')
      and (has_org_role(a.org_id, 'admin') or has_org_role(a.org_id, 'leader'))
    returning 1
  )
  select exists (select 1 from u);
$$;

revoke all on function public.set_agent_role(uuid, text) from public, anon;
grant execute on function public.set_agent_role(uuid, text) to authenticated;

-- 4) The Team tab's read learns the column. Return type changes, so the old
--    function is dropped first (see db/team_admin_roster.sql for its history).
drop function if exists public.team_admin_roster();

create function public.team_admin_roster()
returns table (
  id uuid,
  name text,
  email text,
  team_id uuid,
  team_name text,
  excluded boolean,
  coaching_enabled boolean,
  is_paused boolean,
  invited_at timestamptz,
  signed_in_at timestamptz,
  role text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    a.id,
    a.name,
    a.email,
    a.team_id,
    t.name as team_name,
    coalesce(a.excluded, false),
    coalesce(a.coaching_enabled, false),
    coalesce(a.is_paused, false),
    -- The invite mints the auth user, so its creation IS the first invite.
    case when a.auth_id is not null then u.created_at end as invited_at,
    u.last_sign_in_at,
    a.role
  from agents a
  join teams t on t.id = a.team_id
  left join auth.users u on u.id = a.auth_id
  where has_org_role(a.org_id, 'admin') or has_org_role(a.org_id, 'leader')
  order by a.name;
$$;

revoke all on function public.team_admin_roster() from public, anon;
grant execute on function public.team_admin_roster() to authenticated;
