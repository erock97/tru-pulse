-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Studio (Bundle B — Content Engine) — the AI social-content calendar.
-- ═══════════════════════════════════════════════════════════════════════════
-- Run AFTER hq_prospect.sql. Additive + idempotent. Deliberately separate from
-- the outbound/call-queue tables in hq_prospect.sql — Studio shares the AI
-- content engine + FUB attribution but NONE of the telephony/compliance spine
-- (no DNC/consent/gate concepts apply to organic social content).
--
-- The moat here is voice-cloning (drafts sound like the individual agent, not a
-- generic template pack) plus a mandatory fair-housing/disclosure guardrail run
-- on every generated string before it's ever shown to the agent.

-- ─────────────────────────────────────────── voice profile (per agent, per org)
create table if not exists social_voice_profiles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  agent_id       uuid references agents(id) on delete cascade,
  tone_summary   text,                                -- AI-derived voice/tone description
  sample_posts   jsonb not null default '[]'::jsonb,   -- imported past captions (the training set)
  audience       text,                                 -- 'first_time_buyers','luxury','relocation',...
  brand_kit      jsonb not null default '{}'::jsonb,    -- logo, colors, license #, disclosure text
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, agent_id)
);
create index if not exists social_voice_profiles_org_idx on social_voice_profiles (org_id);

-- ─────────────────────────────────────────── generated content (the calendar)
create table if not exists social_content (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  agent_id       uuid references agents(id) on delete cascade,
  batch_id       uuid,                                 -- groups one "generate calendar" run

  scheduled_for  date,
  pillar         text,                                 -- 'market','listing','social_proof','personality','education'
  format         text,                                 -- 'reel','carousel','story','graphic','email'
  hook           text,
  caption        text,
  script         text,
  status         text not null default 'draft'
                   check (status in ('draft','approved','scheduled','posted','rejected')),

  -- Compliance guardrail result: {fair_housing_ok, disclosure_appended, flags:[...]}.
  -- Never null — every generated string is screened before storage.
  compliance     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists social_content_org_idx on social_content (org_id, scheduled_for);
create index if not exists social_content_batch_idx on social_content (batch_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table social_voice_profiles enable row level security;
drop policy if exists social_voice_profiles_org_read on social_voice_profiles;
create policy social_voice_profiles_org_read on social_voice_profiles for select to authenticated
  using (is_org_member(org_id));

alter table social_content enable row level security;
drop policy if exists social_content_org_read on social_content;
create policy social_content_org_read on social_content for select to authenticated
  using (is_org_member(org_id));

notify pgrst, 'reload schema';
