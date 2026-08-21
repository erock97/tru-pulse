-- The one read behind the Team tab. Applied to production 2026-08-21.
--
-- Two things make it necessary rather than "another agents select":
--
--  1. Every other roster read in the product filters `excluded=eq.false`.
--     That is right for them and exactly wrong here — this is the screen where
--     a leader decides who is excluded, so the hidden people are the point.
--
--  2. `agents.auth_id` is stamped the moment an invite is minted (see the
--     worker's /rep/invite: mintAuthLink creates the login, then the row is
--     updated). So auth_id has always meant "invited", never "arrived". The
--     only truthful source for arrival is auth.users.last_sign_in_at, which is
--     not reachable under RLS — hence SECURITY DEFINER.
--
-- Gated to leaders and admins of the agent's own org, matching set_excluded():
-- anyone who can see a row here can act on it. Verified against production:
-- the Costigan leader sees their 13 (including 3 already hidden) and nobody
-- else's; a plain agent with a login sees 0.

create or replace function public.team_admin_roster()
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
  signed_in_at timestamptz
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
    u.last_sign_in_at
  from agents a
  join teams t on t.id = a.team_id
  left join auth.users u on u.id = a.auth_id
  where has_org_role(a.org_id, 'admin') or has_org_role(a.org_id, 'leader')
  order by a.name;
$$;

revoke all on function public.team_admin_roster() from public, anon;
grant execute on function public.team_admin_roster() to authenticated;
