-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Prospect — agent-assist outbound prospecting (Circle / Expired / FSBO)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor, AFTER schema.sql. Additive +
-- idempotent. Every row is org-scoped; the browser reads its own org (RLS), the
-- Worker writes with the service role.
--
-- AGENT-ASSIST: a human always dials. The compliance gate (worker/src/prospect)
-- returns allow / manual / block; nothing here auto-dials. The consent + DNC +
-- opt-out + audit tables are the legal shield — writes are Worker-only, retained.
--
-- Design mirrors the Voice ISA consent schema, re-homed from tenant_id → org_id
-- and made channel-aware so a STOP suppresses across voice/text everywhere.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────── settings (gate config per org)
create table if not exists prospect_settings (
  org_id            uuid primary key references orgs(id) on delete cascade,
  default_timezone  text not null default 'America/Los_Angeles',
  quiet_start_hour  smallint not null default 8   check (quiet_start_hour between 0 and 23),
  quiet_end_hour    smallint not null default 21  check (quiet_end_hour between 1 and 24),
  max_attempts      smallint not null default 6   check (max_attempts >= 1),
  -- Per-channel DNC posture for COLD channels: 'block' (never surface) or
  -- 'manual' (human-dial-only, audited). Conservative default: circle blocks.
  dnc_policy        jsonb not null default '{"circle":"block","expired":"manual","fsbo":"manual"}'::jsonb,
  recording_consent_required boolean not null default false,  -- all-party states
  config            jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  check (quiet_end_hour > quiet_start_hour)
);

-- ─────────────────────────────────────────────── properties (owner-of-record)
create table if not exists prospect_properties (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  team_id        uuid references teams(id) on delete cascade,
  address_line1  text,
  city           text,
  state          text,
  postal_code    text,
  apn            text,
  latitude       double precision,
  longitude      double precision,
  owner_name     text,
  owner_occupied boolean,
  tenure_years   numeric,
  est_value      numeric,
  est_equity     numeric,
  equity_pct     numeric,
  mls_id         text,
  list_price     numeric,
  days_on_market integer,
  price_changes  jsonb not null default '[]'::jsonb,
  photos         jsonb not null default '[]'::jsonb,
  listing_status text,
  data_source    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists prospect_properties_org_idx on prospect_properties (org_id);
create index if not exists prospect_properties_geo_idx on prospect_properties (latitude, longitude);

-- ─────────────────────────────────────────────── people (canonical, dedup-once)
create table if not exists prospect_people (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  team_id          uuid references teams(id) on delete cascade,
  dedupe_key       text not null,                 -- normalize(name+phone) | address
  fub_person_id    bigint,
  owning_agent_id  uuid references agents(id) on delete set null,
  property_id      uuid references prospect_properties(id) on delete set null,
  full_name        text,
  first_name       text,
  best_phone_e164  text,
  email            text,
  timezone         text,                          -- recipient tz (drives quiet hours)
  tier             text check (tier in ('A','B')),
  source           text,                          -- 'circle','expired','fsbo',...
  source_detail    text,
  last_activity_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index if not exists prospect_people_org_idx on prospect_people (org_id);
create index if not exists prospect_people_fub_idx on prospect_people (org_id, fub_person_id);
create index if not exists prospect_people_agent_idx on prospect_people (owning_agent_id);

-- ─────────────────────────────────────────────── phones (skip-trace waterfall)
create table if not exists prospect_phones (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  person_id      uuid not null references prospect_people(id) on delete cascade,
  phone_e164     text not null,
  line_type      text not null default 'unknown' check (line_type in ('mobile','landline','voip','unknown')),
  confidence     numeric,
  dnc_status     text not null default 'unknown'  check (dnc_status in ('unknown','clear','federal','state','litigator','internal')),
  is_best        boolean not null default false,
  source         text,
  last_disposition text,
  scrubbed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (person_id, phone_e164)
);
create index if not exists prospect_phones_phone_idx on prospect_phones (phone_e164);
create index if not exists prospect_phones_person_idx on prospect_phones (person_id);

-- ─────────────────────────────────────────────── consent (channel-aware basis)
create table if not exists prospect_consent (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  person_id         uuid not null references prospect_people(id) on delete cascade,
  channel           text not null default 'voice' check (channel in ('voice','text','any')),
  call_basis        text not null default 'unknown'
                      check (call_basis in ('unknown','none','inbound_inquiry','reengagement',
                                            'text_reply','express_written','ebr','manual_cold')),
  basis_source      text,
  basis_at          timestamptz,
  recording_consent text not null default 'not_captured' check (recording_consent in ('not_captured','granted','refused')),
  recording_consent_at timestamptz,
  updated_at        timestamptz not null default now(),
  unique (person_id, channel)
);

-- ─────────────────────────────────────────────── opt-outs (APPEND-ONLY, permanent)
create table if not exists prospect_opt_outs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  person_id     uuid references prospect_people(id) on delete set null,
  phone_e164    text,
  channel       text not null check (channel in ('voice','text','any')),
  method        text not null,                   -- 'verbal_on_call','stop_text','manual','dnc_list','complaint'
  raw_text      text,                            -- literal opt-out language, for provability
  captured_at   timestamptz not null default now(),
  source        text
);
create index if not exists prospect_opt_outs_phone_idx on prospect_opt_outs (phone_e164);
create index if not exists prospect_opt_outs_person_idx on prospect_opt_outs (person_id);

-- ─────────────────────────────────────────────── DNC (org-scoped or global)
create table if not exists prospect_dnc (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references orgs(id) on delete cascade,   -- NULL = global
  phone_e164   text not null,
  scope        text not null default 'internal' check (scope in ('internal','federal','state','litigator')),
  reason       text,
  added_at     timestamptz not null default now()
);
create index if not exists prospect_dnc_phone_idx on prospect_dnc (phone_e164);

-- ─────────────────────────────────────────────── campaigns (a prospecting run)
create table if not exists prospect_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  team_id             uuid references teams(id) on delete cascade,
  created_by_agent    uuid references agents(id) on delete set null,
  channel             text not null check (channel in ('circle','expired','fsbo','soi','open_house','social')),
  name                text,
  subject_property_id uuid references prospect_properties(id) on delete set null,
  config              jsonb not null default '{}'::jsonb,   -- radius_m, polygon, filters
  status              text not null default 'active' check (status in ('active','paused','completed','archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists prospect_campaigns_org_idx on prospect_campaigns (org_id, channel, status);

-- ─────────────────────────────────────────────── dial sessions (KPI rollups → Pulse)
create table if not exists prospect_dial_sessions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  agent_id       uuid references agents(id) on delete set null,
  campaign_id    uuid references prospect_campaigns(id) on delete set null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  dials          integer not null default 0,
  right_party_contacts integer not null default 0,
  appointments   integer not null default 0
);
create index if not exists prospect_dial_sessions_org_idx on prospect_dial_sessions (org_id, started_at desc);

-- ─────────────────────────────────────────────── call_queue (the dial list)
create table if not exists prospect_call_queue (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  team_id         uuid references teams(id) on delete cascade,
  campaign_id     uuid references prospect_campaigns(id) on delete cascade,
  person_id       uuid not null references prospect_people(id) on delete cascade,
  phone_e164      text,
  channel         text not null check (channel in ('circle','expired','fsbo','soi','open_house')),
  priority        smallint not null default 100,   -- lower = sooner (equity/tenure ranked)
  state           text not null default 'queued'
                    check (state in ('queued','manual','gate_blocked','calling','completed','suppressed','failed')),
  attempts        smallint not null default 0,
  last_attempt_at timestamptz,
  next_eligible_at timestamptz,
  last_gate_decision jsonb,                         -- full GateDecision snapshot (audit)
  dossier         jsonb,                            -- AI reason-to-call / call card
  enqueued_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, person_id)
);
create index if not exists prospect_call_queue_dispatch_idx
  on prospect_call_queue (org_id, channel, state, priority, next_eligible_at);

-- ─────────────────────────────────────────────── calls (telephony attempt record)
create table if not exists prospect_calls (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  person_id       uuid not null references prospect_people(id) on delete cascade,
  queue_item_id   uuid references prospect_call_queue(id) on delete set null,
  session_id      uuid references prospect_dial_sessions(id) on delete set null,
  phone_e164      text,
  provider        text,
  provider_call_id text,
  started_at      timestamptz,
  ended_at        timestamptz,
  duration_sec    integer,
  recording_consent_captured boolean not null default false,
  offered_opt_out boolean not null default false,
  recording_url   text,
  transcript      text,
  created_at      timestamptz not null default now()
);
create index if not exists prospect_calls_person_idx on prospect_calls (org_id, person_id, created_at desc);

-- ─────────────────────────────────────────────── dispositions (agent one-tap → FUB)
create table if not exists prospect_dispositions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  person_id       uuid not null references prospect_people(id) on delete cascade,
  call_id         uuid references prospect_calls(id) on delete set null,
  queue_item_id   uuid references prospect_call_queue(id) on delete set null,
  agent_id        uuid references agents(id) on delete set null,
  outcome         text not null
                    check (outcome in ('appointment','contact_interested','contact_not_ready',
                                       'not_interested','callback','no_answer','voicemail',
                                       'bad_number','wrong_person','opt_out')),
  notes           text,
  next_action     text,                            -- 'call','text','mail','none'
  next_action_at  timestamptz,
  fub_synced_at   timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists prospect_dispositions_person_idx on prospect_dispositions (org_id, person_id, created_at desc);

-- ─────────────────────────────────────────────── audit (APPEND-ONLY compliance trail)
create table if not exists prospect_audit (
  id          bigserial primary key,
  org_id      uuid references orgs(id) on delete cascade,
  person_id   uuid,
  event_type  text not null,   -- 'gate_decision','opt_out','consent_change','scrub','call_started','disposition'
  payload     jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists prospect_audit_person_idx on prospect_audit (person_id, at desc);
create index if not exists prospect_audit_type_idx on prospect_audit (org_id, event_type, at desc);

-- ─────────────────────────────────────────────── suppression helper (fail-closed read)
create or replace view prospect_suppressed_phones as
  select phone_e164, 'opt_out'::text as reason, org_id
    from prospect_opt_outs where phone_e164 is not null
  union
  select phone_e164, 'dnc'::text as reason, org_id
    from prospect_dnc;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — read-only, org-scoped for the browser. Worker (service role) bypasses.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'prospect_settings','prospect_properties','prospect_people','prospect_phones',
    'prospect_consent','prospect_opt_outs','prospect_campaigns','prospect_dial_sessions',
    'prospect_call_queue','prospect_calls','prospect_dispositions','prospect_audit'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (is_org_member(org_id))',
      t || '_org_read', t);
  end loop;
end $$;

-- DNC: org rows readable by members; global rows (org_id null) are Worker-only.
alter table prospect_dnc enable row level security;
drop policy if exists prospect_dnc_org_read on prospect_dnc;
create policy prospect_dnc_org_read on prospect_dnc for select to authenticated
  using (org_id is not null and is_org_member(org_id));

notify pgrst, 'reload schema';
