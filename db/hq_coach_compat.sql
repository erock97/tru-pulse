-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Phase 2b (part 1): Coach COMPATIBILITY LAYER on the backbone
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) Supabase SQL Editor. Additive + idempotent.
-- After this, the Coach app can run against the backbone unchanged: same tables,
-- same RPCs, same RLS behavior — ONE auth, ONE database. The live Coach project
-- is untouched; cutover happens only when the re-pointed app is verified.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columns the Coach app expects ─────────────────────────────────────────
alter table teams  add column if not exists join_token uuid default gen_random_uuid();
alter table teams  add column if not exists modules    jsonb not null default '{}'::jsonb;
update teams set join_token = gen_random_uuid() where join_token is null;
alter table agents add column if not exists token          uuid default gen_random_uuid();
alter table agents add column if not exists personal_code  text;
update agents set token = gen_random_uuid() where token is null;

-- ── 2. Coach's leader identity (compat: one row per signed-in leader) ────────
create table if not exists leaders (
  id         uuid primary key references auth.users(id) on delete cascade,
  team_id    uuid references teams(id) on delete set null,
  name       text not null,
  email      text not null,
  created_at timestamptz default now()
);

-- ── 3. Server-side tables (service-role only; no client policies) ───────────
create table if not exists admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, created_at timestamptz not null default now()
);
create table if not exists signup_codes (
  code text primary key, label text, active boolean not null default true,
  max_uses int, uses int not null default 0, created_at timestamptz default now()
);
create table if not exists ai_usage (
  team_id uuid not null, day date not null default current_date,
  count int not null default 0, primary key (team_id, day)
);
create table if not exists fub_connections (
  team_id uuid primary key, api_key_enc text not null, account jsonb,
  connected_by uuid, connected_at timestamptz not null default now()
);
create table if not exists fub_links (
  team_id uuid not null, fub_user_id text not null, agent_id uuid, fub_name text,
  primary key (team_id, fub_user_id)
);
create table if not exists fub_snapshot (
  team_id uuid primary key, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists fub_history (
  team_id uuid not null, week date not null, data jsonb not null,
  primary key (team_id, week)
);
create table if not exists action_plans (
  team_id uuid not null, agent_id uuid not null, day date not null, data jsonb not null,
  created_at timestamptz not null default now(), primary key (agent_id, day)
);
create table if not exists reactivation_plans (
  team_id uuid not null, agent_id uuid not null, day date not null, data jsonb not null,
  created_at timestamptz not null default now(), primary key (agent_id, day)
);
create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  kind text, message text, stack text, component text, url text, ua text,
  created_at timestamptz not null default now()
);

-- ── 4. org_id autofill: Coach writes rows with team_id but no org_id ─────────
create or replace function fill_org_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null and new.team_id is not null then
    select org_id into new.org_id from teams where id = new.team_id;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['agents','assessments','goals','commitments','checkins','invites','revenue'] loop
    execute format('drop trigger if exists %I on %I', t || '_fill_org', t);
    execute format('create trigger %I before insert on %I for each row execute function fill_org_id()', t || '_fill_org', t);
  end loop;
end $$;

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
alter table leaders            enable row level security;
alter table admins             enable row level security;  -- no policy: service-role only
alter table signup_codes       enable row level security;  -- no policy
alter table ai_usage           enable row level security;  -- no policy
alter table fub_connections    enable row level security;  -- no policy
alter table fub_links          enable row level security;  -- no policy
alter table fub_snapshot       enable row level security;  -- no policy
alter table fub_history        enable row level security;  -- no policy
alter table action_plans       enable row level security;  -- no policy
alter table reactivation_plans enable row level security;  -- no policy
alter table client_errors      enable row level security;  -- no policy

drop policy if exists leaders_self on leaders;
create policy leaders_self on leaders for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Coach manages the roster directly → org members get write access to agents.
drop policy if exists agents_org_write on agents;
create policy agents_org_write on agents for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ── 6. Coach's RPCs, ported to the backbone ──────────────────────────────────
create or replace function current_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from leaders where id = auth.uid()
$$;

drop function if exists create_team(text, text, text);
drop function if exists create_team(text, text, text, text);
create or replace function create_team(p_name text, p_email text, p_team_name text, p_code text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid; v_org_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select team_id into v_team_id from leaders where id = auth.uid();
  if v_team_id is not null then
    return json_build_object('team_id', v_team_id);
  end if;
  if exists (select 1 from signup_codes where active) then
    if not exists (
      select 1 from signup_codes
      where code = p_code and active and (max_uses is null or uses < max_uses)
    ) then raise exception 'invalid_signup_code'; end if;
    update signup_codes set uses = uses + 1 where code = p_code;
  end if;
  -- HQ model: a new Coach signup = a new org (tenant) + its first team.
  insert into orgs (name, plan) values (p_team_name, 'founding') returning id into v_org_id;
  insert into teams (org_id, name) values (v_org_id, p_team_name) returning id into v_team_id;
  insert into memberships (org_id, user_id, role) values (v_org_id, auth.uid(), 'leader')
    on conflict (org_id, user_id) do nothing;
  insert into leaders (id, team_id, name, email) values (auth.uid(), v_team_id, p_name, p_email)
    on conflict (id) do nothing;
  insert into org_settings (org_id) values (v_org_id) on conflict (org_id) do nothing;
  insert into entitlements (org_id, product) values (v_org_id, 'coach'), (v_org_id, 'pulse')
    on conflict (org_id, product) do nothing;
  return json_build_object('team_id', v_team_id);
end $$;
grant execute on function create_team(text, text, text, text) to authenticated;

create or replace function resolve_join_token(p_token uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object('team_id', id, 'team_name', name)
  from teams where join_token = p_token;
$$;

create or replace function resolve_invite_token(p_token uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object('agent_id', a.id, 'team_id', a.team_id, 'agent_name', a.name)
  from invites i join agents a on a.id = i.agent_id
  where i.token = p_token;
$$;

create or replace function enroll_agent(
  p_token uuid, p_name text, p_email text, p_phone text,
  p_code text, p_answers jsonb, p_tallies jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid; v_agent_id uuid; v_invite uuid;
begin
  select id into v_team_id from teams where join_token = p_token;
  if v_team_id is not null then
    if p_email is not null and length(btrim(p_email)) > 0 then
      select id into v_agent_id from agents
        where team_id = v_team_id and lower(email) = lower(btrim(p_email))
        order by created_at asc limit 1;
    end if;
    if v_agent_id is null then
      insert into agents (team_id, name, email, phone)
        values (v_team_id, p_name, p_email, p_phone)
        returning id into v_agent_id;
    end if;
  else
    select i.id, i.agent_id, a.team_id into v_invite, v_agent_id, v_team_id
      from invites i join agents a on a.id = i.agent_id
      where i.token = p_token;
    if v_agent_id is null then raise exception 'invalid token'; end if;
    update invites set status = 'completed', completed_at = now() where id = v_invite;
  end if;

  insert into assessments (
    agent_id, team_id, code, answers,
    energy_p, energy_t, approach_pro, approach_rec,
    deal_r, deal_v, decision_d, decision_i
  ) values (
    v_agent_id, v_team_id, p_code, p_answers,
    (p_tallies->>'energy_p')::int, (p_tallies->>'energy_t')::int,
    (p_tallies->>'approach_pro')::int, (p_tallies->>'approach_rec')::int,
    (p_tallies->>'deal_r')::int, (p_tallies->>'deal_v')::int,
    (p_tallies->>'decision_d')::int, (p_tallies->>'decision_i')::int
  );

  return json_build_object('agent_id', v_agent_id,
                           'token', (select token from agents where id = v_agent_id));
end $$;
grant execute on function resolve_join_token(uuid)   to anon, authenticated;
grant execute on function resolve_invite_token(uuid) to anon, authenticated;
grant execute on function enroll_agent(uuid, text, text, text, text, jsonb, jsonb) to anon, authenticated;

create or replace function get_agent_home(p_token uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'agent',       (select json_build_object('id', a.id, 'name', a.name) from agents a where a.token = p_token),
    'code',        (select s.code from assessments s join agents a on a.id = s.agent_id
                      where a.token = p_token order by s.taken_at desc limit 1),
    'goal',        (select row_to_json(g) from goals g join agents a on a.id = g.agent_id where a.token = p_token),
    'commitments', (select coalesce(json_agg(c order by c.created_at), '[]'::json)
                      from commitments c join agents a on a.id = c.agent_id where a.token = p_token),
    'checkins',    (select coalesce(json_agg(k order by k.created_at desc), '[]'::json)
                      from checkins k join agents a on a.id = k.agent_id where a.token = p_token)
  );
$$;

create or replace function agent_toggle_commitment(p_token uuid, p_commitment_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update commitments c set done = p_done
   where c.id = p_commitment_id
     and c.agent_id = (select id from agents where token = p_token);
end $$;

create or replace function agent_save_checkin(p_token uuid, p_met text, p_leads int, p_convos int, p_win text, p_focus text)
returns void language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_team uuid;
begin
  select id, team_id into v_agent, v_team from agents where token = p_token;
  if v_agent is null then raise exception 'invalid token'; end if;
  insert into checkins (agent_id, team_id, logged_by, met, leads, convos, win, focus)
  values (v_agent, v_team, 'agent', p_met, p_leads, p_convos, p_win, p_focus);
end $$;
grant execute on function get_agent_home(uuid)                                  to anon, authenticated;
grant execute on function agent_toggle_commitment(uuid, uuid, boolean)          to anon, authenticated;
grant execute on function agent_save_checkin(uuid, text, int, int, text, text)  to anon, authenticated;

create or replace function set_dashboard_module(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update teams
     set modules = jsonb_set(coalesce(modules, '{}'::jsonb), array[p_key], to_jsonb(p_enabled), true)
   where id = (select team_id from leaders where id = auth.uid());
end $$;

create or replace function replace_revenue(items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from leaders where id = auth.uid();
  delete from revenue where team_id = t;
  insert into revenue (team_id, agent_id, agent_name, amount)
  select t, (e->>'agent_id')::uuid, e->>'agent_name', (e->>'amount')::numeric
  from jsonb_array_elements(items) e;
end $$;

create or replace function set_personal_code(p_agent_id uuid, p_code text)
returns void language sql security definer set search_path = public as $$
  update agents set personal_code = p_code where id = p_agent_id;
$$;

create or replace function my_agent_token()
returns uuid language sql security definer set search_path = public as $$
  select a.token from agents a
  where a.email is not null and lower(a.email) = lower(auth.jwt() ->> 'email')
  order by a.token limit 1;
$$;

create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

create or replace function bump_ai_usage(p_team uuid, p_cap int)
returns boolean language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into ai_usage (team_id, day, count) values (p_team, current_date, 1)
    on conflict (team_id, day) do update set count = ai_usage.count + 1
    returning count into c;
  return c <= p_cap;
end $$;
grant execute on function set_dashboard_module(text, boolean) to authenticated;
grant execute on function replace_revenue(jsonb)              to authenticated;
grant execute on function set_personal_code(uuid, text)       to anon, authenticated;
grant execute on function my_agent_token()                    to authenticated;
grant execute on function is_admin()                          to authenticated;

-- ── 7. Seeds: the real leaders, admin, entitlements, signup gate ─────────────
insert into leaders (id, team_id, name, email) values
  ('d6b9504c-f35e-49c9-af99-6a2de2069db8', 'cb0fcbbb-c332-4f61-90f8-2b51b673bca8', 'Eric Matthews',  'eric@terrasonconsulting.com'),
  ('56be9384-5d05-4bc7-89c4-362131990ce8', 'cb0fcbbb-c332-4f61-90f8-2b51b673bca8', 'Jack Costigan',  'jack.costigan@compass.com'),
  ('13c63a96-54b1-40b9-9439-ccaefc1bb5bb', '3a84fd98-13f2-46e7-83a2-a1ed3aeadab7', 'Signature Realty', 'georgeb@signaturerealtynj.com'),
  ('d5e8bfa9-d7a3-4cd1-8035-6630c66d2aef', '96ddb98f-1fb6-4d99-80f6-20ef615dec34', 'Carson Woosley', 'carson.woosley@compass.com')
on conflict (id) do nothing;

insert into admins (id, email)
values ('d6b9504c-f35e-49c9-af99-6a2de2069db8', 'eric@terrasonconsulting.com')
on conflict (id) do nothing;

insert into entitlements (org_id, product) values
  ('100630b4-4bd0-4f74-bf70-4bf798f7ef9c', 'coach'),
  ('100630b4-4bd0-4f74-bf70-4bf798f7ef9c', 'pulse'),
  ('fed61cea-31cd-4d26-a195-9772a8ecfc9c', 'coach'),
  ('fed61cea-31cd-4d26-a195-9772a8ecfc9c', 'pulse')
on conflict (org_id, product) do nothing;

insert into signup_codes (code, label) values ('COSTIGAN-2026', 'general')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
