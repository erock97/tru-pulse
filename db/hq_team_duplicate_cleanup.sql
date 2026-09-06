-- Evidence-led cleanup of the duplicate Allyson Woosley tenant. The three
-- canonical destinations are resolved from the successful production batch.
-- Re-execution is a no-op once the recorded cleanup has completed.
create schema if not exists truhq_cleanup_private;
revoke all on schema truhq_cleanup_private from public,anon,authenticated;
create table if not exists truhq_cleanup_private.snapshots (
  cleanup_id text primary key, captured_at timestamptz not null default now(),
  snapshot jsonb not null, decisions jsonb not null, completed_at timestamptz
);
alter table truhq_cleanup_private.snapshots enable row level security;
revoke all on truhq_cleanup_private.snapshots from public,anon,authenticated;

do $$
declare
  cleanup constant text := 'woosley-production-evidence-8194448c-v1';
  batch constant text := '8194448c-c4e6-48ed-a775-c4cab4bd76c5';
  canonical uuid; old_team uuid; sb uuid; synergy uuid;
  old_org uuid; canonical_org uuid;
  r record; a record; b public.agents; la record; lb public.leads;
  n bigint; changed_fields text[];
  backup jsonb := '{}'::jsonb; rows_json jsonb;
begin
  perform pg_advisory_xact_lock(746281903);
  if exists(select 1 from truhq_cleanup_private.snapshots where cleanup_id=cleanup and completed_at is not null) then return; end if;
  select team_id into strict canonical from public.coach_weekly_reports where run_id=batch||':woosley' and status='published';
  select team_id into strict sb from public.coach_weekly_reports where run_id=batch||':satish' and status='published';
  select team_id into strict synergy from public.coach_weekly_reports where run_id=batch||':synergy' and status='published';
  if sb::text <> 'df216d4d-b05e-4ddf-a84e-0d685182d692' then raise exception 'SB alias evidence changed; stop'; end if;
  select id,org_id into strict old_team,old_org from public.teams where name='Allyson Woosley' and not is_active;
  select org_id into strict canonical_org from public.teams where id=canonical and is_active;
  lock table public.teams,public.agents,public.leads,public.sync_state in share row exclusive mode;
  for r in select distinct c.table_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
    where c.table_schema='public' and c.column_name in ('team_id','agent_id','lead_id') and t.table_type='BASE TABLE' order by c.table_name loop
    execute format('lock table public.%I in share row exclusive mode',r.table_name);
  end loop;
  if (select count(*) from public.agents where team_id=old_team) <> 10 then raise exception 'Duplicate roster changed'; end if;

  -- Full reversible export of affected rows, including canonical counterparts.
  select jsonb_agg(to_jsonb(t)) into rows_json from public.teams t where id in(old_team,canonical,sb,synergy);
  backup := backup || jsonb_build_object('teams',rows_json);
  for r in select c.table_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
    where c.table_schema='public' and c.column_name='team_id' and t.table_type='BASE TABLE' loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x where team_id=$1',r.table_name) into rows_json using old_team;
    backup := backup || jsonb_build_object(r.table_name,rows_json);
    if jsonb_array_length(rows_json)>0 and r.table_name not in ('agents','leads','sync_state') then
      raise exception 'New dependent table requires review: %',r.table_name;
    end if;
  end loop;
  select jsonb_agg(to_jsonb(aa)) into rows_json from public.agents aa where team_id=canonical;
  backup := backup || jsonb_build_object('canonical_agents',rows_json);
  select jsonb_agg(to_jsonb(l)) into rows_json from public.leads l where team_id=canonical and fub_person_id in(select fub_person_id from public.leads where team_id=old_team);
  backup := backup || jsonb_build_object('canonical_leads',rows_json);
  select jsonb_agg(to_jsonb(s)) into rows_json from public.sync_state s where team_id=canonical;
  backup := backup || jsonb_build_object('canonical_sync_state',rows_json);
  insert into truhq_cleanup_private.snapshots(cleanup_id,snapshot,decisions)
  values(cleanup,backup,jsonb_build_object('canonical',canonical,'duplicate',old_team,
    'agents','Same FUB IDs and names; preserve canonical logins, lead roles, coaching settings, pause state and profiles. Karisa canonical email belongs to established auth account; preserve old email in snapshot.',
    'leads','Same business fields; retain newer canonical sync/FUB/contact-check timestamps.',
    'sync','Retain newer canonical cursor; old cursor preserved in snapshot.'));

  -- Refuse unexpected individual history, including references without FKs.
  for r in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
    where c.table_schema='public' and c.column_name in ('agent_id','lead_id') and t.table_type='BASE TABLE' loop
    execute format('select count(*) from public.%I where %I in(select id from public.%I where team_id=$1)',r.table_name,r.column_name,case r.column_name when 'agent_id' then 'agents' else 'leads' end) into n using old_team;
    if n<>0 then raise exception 'Dependent individual history changed: %',r.table_name; end if;
  end loop;
  if exists(select 1 from public.memberships where org_id=old_org) then raise exception 'Duplicate organization gained memberships'; end if;

  for a in select * from public.agents where team_id=old_team loop
    select * into strict b from public.agents where team_id=canonical and fub_user_id=a.fub_user_id and lower(name)=lower(a.name);
    if a.auth_id is not null or a.personal_axes is not null or a.is_paused or a.coaching_enabled then raise exception 'Duplicate agent gained configuration'; end if;
    select array_agg(k) into changed_fields from jsonb_object_keys(to_jsonb(a)) k
      where to_jsonb(a)->k is distinct from to_jsonb(b)->k and k not in
      ('id','org_id','team_id','created_at','token','personal_code','personal_axes','auth_id','coaching_enabled','role','email','is_paused','paused_at','paused_by','pause_reason');
    if changed_fields is not null then raise exception 'Unexpected agent differences: %',changed_fields; end if;
    if lower(a.email) is distinct from lower(b.email) and not (a.name='Karisa Fitts' and b.auth_id is not null) then raise exception 'Unreviewed email conflict'; end if;
  end loop;
  for la in select * from public.leads where team_id=old_team loop
    select * into strict lb from public.leads where team_id=canonical and fub_person_id=la.fub_person_id;
    select array_agg(k) into changed_fields from jsonb_object_keys(to_jsonb(la)) k
      where to_jsonb(la)->k is distinct from to_jsonb(lb)->k and k not in('id','org_id','team_id','created_at','synced_at','fub_updated','contact_checked_at');
    if changed_fields is not null or la.synced_at>lb.synced_at or la.fub_updated>lb.fub_updated then raise exception 'Lead conflict requires review'; end if;
  end loop;
  if exists(select 1 from public.sync_state sa join public.sync_state sb_state on sb_state.team_id=canonical where sa.team_id=old_team and (sa.last_sync_at>sb_state.last_sync_at or sa.last_backfill_at is not null or sa.last_snapshot_at is not null or sa.last_updated_hwm is not null)) then raise exception 'Sync cursor changed'; end if;

  -- Every old relationship has an existing, more complete canonical counterpart.
  -- Explicitly remove only the backed-up duplicate copies; never cascade history.
  delete from public.agents where team_id=old_team;
  delete from public.leads where team_id=old_team;
  delete from public.sync_state where team_id=old_team;
  for r in select c.table_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
    where c.table_schema='public' and c.column_name='team_id' and t.table_type='BASE TABLE' loop
    execute format('select count(*) from public.%I where team_id=$1',r.table_name) into n using old_team;
    if n<>0 then raise exception 'Unmigrated team reference: %',r.table_name; end if;
  end loop;
  delete from public.teams where id=old_team;
  update public.teams set report_slug='woosley' where id=canonical;
  update public.teams set report_slug='sb-realty' where id=sb;
  update public.teams set report_slug='the-synergy-group-nj' where id=synergy;
  if (select count(*) from public.coach_weekly_reports where run_id in(batch||':woosley',batch||':synergy',batch||':satish') and status='published' and team_id in(canonical,sb,synergy))<>3 then raise exception 'Report integrity check failed'; end if;
  if (select count(*) from public.agents where team_id=canonical)<>10 then raise exception 'Canonical roster changed'; end if;
  update truhq_cleanup_private.snapshots set completed_at=now() where cleanup_id=cleanup;
end;
$$;

