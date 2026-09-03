-- The Team tab shows each person's phone next to their email. Both come from
-- Follow Up Boss on the same sync (see worker/src/sync.ts — agents.phone has
-- been stocked since the beginning); this just lets the tab's one read return
-- it. Return type changes, so the old function is dropped first (its history:
-- db/team_admin_roster.sql, then db/hq_agent_roles.sql).

drop function if exists public.team_admin_roster();

create function public.team_admin_roster()
returns table (
  id uuid,
  name text,
  email text,
  phone text,
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
    a.phone,
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
