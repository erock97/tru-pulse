-- Display names are independent of CRM source names and identity links.
create table public.agent_display_names (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120
    and display_name !~ '[[:cntrl:]]')
);
alter table public.agent_display_names enable row level security;
grant select, insert, update on public.agent_display_names to authenticated;
grant all on public.agent_display_names to service_role;
revoke all on public.agent_display_names from anon;

create policy agent_display_names_read on public.agent_display_names for select to authenticated
using (exists (select 1 from public.agents a where a.id = agent_id));
create policy agent_display_names_insert on public.agent_display_names for insert to authenticated
with check (exists (select 1 from public.agents a where a.id = agent_id and
  (a.auth_id = auth.uid() or public.has_org_role(a.org_id, 'admin') or public.has_org_role(a.org_id, 'leader'))));
create policy agent_display_names_update on public.agent_display_names for update to authenticated
using (exists (select 1 from public.agents a where a.id = agent_id and
  (a.auth_id = auth.uid() or public.has_org_role(a.org_id, 'admin') or public.has_org_role(a.org_id, 'leader'))))
with check (exists (select 1 from public.agents a where a.id = agent_id and
  (a.auth_id = auth.uid() or public.has_org_role(a.org_id, 'admin') or public.has_org_role(a.org_id, 'leader'))));

create function public.set_agent_display_name(p_agent_id uuid, p_name text)
returns text language plpgsql security invoker set search_path = '' as $$
declare saved text;
begin
  if auth.uid() is null then raise exception 'Sign in to save' using errcode = '42501'; end if;
  insert into public.agent_display_names(agent_id, display_name) values(p_agent_id, btrim(p_name))
  on conflict(agent_id) do update set display_name = excluded.display_name
  returning display_name into saved;
  return saved;
end $$;
revoke all on function public.set_agent_display_name(uuid, text) from public, anon;
grant execute on function public.set_agent_display_name(uuid, text) to authenticated;
