-- Broker verification rounds, the deal importer, and the rate-card editor.
--
-- The round/importer objects are ported VERBATIM from TRU Operating System's
-- live Supabase project (they were never checked into that repo — these
-- definitions were pulled from the running database on 2026-08-31). The rules
-- they enforce were earned in production: a token cannot reach another team's
-- month, cannot reopen a finished round, cannot touch a deal an invoice
-- already owns. Copy, don't re-derive.
--
-- tru_save_team_pay is the one genuinely new function here: TRU OS never had
-- an "edit an existing team's rates" path (only creation-time setup), and
-- Eric asked for one.
--
-- Grants matter more than usual in this file. New functions in this project
-- default to anon-callable and the documented fix has silently failed before,
-- so every function gets an explicit revoke — and exactly two are then handed
-- back to anon (tru_verify_list / tru_verify_respond), because the broker
-- confirm page has no login: the round token IS the credential, and every
-- safety rule lives inside those two functions.

-- ── Tables ────────────────────────────────────────────────────────────────

-- One verification round per team+month. Idempotent by design: asking again
-- for the same team+month returns the SAME token and extends its life, so a
-- re-send is a reminder with the same link, never a second round.
create table if not exists closing_verifications (
  token       uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  close_year  integer not null check (close_year >= 2000 and close_year <= 2100),
  close_month integer not null check (close_month >= 1 and close_month <= 12),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '60 days'),
  closed_at   timestamptz,
  unique (team_id, close_year, close_month)
);

-- Who was actually mailed, per round. gmail_message_id keeps its TRU OS name
-- even though TRU HQ sends through Resend — the column records "the mailer's
-- message id", and renaming a ported column is how drift starts.
create table if not exists broker_email_sends (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references teams(id) on delete cascade,
  close_year       integer not null check (close_year >= 2000 and close_year <= 2100),
  close_month      integer not null check (close_month >= 1 and close_month <= 12),
  to_email         text not null,
  gmail_message_id text,
  status           text not null default 'sent' check (status in ('sent', 'unknown')),
  sent_at          timestamptz not null default now()
);

create index if not exists broker_email_sends_lookup
  on broker_email_sends (team_id, close_year, close_month, sent_at desc);

-- Service-role only, matching every other billing table in hq_revenue.sql:
-- RLS on, no policies. The browser never touches these directly.
alter table closing_verifications enable row level security;
alter table broker_email_sends    enable row level security;

-- ── Functions (verbatim TRU OS ports) ─────────────────────────────────────

create or replace function public.tru_start_verification(p_team_name text, p_year integer, p_month integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_team_name, ''));
  v_team uuid; v_token uuid; v_count integer;
begin
  if v_name = '' then raise exception 'team name is required' using errcode='22023'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'year is out of range' using errcode='22023'; end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'month is out of range' using errcode='22023'; end if;

  select id into v_team from public.teams where lower(name) = lower(v_name);
  if v_team is null then raise exception 'no team called %', v_name using errcode='P0002'; end if;

  insert into public.closing_verifications (team_id, close_year, close_month)
  values (v_team, p_year, p_month)
  on conflict (team_id, close_year, close_month)
    do update set expires_at = now() + interval '60 days'
  returning token into v_token;

  select count(*) into v_count from public.closings c
   where c.team_id = v_team
     and extract(year  from c.close_date) = p_year
     and extract(month from c.close_date) = p_month;

  return jsonb_build_object('token', v_token, 'team', v_name,
    'year', p_year, 'month', p_month, 'deals', v_count);
end; $function$;

create or replace function public.tru_verify_list(p_token uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_v record; v_rows jsonb;
begin
  select * into v_v from public.closing_verifications where token = p_token;
  if v_v.token is null then raise exception 'this link is not valid' using errcode='P0002'; end if;
  if v_v.expires_at < now() then raise exception 'this link has expired' using errcode='22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'address', c.address, 'client_name', c.client_name,
           'source', c.source, 'close_date', c.close_date,
           'status', c.verify_status,
           'locked', (c.invoice_id is not null)
         ) order by c.client_name), '[]'::jsonb)
    into v_rows
    from public.closings c
   where c.team_id = v_v.team_id
     and extract(year  from c.close_date) = v_v.close_year
     and extract(month from c.close_date) = v_v.close_month;

  return jsonb_build_object(
    'team', (select name from public.teams where id = v_v.team_id),
    'year', v_v.close_year, 'month', v_v.close_month,
    'closed_at', v_v.closed_at, 'deals', v_rows);
end; $function$;

create or replace function public.tru_verify_respond(p_token uuid, p_closing_id uuid, p_outcome text, p_new_year integer default null::integer, p_new_month integer default null::integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_v record; v_c record; v_new_date date; v_left integer; v_closed boolean := false;
begin
  select * into v_v from public.closing_verifications where token = p_token;
  if v_v.token is null then raise exception 'this link is not valid' using errcode='P0002'; end if;
  if v_v.expires_at < now() then raise exception 'this link has expired' using errcode='22023'; end if;

  -- R8b. A settled round is finished. Reopening it is a conversation with Eric,
  -- not a silent edit by whoever still has the email.
  if v_v.closed_at is not null then
    raise exception 'this list has already been completed' using errcode='22023';
  end if;

  if p_outcome not in ('confirmed','cancelled','moved') then
    raise exception 'outcome must be confirmed, cancelled or moved' using errcode='22023'; end if;

  -- The closing must belong to THIS round: this team, this month. The token
  -- cannot reach another team's data or another month.
  select * into v_c from public.closings c
   where c.id = p_closing_id and c.team_id = v_v.team_id
     and extract(year  from c.close_date) = v_v.close_year
     and extract(month from c.close_date) = v_v.close_month;
  if v_c.id is null then raise exception 'that deal is not in this list' using errcode='P0002'; end if;

  -- A deal already invoiced is settled. The broker cannot reopen it here; if it
  -- is genuinely wrong that is a conversation with Eric, not a silent edit.
  if v_c.invoice_id is not null then
    raise exception 'that deal has already been invoiced' using errcode='22023'; end if;

  if p_outcome = 'moved' then
    if p_new_year is null or p_new_month is null
       or p_new_year < 2000 or p_new_year > 2100
       or p_new_month < 1 or p_new_month > 12 then
      raise exception 'which month did it close in?' using errcode='22023'; end if;
    -- Keep the day, change the month. A day the target month does not have (the
    -- 31st moved into February) clamps to that month's LAST day rather than
    -- rolling into the next month. F54: this previously clamped at 28.
    v_new_date := make_date(p_new_year, p_new_month,
                    least(extract(day from v_c.close_date)::int,
                          extract(day from (make_date(p_new_year, p_new_month, 1)
                                            + interval '1 month'
                                            - interval '1 day'))::int));
    update public.closings
       set verify_status = 'moved', verified_at = now(), close_date = v_new_date
     where id = p_closing_id;
  else
    update public.closings
       set verify_status = p_outcome, verified_at = now()
     where id = p_closing_id;
  end if;

  -- Anything left unanswered in this round? A deal MOVED OUT of the month is no
  -- longer part of it and must not hold the round open forever, so the count is
  -- taken over the round's month as it stands now.
  select count(*) into v_left
    from public.closings c
   where c.team_id = v_v.team_id
     and extract(year  from c.close_date) = v_v.close_year
     and extract(month from c.close_date) = v_v.close_month
     and c.verify_status = 'pending';

  if v_left = 0 then
    update public.closing_verifications
       set closed_at = now()
     where token = p_token and closed_at is null;
    v_closed := true;
  end if;

  return jsonb_build_object(
    'id', p_closing_id, 'outcome', p_outcome,
    'remaining', v_left, 'round_closed', v_closed);
end; $function$;

create or replace function public.tru_import_closings(p_team_name text, p_source text, p_deals jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_name    text := btrim(coalesce(p_team_name, ''));
  v_source  text := btrim(coalesce(p_source, ''));
  v_team    uuid;
  v_batch   uuid := gen_random_uuid();
  v_count   integer := 0;
  v_deal    jsonb;
  v_client  text;
  v_addr    text;
  v_date    date;
  v_month   text;
  v_seen    jsonb := '[]'::jsonb;
  v_dupes   jsonb := '[]'::jsonb;
begin
  if v_name = '' then
    raise exception 'team name is required' using errcode = '22023';
  end if;
  if v_source = '' then
    raise exception 'a batch needs a source' using errcode = '22023';
  end if;
  if p_deals is null or jsonb_typeof(p_deals) <> 'array'
     or jsonb_array_length(p_deals) = 0 then
    raise exception 'no deals to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_deals) > 500 then
    raise exception 'too many deals in one batch' using errcode = '22023';
  end if;

  select id into v_team from public.teams where lower(name) = lower(v_name);
  if v_team is null then
    raise exception 'no team called %', v_name using errcode = 'P0002';
  end if;

  for v_deal in select * from jsonb_array_elements(p_deals)
  loop
    if jsonb_typeof(v_deal) <> 'object' then
      raise exception 'each deal must be an object' using errcode = '22023';
    end if;
    if coalesce(btrim(v_deal->>'close_date'), '') = '' then
      raise exception 'every deal needs a close date' using errcode = '22023';
    end if;
    v_client := lower(btrim(coalesce(v_deal->>'client_name', '')));
    if v_client = '' then
      raise exception 'every deal needs a client name' using errcode = '22023';
    end if;
    v_date  := (v_deal->>'close_date')::date;
    v_month := to_char(v_date, 'YYYY-MM');
    v_addr  := lower(btrim(coalesce(v_deal->>'address', '')));

    if exists (
         select 1 from jsonb_array_elements(v_seen) s
          where s->>'c' = v_client
            and s->>'m' = v_month
            and (v_addr = '' or s->>'a' = '' or s->>'a' = v_addr))
       or exists (
         select 1 from public.closings c
          where c.team_id = v_team
            and lower(btrim(coalesce(c.client_name, ''))) = v_client
            and c.verify_status <> 'cancelled'
            and (v_addr = ''
                 or lower(btrim(coalesce(c.address, ''))) = ''
                 or lower(btrim(coalesce(c.address, ''))) = v_addr))
    then
      v_dupes := v_dupes || jsonb_build_object(
        'client_name', v_deal->>'client_name',
        'address', v_deal->>'address',
        'close_date', v_deal->>'close_date');
      continue;
    end if;

    v_seen := v_seen || jsonb_build_object(
      'c', v_client, 'm', v_month, 'a', v_addr);
    insert into public.closings
      (team_id, agent_name, address, client_name, source, close_date,
       status, verify_status, batch_id)
    values (
      v_team,
      nullif(btrim(coalesce(v_deal->>'agent_name', '')), ''),
      nullif(btrim(coalesce(v_deal->>'address', '')), ''),
      btrim(v_deal->>'client_name'),
      v_source,
      v_date,
      'closed', 'pending', v_batch
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'team', v_name, 'source', v_source,
    'imported', v_count,
    'batch_id', case when v_count > 0 then v_batch::text else null end,
    'duplicates', v_dupes);
end;
$function$;

-- ── New: edit an existing team's retainer + rate card ─────────────────────

-- Atomic replace: team_pay_settings upserted, team_source_rates deleted and
-- re-inserted in one transaction (PostgREST can't span calls, so this lives
-- in SQL). The legacy zillow_rate/mvip_rate columns are re-derived from the
-- rate card exactly as TRU OS's createTeam does — left at their column
-- defaults, a client who doesn't pay for Zillow would show a projection
-- built from somebody else's rate card.
create or replace function public.tru_save_team_pay(
  p_team uuid, p_retainer integer, p_default_rate integer, p_rates jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_rate    jsonb;
  v_source  text;
  v_amount  integer;
  v_thresh  integer;
  v_seen    text[] := '{}';
  v_zillow  integer := 0;
  v_mvip    integer := 0;
  v_count   integer := 0;
begin
  if p_team is null or not exists (select 1 from public.teams where id = p_team) then
    raise exception 'no such team' using errcode = 'P0002';
  end if;
  if p_retainer is null or p_retainer < 0 then
    raise exception 'retainer must be zero or more whole dollars' using errcode = '22023';
  end if;
  if p_default_rate is not null and p_default_rate < 0 then
    raise exception 'default rate must be zero or more whole dollars' using errcode = '22023';
  end if;
  if p_rates is null or jsonb_typeof(p_rates) <> 'array' then
    raise exception 'rates must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rates) > 50 then
    raise exception 'too many rate rows' using errcode = '22023';
  end if;

  for v_rate in select * from jsonb_array_elements(p_rates)
  loop
    v_source := btrim(coalesce(v_rate->>'source', ''));
    if v_source = '' then
      raise exception 'every rate row needs a source' using errcode = '22023';
    end if;
    if lower(v_source) = any(v_seen) then
      raise exception 'source % appears twice', v_source using errcode = '22023';
    end if;
    v_seen := v_seen || lower(v_source);
    v_amount := coalesce((v_rate->>'rate')::integer, -1);
    v_thresh := coalesce((v_rate->>'threshold_deals')::integer, 0);
    if v_amount < 0 then
      raise exception 'rate for % must be zero or more whole dollars', v_source using errcode = '22023';
    end if;
    if v_thresh < 0 then
      raise exception 'threshold for % must be zero or more deals', v_source using errcode = '22023';
    end if;
    if lower(v_source) like '%zillow%' and v_zillow = 0 then v_zillow := v_amount; end if;
    if lower(v_source) like '%mvip%'   and v_mvip   = 0 then v_mvip   := v_amount; end if;
  end loop;

  insert into public.team_pay_settings
    (team_id, retainer, threshold, default_rate, default_threshold_deals,
     zillow_rate, mvip_rate)
  values (p_team, p_retainer, 0, p_default_rate, 0, v_zillow, v_mvip)
  on conflict (team_id) do update
    set retainer     = excluded.retainer,
        default_rate = excluded.default_rate,
        zillow_rate  = excluded.zillow_rate,
        mvip_rate    = excluded.mvip_rate;

  delete from public.team_source_rates where team_id = p_team;

  insert into public.team_source_rates (team_id, source, rate, threshold_deals)
  select p_team,
         btrim(r->>'source'),
         (r->>'rate')::integer,
         coalesce((r->>'threshold_deals')::integer, 0)
    from jsonb_array_elements(p_rates) r;
  get diagnostics v_count = row_count;

  return jsonb_build_object('team_id', p_team, 'rates', v_count);
end;
$function$;

-- ── Grants — the part that has silently failed before ─────────────────────

revoke all on function public.tru_start_verification(text, integer, integer)                          from public, anon, authenticated;
revoke all on function public.tru_import_closings(text, text, jsonb)                                  from public, anon, authenticated;
revoke all on function public.tru_save_team_pay(uuid, integer, integer, jsonb)                        from public, anon, authenticated;
revoke all on function public.tru_verify_list(uuid)                                                   from public, authenticated;
revoke all on function public.tru_verify_respond(uuid, uuid, text, integer, integer)                  from public, authenticated;

-- The ONLY two anon may call: the broker confirm page has no login, the round
-- token is the credential, and every safety rule lives inside the functions.
grant execute on function public.tru_verify_list(uuid)                                  to anon;
grant execute on function public.tru_verify_respond(uuid, uuid, text, integer, integer) to anon;

notify pgrst, 'reload schema';
