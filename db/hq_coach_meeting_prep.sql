-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Coach: Meeting-notes prep for the structured 1:1 (Fathom ingest)
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per recorded meeting that Fathom pushed to POST /fathom/webhook.
-- The worker (service role) writes these; a leader reads their org's rows and
-- the "Run this 1:1" form offers the distilled notes as a pre-fill. Nothing
-- here ever writes checkins/checkin_items/checkin_leader — a 1:1 is only ever
-- logged by the leader pressing "Log this 1:1", exactly as before.
--
-- Additive + idempotent, touches no existing table.
--
-- LEADER-ONLY, like checkin_leader: `distilled` carries a SUGGESTED private
-- note lifted from the conversation, so this table must stay dark to every
-- agent-facing code path. No agent RLS policy exists, ever — RLS default-deny
-- is the mechanism (same contract as checkin_leader, see
-- db/hq_coach_1on1_structured.sql:52-56).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists meeting_preps (
  id                uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: a meeting whose invitees matched no agent still gets
  -- stored (nothing is lost, dedupe still works) but has no org to belong to.
  -- Null org_id ⇒ invisible to every signed-in user (is_org_member(null) is
  -- null) — service-role only until something resolves it.
  org_id            uuid references orgs(id)   on delete cascade,
  team_id           uuid references teams(id)  on delete cascade,
  agent_id          uuid references agents(id) on delete cascade,
  source            text not null default 'fathom',
  -- The meeting's stable identity (Fathom share/recording URL, falling back to
  -- the webhook message id). Fathom re-sends on delivery failure; this is what
  -- makes the ingest idempotent.
  dedupe_key        text not null unique,
  title             text,
  recorded_by_email text,
  meeting_start     timestamptz,
  meeting_end       timestamptz,
  invitees          jsonb not null default '[]'::jsonb,  -- [{name,email,is_external}]
  summary_md        text,                                -- Fathom's own summary, verbatim
  action_items      jsonb not null default '[]'::jsonb,  -- Fathom's action items, verbatim
  -- { "wins": [], "commitments": [], "private_note": "" } — null while the
  -- distill is still running (or failed; see distill_error).
  distilled         jsonb,
  distill_error     text,
  status            text not null default 'new' check (status in ('new','applied','dismissed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- The one read path: "the newest un-handled prep for this agent".
create index if not exists meeting_preps_agent_idx
  on meeting_preps (agent_id, created_at desc) where agent_id is not null and status = 'new';

alter table meeting_preps enable row level security;

-- Leader/coach: their org's rows (mirrors checkin_leader_org_all).
drop policy if exists meeting_preps_org_all on meeting_preps;
create policy meeting_preps_org_all on meeting_preps for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- NO agent policy of any kind, on purpose — see the header. Do not add one.

notify pgrst, 'reload schema';
