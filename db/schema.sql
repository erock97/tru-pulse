-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Pulse — multi-tenant schema (accountability core, v1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase Postgres. Every row is org-scoped; RLS restricts reads to org members.
-- The Cloudflare Worker writes with the SERVICE ROLE (bypasses RLS). The browser
-- uses the anon key + a signed-in Supabase Auth JWT and only ever reads its own org.
--
-- Provisioning (create org / membership / team / store FUB key) goes through the
-- Worker with the service role — NOT direct browser writes — which sidesteps the
-- RLS bootstrap catch-22. So there are no INSERT/UPDATE policies for `authenticated`;
-- the browser is read-only and org-scoped. `team_secrets` has RLS on and NO policy,
-- so encrypted FUB keys are invisible to the browser entirely.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ─────────────────────────────────────────────── orgs (the tenant = a customer)
create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'founding',  -- founding | coach | command | complete
  status      text not null default 'active',    -- active | paused | canceled
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────── memberships (auth.users ↔ org)
create table if not exists memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'leader',    -- admin | leader | coach
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists memberships_org_idx  on memberships (org_id);

-- ─────────────────────────────────────────────── RLS helpers (SECURITY DEFINER)
-- SECURITY DEFINER so a policy can read memberships without triggering its own RLS
-- (prevents infinite recursion). STABLE so it's evaluated once per statement.
create or replace function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function has_org_role(p_org uuid, p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = p_role
  );
$$;

-- ─────────────────────────────────────────────── teams (a FUB account in an org)
-- An org can hold several FUB accounts, exactly like Eric's own multi-team setup —
-- so the product isn't tied to a single FUB login.
create table if not exists teams (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null,
  fub_subdomain text,                       -- for building per-record FUB links
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists teams_org_idx on teams (org_id);

-- team_secrets — the encrypted FUB API key. SEPARATE table with NO authenticated
-- read policy → only the Worker (service role) reads it. The browser never sees a key.
create table if not exists team_secrets (
  team_id      uuid primary key references teams(id) on delete cascade,
  org_id       uuid not null references orgs(id) on delete cascade,
  fub_key_enc  text not null,               -- AES-GCM ciphertext (Worker decrypts)
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────── agents
create table if not exists agents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  fub_user_id  bigint,
  name         text not null,
  email        text,
  excluded     boolean not null default false,  -- owners/leads excluded from flags
  created_at   timestamptz not null default now(),
  unique (team_id, fub_user_id)
);
create index if not exists agents_team_idx on agents (team_id);
create index if not exists agents_org_idx  on agents (org_id);

-- coach_teams — per-coach team visibility. Present now so the accountability build is
-- written coach-aware; RLS narrowing for coaches lands in v1.1 without a retrofit.
create table if not exists coach_teams (
  org_id   uuid not null references orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  team_id  uuid not null references teams(id) on delete cascade,
  primary key (org_id, user_id, team_id)
);

-- ─────────────────────────────────────────────── leads (synced from FUB)
create table if not exists leads (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  fub_person_id  bigint not null,
  name           text,
  source         text,                      -- raw FUB source string
  source_family  text,                      -- Zillow | Realtor.com | Homes.com | Facebook | Google | Referrals
  stage          text,
  assigned_to    text,
  agent_id       uuid references agents(id) on delete set null,
  tags           text[] not null default '{}',
  fub_created    timestamptz,
  fub_updated    timestamptz,               -- high-water-mark for incremental sync
  -- computed at sync time; flag math identical to the audit / shared/flags.ts
  flag           text,                       -- stuck | zero_contact | worked
  outgoing_texts integer not null default 0,
  calls          integer not null default 0,
  synced_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (team_id, fub_person_id)
);
create index if not exists leads_team_idx         on leads (team_id);
create index if not exists leads_org_idx          on leads (org_id);
create index if not exists leads_team_created_idx on leads (team_id, fub_created);
create index if not exists leads_family_idx       on leads (team_id, source_family);
create index if not exists leads_flag_idx         on leads (team_id, flag);

-- ─────────────────────────────────────────────── events (calls / texts)
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  lead_id     uuid not null references leads(id) on delete cascade,
  type        text,                          -- call | text message | sms | text | email
  incoming    boolean,
  occurred_at timestamptz,
  duration    integer,                       -- seconds (calls)
  automated   boolean not null default false, -- automated first-text drip flag
  created_at  timestamptz not null default now()
);
create index if not exists events_lead_idx on events (lead_id);
create index if not exists events_team_idx on events (team_id, occurred_at);

-- ─────────────────────────────────────────────── accountability (3-strike)
create table if not exists accountability_cases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  lead_id     uuid references leads(id) on delete set null,
  agent_id    uuid references agents(id) on delete set null,
  assigned_to text,                          -- FUB agent name (leads aren't mapped to agents yet)
  opened_at   timestamptz not null default now(),
  status      text not null default 'open',  -- open | complied | escalated | closed
  resolution  text,
  resolved_at timestamptz
);
create index if not exists acc_cases_team_idx    on accountability_cases (team_id, opened_at);
create index if not exists acc_cases_agent_idx   on accountability_cases (agent_id, opened_at);
create index if not exists acc_cases_name_idx    on accountability_cases (team_id, assigned_to, opened_at);
create index if not exists acc_cases_lead_idx    on accountability_cases (team_id, lead_id);

create table if not exists accountability_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  case_id    uuid not null references accountability_cases(id) on delete cascade,
  kind       text not null,                  -- strike | pause_rec | reminder | verbal_warning | note
  strike_no  integer,
  actor      text,                           -- system | <user email>
  created_at timestamptz not null default now()
);
create index if not exists acc_events_case_idx on accountability_events (case_id, created_at);

-- ─────────────────────────────────────────────── settings (audit math + thresholds)
create table if not exists org_settings (
  org_id             uuid primary key references orgs(id) on delete cascade,
  window_hours       integer not null default 48,    -- flag window
  avg_gci            numeric not null default 10000,  -- for $-at-risk
  close_rate         numeric not null default 2.0,    -- % worked-lead close rate
  strike_window_days integer not null default 30,
  strike_limit       integer not null default 3,
  per_agent_capacity integer not null default 20,     -- coverage waterline
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────── sync bookkeeping
create table if not exists sync_state (
  team_id          uuid primary key references teams(id) on delete cascade,
  org_id           uuid not null references orgs(id) on delete cascade,
  last_updated_hwm timestamptz,
  last_backfill_at timestamptz,
  last_sync_at     timestamptz,
  last_snapshot_at timestamptz
);

create table if not exists daily_snapshots (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  snapshot_date date not null,
  total_leads  integer not null default 0,
  zero_contact integer not null default 0,
  stuck        integer not null default 0,
  worked       integer not null default 0,
  by_source    jsonb   not null default '{}',
  created_at   timestamptz not null default now(),
  unique (team_id, snapshot_date)
);
create index if not exists daily_snapshots_team_idx on daily_snapshots (team_id, snapshot_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — read-only, org-scoped for the browser. Worker (service role) bypasses all.
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS on every table (team_secrets included — it gets no policy → hidden).
do $$
declare t text;
begin
  foreach t in array array[
    'orgs','memberships','teams','team_secrets','agents','coach_teams','leads',
    'events','accountability_cases','accountability_events','org_settings',
    'sync_state','daily_snapshots'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- orgs: read your own org.
drop policy if exists orgs_read on orgs;
create policy orgs_read on orgs for select to authenticated using (is_org_member(id));

-- memberships: read membership rows for orgs you belong to.
drop policy if exists memberships_read on memberships;
create policy memberships_read on memberships for select to authenticated using (is_org_member(org_id));

-- Every other org-scoped table: read if you're a member of the row's org.
do $$
declare t text;
begin
  foreach t in array array[
    'teams','agents','coach_teams','leads','events',
    'accountability_cases','accountability_events','org_settings',
    'sync_state','daily_snapshots'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_org_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (is_org_member(org_id))',
      t || '_org_read', t);
  end loop;
end $$;

-- NOTE: team_secrets intentionally has NO policy → the browser can never read a
-- FUB key. Only the Worker (service role) touches it. Do not add a policy here.

-- v1.1 hook: to narrow COACHES to their coach_teams, replace the org_read policy on
-- team-scoped tables with:
--   using (is_org_member(org_id) AND (
--     has_org_role(org_id,'admin') OR has_org_role(org_id,'leader')
--     OR team_id IN (select team_id from coach_teams
--                    where org_id = <tbl>.org_id and user_id = auth.uid())))
