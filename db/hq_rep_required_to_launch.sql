-- "Required to launch" — Eric's designation that a track should be finished before
-- an agent takes leads. Idempotent + additive. Depends on hq_rep_library.sql.
--
-- WHY THE TRACK, NOT THE MODULE: rep_tracks already groups the Zillow Preferred
-- onboarding set as a unit, and rep_track_modules already carries a per-module
-- `required` meaning "required WITHIN this track". A second module-level column
-- would collide with that name while meaning something else entirely.
--
-- DISPLAY ONLY. Nothing in the product gates on it — whether an agent is eligible
-- to take leads is settled between Eric and the team lead off-platform. Agents see
-- a badge; nothing is locked.
alter table rep_tracks add column if not exists required_to_launch boolean not null default false;

update rep_tracks set required_to_launch = true
 where slug = 'zillow-preferred-onboarding' and required_to_launch = false;

-- Leader/admin toggles it. Shared TRU tracks (org_id null) are the curriculum, so
-- only a platform admin may re-designate those; a team lead owns their org's own.
create or replace function set_track_required(p_track_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from rep_tracks where id = p_track_id;
  if not found then raise exception 'no such track'; end if;
  if v_org is null then
    if not exists (select 1 from admins where id = auth.uid()) then
      raise exception 'not authorized for the shared curriculum';
    end if;
  elsif not is_org_member(v_org) then
    raise exception 'not authorized for this track';
  end if;
  update rep_tracks set required_to_launch = p_on where id = p_track_id;
end $$;
revoke execute on function set_track_required(uuid, boolean) from public, anon;
grant  execute on function set_track_required(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
