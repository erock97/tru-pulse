-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Revenue: retainer + per-deal payout, transplanted from TRU OS
-- ═══════════════════════════════════════════════════════════════════════════
-- This is a PORT, not a mirror: TRU Operating System (a separate app/database)
-- used to be where Eric ran Terrason Consulting's billing — retainer amounts,
-- a per-team/per-source rate card, closed deals, and the invoices billed off
-- them. That functionality moves here permanently. Table shapes and the fee
-- math (closing_ledger, billable_closings, tru_month_closings, tru_list_teams,
-- tru_money_overview) are copied verbatim from TRU OS, which already has this
-- right — a past bug in re-deriving this logic cost real money, so the rule
-- is: copy the proven SQL, don't re-derive it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tables ────────────────────────────────────────────────────────────────

create table if not exists team_pay_settings (
  team_id                  uuid primary key references teams(id) on delete cascade,
  threshold                integer not null default 0,
  zillow_rate              integer not null default 250,
  mvip_rate                integer not null default 750,
  retainer                 integer not null default 0,
  default_rate             integer,
  default_threshold_deals  integer not null default 0
);

create table if not exists team_source_rates (
  team_id          uuid not null references teams(id) on delete cascade,
  source           text not null,
  rate             integer not null default 0,
  threshold_deals  integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (team_id, source)
);

create table if not exists closings (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  agent_name     text,
  address        text,
  client_name    text,
  source         text,
  close_date     date,
  status         text not null default 'closed',
  verify_status  text default 'pending',
  verified_at    timestamptz,
  batch_id       uuid,
  created_at     timestamptz not null default now(),
  invoice_id     uuid
);
create index if not exists closings_team_idx on closings (team_id, close_date desc);

create table if not exists brokers (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references teams(id) on delete cascade,
  name               text,
  email              text not null,
  stripe_customer_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  bills              boolean not null default false
);

create table if not exists invoices (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid references teams(id) on delete set null,
  broker_id           uuid references brokers(id) on delete set null,
  close_month         date,
  invoice_kind        text not null default 'closings',
  customer_email      text,
  customer_name       text,
  stripe_invoice_id   text,
  stripe_customer_id  text,
  hosted_invoice_url  text,
  invoice_pdf         text,
  status              text not null default 'draft',
  amount_due_cents    integer,
  currency            text not null default 'usd',
  due_date            date,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table closings add constraint closings_invoice_id_fkey
  foreign key (invoice_id) references invoices(id) on delete set null;

-- ── 2. RLS — service-role only, same as `admins`/`zillow_targets_*`: no
--    policy for `authenticated`. Real financial data; the browser never talks
--    to PostgREST for it, only the Worker (service role, admins-gated) does.
alter table team_pay_settings enable row level security;  -- no policy
alter table team_source_rates enable row level security;  -- no policy
alter table closings          enable row level security;  -- no policy
alter table brokers           enable row level security;  -- no policy
alter table invoices          enable row level security;  -- no policy

-- ── 3. Functions — ported verbatim from TRU OS (same table/column names, so
--    the SQL bodies are unchanged). Functions are PUBLIC-executable by
--    Postgres default unless revoked — every one of these is revoked from
--    anon/authenticated below and left service-role-only, except
--    billable_closings, which already gates itself on is_admin() and is safe
--    to expose to a signed-in admin session directly.

create or replace function closing_ledger()
 returns table(id uuid, team_id uuid, team_name text, agent_name text, address text, source text, close_date date, payout_month date, base_fee integer, earned_fee integer, under_threshold boolean, status text)
 language sql
 stable
as $function$
  with base as (
    select
      c.id, c.team_id, t.name as team_name, c.agent_name, c.address, c.source,
      c.close_date, c.client_name,
      lower(btrim(coalesce(c.source, ''))) as source_key,
      coalesce(c.status, 'closed') as status,
      coalesce(r.rate, 0) as base_fee,
      coalesce(r.threshold_deals, 0) as threshold,
      (r.rate is not null
        and coalesce(c.status, 'closed') = 'closed'
        and c.close_date is not null
        and coalesce(c.verify_status, 'pending') in ('confirmed', 'moved')) as is_counted
    from closings c
    join teams t on t.id = c.team_id
    left join team_source_rates r
      on r.team_id = c.team_id
     and lower(btrim(r.source)) = lower(btrim(coalesce(c.source, '')))
  ),
  counted as (
    select id,
           row_number() over (
             partition by team_id, source_key, date_trunc('month', close_date)
             order by close_date, client_name, id
           ) as paid_rank
    from base
    where is_counted
  )
  select
    b.id, b.team_id, b.team_name, b.agent_name, b.address, b.source, b.close_date,
    (date_trunc('month', b.close_date) + interval '1 month')::date as payout_month,
    b.base_fee,
    case when b.is_counted and c.paid_rank > b.threshold then b.base_fee else 0 end as earned_fee,
    (b.is_counted and c.paid_rank <= b.threshold) as under_threshold,
    b.status
  from base b
  left join counted c on c.id = b.id
  order by b.close_date desc, b.team_name;
$function$;

create or replace function billable_closings(p_team uuid, p_close_month date)
 returns table(id uuid, team_id uuid, address text, agent_name text, close_date date, source text, earned_fee integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (
    is_admin()
    or coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
  ) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select l.id, l.team_id, l.address, l.agent_name, l.close_date, l.source, l.earned_fee
    from closing_ledger() l
    join closings c on c.id = l.id
    where l.team_id = p_team
      and date_trunc('month', l.close_date) = date_trunc('month', p_close_month)
      and c.verify_status = 'confirmed'
      and c.invoice_id is null
      and l.earned_fee > 0;
end;
$function$;

create or replace function tru_list_teams()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(team order by team->>'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'retainer', ps.retainer,
               'threshold', ps.threshold,
               'default_rate', ps.default_rate,
               'default_threshold', coalesce(ps.default_threshold_deals, 0),
               'configured', (ps.team_id is not null),
               'rates', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'source', r.source, 'rate', r.rate,
                          'threshold', r.threshold_deals) order by r.source)
                   from public.team_source_rates r where r.team_id = t.id
               ), '[]'::jsonb)
             ) as team
        from public.teams t
        left join public.team_pay_settings ps on ps.team_id = t.id
    ) rows;
$function$;

create or replace function tru_money_overview(p_year integer, p_month integer)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_teams jsonb;
  v_retainer_total bigint;
  v_bonus_total bigint;
  v_bonus_confirmed_total bigint;
  v_earn date; v_ey integer; v_em integer;
begin
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'year is out of range' using errcode='22023'; end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'month is out of range' using errcode='22023'; end if;

  v_earn := (make_date(p_year, p_month, 1) - interval '1 month')::date;
  v_ey := extract(year  from v_earn)::integer;
  v_em := extract(month from v_earn)::integer;

  with in_month as (
    select c.team_id, c.id, c.client_name, c.close_date, c.verify_status,
           lower(btrim(coalesce(c.source, ''))) as skey
      from public.closings c
     where extract(year  from c.close_date) = v_ey
       and extract(month from c.close_date) = v_em
  ),
  ranked_projected as (
    select m.team_id, r.rate, r.threshold_deals, (r.rate is null) as unpriced,
           row_number() over (partition by m.team_id, m.skey
                              order by m.close_date, m.client_name) as pos
      from in_month m
      left join public.team_source_rates r
        on r.team_id = m.team_id and lower(r.source) = m.skey
     where m.verify_status in ('pending', 'confirmed', 'moved')
  ),
  ranked_confirmed as (
    select m.team_id, r.rate, r.threshold_deals, (r.rate is null) as unpriced,
           row_number() over (partition by m.team_id, m.skey
                              order by m.close_date, m.client_name) as pos
      from in_month m
      left join public.team_source_rates r
        on r.team_id = m.team_id and lower(r.source) = m.skey
     where m.verify_status in ('confirmed', 'moved')
  ),
  earned as (
    select team_id,
           coalesce(sum(case when not unpriced and pos > threshold_deals
                             then rate else 0 end), 0) as bonus,
           count(*) filter (where unpriced) as unpriced_count,
           count(*) as billable_count
      from ranked_projected group by team_id
  ),
  earned_confirmed as (
    select team_id,
           coalesce(sum(case when not unpriced and pos > threshold_deals
                             then rate else 0 end), 0) as bonus
      from ranked_confirmed group by team_id
  ),
  counts as (
    select team_id,
           count(*) filter (where verify_status = 'pending')   as pending,
           count(*) filter (where verify_status = 'confirmed') as confirmed,
           count(*) filter (where verify_status = 'cancelled') as cancelled,
           count(*) filter (where verify_status = 'moved')     as moved
      from in_month group by team_id
  )
  select
    jsonb_agg(jsonb_build_object(
      'team', t.name,
      'configured', (ps.team_id is not null),
      'retainer', ps.retainer,
      'bonus', coalesce(e.bonus, 0),
      'bonus_confirmed', coalesce(ec.bonus, 0),
      'total', coalesce(ps.retainer, 0) + coalesce(e.bonus, 0),
      'total_confirmed', coalesce(ps.retainer, 0) + coalesce(ec.bonus, 0),
      'billable', coalesce(e.billable_count, 0),
      'unpriced', coalesce(e.unpriced_count, 0),
      'pending', coalesce(cn.pending, 0),
      'confirmed', coalesce(cn.confirmed, 0),
      'cancelled', coalesce(cn.cancelled, 0),
      'moved', coalesce(cn.moved, 0)
    ) order by t.name),
    coalesce(sum(ps.retainer), 0),
    coalesce(sum(e.bonus), 0),
    coalesce(sum(ec.bonus), 0)
  into v_teams, v_retainer_total, v_bonus_total, v_bonus_confirmed_total
  from public.teams t
  left join public.team_pay_settings ps on ps.team_id = t.id
  left join earned e            on e.team_id  = t.id
  left join earned_confirmed ec on ec.team_id = t.id
  left join counts cn           on cn.team_id = t.id;

  return jsonb_build_object(
    'year', p_year, 'month', p_month,
    'earning_year', v_ey, 'earning_month', v_em,
    'retainer_total', v_retainer_total,
    'bonus_total', v_bonus_total,
    'bonus_confirmed_total', v_bonus_confirmed_total,
    'total', v_retainer_total + v_bonus_total,
    'total_confirmed', v_retainer_total + v_bonus_confirmed_total,
    'teams', coalesce(v_teams, '[]'::jsonb));
end; $function$;

create or replace function tru_month_closings(p_team_name text, p_year integer, p_month integer)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_team_name, ''));
  v_team uuid; v_earn date; v_ey integer; v_em integer; v_rows jsonb;
begin
  if v_name = '' then
    raise exception 'team name is required' using errcode='22023'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'year is out of range' using errcode='22023'; end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'month is out of range' using errcode='22023'; end if;

  select id into v_team from public.teams where lower(name) = lower(v_name);
  if v_team is null then
    raise exception 'no team called %', v_name using errcode='P0002'; end if;

  v_earn := (make_date(p_year, p_month, 1) - interval '1 month')::date;
  v_ey := extract(year  from v_earn)::integer;
  v_em := extract(month from v_earn)::integer;

  with in_month as (
    select c.*, lower(btrim(coalesce(c.source, ''))) as skey
      from public.closings c
     where c.team_id = v_team
       and extract(year  from c.close_date) = v_ey
       and extract(month from c.close_date) = v_em
  ),
  projected as (
    select m.id,
           row_number() over (partition by m.skey
                              order by m.close_date, m.client_name) as pos
      from in_month m
     where m.verify_status in ('pending', 'confirmed', 'moved')
  ),
  ranked as (
    select m.id, m.address, m.client_name, m.agent_name, m.source,
           m.close_date, m.verify_status, m.invoice_id, r.rate, r.threshold_deals,
           (r.rate is null) as unpriced, p.pos
      from in_month m
      left join projected p on p.id = m.id
      left join public.team_source_rates r
        on r.team_id = v_team and lower(r.source) = m.skey
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'address', address, 'client_name', client_name,
           'agent_name', agent_name, 'source', source, 'close_date', close_date,
           'status', verify_status,
           'locked', (invoice_id is not null),
           'deal_number', pos,
           'rate', rate,
           'threshold_deals', threshold_deals,
           'unpriced', unpriced,
           'earned', case
             when verify_status = 'cancelled' then 0
             when unpriced then null
             when pos > threshold_deals then rate
             else 0 end
         ) order by close_date, client_name), '[]'::jsonb)
    into v_rows from ranked;

  return jsonb_build_object('team', v_name,
    'year', p_year, 'month', p_month,
    'earning_year', v_ey, 'earning_month', v_em,
    'deals', v_rows);
end; $function$;

-- ── 4. Grants — Postgres grants EXECUTE to PUBLIC by default on a new
--    function. Every one of these touches real client billing data, so that
--    default is revoked explicitly rather than trusted, same lesson as the
--    TruTalk anon-callable-function incident.
revoke all on function closing_ledger()                                   from public, anon, authenticated;
revoke all on function tru_list_teams()                                   from public, anon, authenticated;
revoke all on function tru_money_overview(integer, integer)                from public, anon, authenticated;
revoke all on function tru_month_closings(text, integer, integer)          from public, anon, authenticated;
-- billable_closings gates itself on is_admin(), so a signed-in admin session
-- may call it directly; anyone else gets its own "admin only" exception.
revoke all on function billable_closings(uuid, date) from public, anon;
grant execute on function billable_closings(uuid, date) to authenticated;

notify pgrst, 'reload schema';
