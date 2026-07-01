-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Phase 1: fold TRU Coach into the Pulse backbone
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in the TRU-Pulse Supabase (the HQ backbone) SQL Editor. It is ADDITIVE
-- and idempotent — `if not exists` everywhere — so it is safe on the live project
-- and touches NO existing data. It does NOT migrate the 2 live Coach teams (that is
-- Phase 2, a coordinated window); it only makes the backbone ready to receive them.
--
-- The whole idea: Coach's data hangs off the SAME `agents` row Pulse already uses, so
-- one canonical person carries both a Pulse flag and a Coach 1:1. Coach's old
-- `fub_links` table is unnecessary here — linking an agent to FUB just means setting
-- `agents.fub_user_id` on the shared row.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Shared agent gains the fields Coach needs: an optional own-login + contact.
alter table agents add column if not exists auth_id uuid references auth.users(id) on delete set null;
alter table agents add column if not exists phone   text;
create index if not exists agents_auth_idx on agents (auth_id);

-- 1. Entitlements — which products an org owns → gates which modules appear in HQ.
create table if not exists entitlements (
  org_id     uuid not null references orgs(id) on delete cascade,
  product    text not null,                         -- 'pulse' | 'coach' | 'rep'
  status     text not null default 'active',        -- active | trialing | paused | canceled
  created_at timestamptz not null default now(),
  primary key (org_id, product)
);
create index if not exists entitlements_org_idx on entitlements (org_id);

-- 2. Coach data — all org+team scoped, keyed to the SHARED agents row.
create table if not exists assessments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,
  agent_id      uuid not null references agents(id) on delete cascade,
  code          text not null,                       -- "P-Pro-V-D" archetype code
  answers       jsonb,
  energy_p int, energy_t int, approach_pro int, approach_rec int,
  deal_r int, deal_v int, decision_d int, decision_i int,
  taken_at      timestamptz not null default now()
);
create index if not exists assessments_agent_idx on assessments (agent_id, taken_at);
create index if not exists assessments_team_idx  on assessments (team_id);

create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,
  agent_id      uuid not null references agents(id) on delete cascade unique,  -- one current goal
  quarter       text default 'Q3 2026',
  q_goal        int  default 6,
  alloc_company int  default 3,
  cvr_company   numeric default 4.0,
  cvr_sphere    numeric default 12.0,
  updated_at    timestamptz not null default now()
);
create index if not exists goals_team_idx on goals (team_id);

create table if not exists commitments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,
  agent_id   uuid not null references agents(id) on delete cascade,
  source     text not null,                          -- 'company' | 'sphere'
  text       text not null,
  is_custom  boolean not null default false,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists commitments_agent_idx on commitments (agent_id);
create index if not exists commitments_team_idx   on commitments (team_id);

create table if not exists checkins (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,
  agent_id   uuid not null references agents(id) on delete cascade,
  logged_by  text default 'leader',                  -- 'leader' | 'agent'
  met        text,                                   -- 'yes' | 'partial' | 'no'
  leads      int default 0,
  convos     int default 0,
  win        text,
  focus      text,
  created_at timestamptz not null default now()
);
create index if not exists checkins_agent_idx on checkins (agent_id, created_at);
create index if not exists checkins_team_idx  on checkins (team_id);

create table if not exists invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  agent_id     uuid not null references agents(id) on delete cascade,
  channel      text default 'text',                  -- 'text' | 'email' | 'link'
  status       text default 'sent',                  -- sent | delivered | opened | completed
  token        uuid default gen_random_uuid(),
  sent_at      timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists invites_agent_idx on invites (agent_id);
create index if not exists invites_team_idx  on invites (team_id);

create table if not exists revenue (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,
  agent_id   uuid references agents(id) on delete set null,
  agent_name text,
  amount     numeric not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists revenue_team_idx on revenue (team_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — Coach tables are browser-WRITABLE (unlike Pulse's read-only tables): a
-- leader (any org member) manages their org's coaching data; an agent who logs in
-- (agents.auth_id) manages their own. is_org_member() already exists from schema.sql.
-- ═══════════════════════════════════════════════════════════════════════════

alter table entitlements enable row level security;
alter table assessments  enable row level security;
alter table goals        enable row level security;
alter table commitments  enable row level security;
alter table checkins     enable row level security;
alter table invites      enable row level security;
alter table revenue      enable row level security;

-- entitlements: org members read; writes come through the Worker (service role).
drop policy if exists entitlements_read on entitlements;
create policy entitlements_read on entitlements for select to authenticated using (is_org_member(org_id));

-- Coach tables: a leader/coach (org member) has full access to their org's rows.
do $$
declare t text;
begin
  foreach t in array array['assessments','goals','commitments','checkins','invites','revenue'] loop
    execute format('drop policy if exists %I on %I', t || '_org_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id))',
      t || '_org_all', t);
  end loop;
end $$;

-- Agent self-access: an agent logged in via agents.auth_id reads/writes their own rows.
do $$
declare t text;
begin
  foreach t in array array['assessments','goals','commitments','checkins'] loop
    execute format('drop policy if exists %I on %I', t || '_agent_self', t);
    execute format(
      $f$create policy %I on %I for all to authenticated
        using (agent_id in (select id from agents where auth_id = auth.uid()))
        with check (agent_id in (select id from agents where auth_id = auth.uid()))$f$,
      t || '_agent_self', t);
  end loop;
end $$;
