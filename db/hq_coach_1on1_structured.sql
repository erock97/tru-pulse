-- ═══════════════════════════════════════════════════════════════════════════
-- TRU HQ — Coach: Structured Leadership 1:1 (Block 4a — DATA LAYER)
-- ═══════════════════════════════════════════════════════════════════════════
-- STATUS: PROPOSAL ONLY — NOT YET APPLIED TO ANY DATABASE. This file has not
-- been run against the live Supabase project. Eric reviews and runs it in the
-- SQL Editor himself, like every other db/*.sql file, when he's ready to ship
-- the leader form (Block 4b) and the agent recap (Block 4c) that depend on it.
--
-- Source of truth: COACH_1ON1_STRUCTURED_DESIGN.md §1–§2 (read that first).
-- This SQL is additive + idempotent (`if not exists` / `create or replace` /
-- `drop policy if exists` throughout) and touches NO existing table's columns.
-- `checkins` (db/hq_coach.sql:73-87) is unchanged — it stays the session spine
-- that roster pace/health, Past 1:1s, and the legacy `get_agent_home` token RPC
-- (db/hq_coach_compat.sql:207-219) already depend on.
--
-- Two new child tables:
--   checkin_items  — agent-visible: wins and per-session next commitments
--                    (with their Done/Partial/Missed review outcome). ('focus'
--                    stays in the kind check for legacy round-trip; the leader
--                    form no longer writes focus rows — see the app notes.)
--   checkin_leader — LEADER-ONLY: checklist completion + private note. No agent
--                    RLS policy exists for this table, ever. RLS default-deny
--                    is the whole safety mechanism — see §2 of the design doc.
-- Plus one atomic RPC, `log_structured_checkin`, that writes all three tables
-- (checkins + checkin_items + checkin_leader) in one transaction and back-fills
-- checkins.win / checkins.focus so every existing read path keeps working
-- untouched on structured sessions, exactly as it does today on legacy ones.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. checkin_items — agent-visible wins / focuses / commitments ───────────
create table if not exists checkin_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  checkin_id  uuid not null references checkins(id) on delete cascade,
  kind        text not null check (kind in ('win','focus','commitment')),
  body        text not null,
  position    int  not null default 0,
  -- commitment lifecycle (kind='commitment' only; null = not yet reviewed):
  status      text check (status in ('done','partial','missed')),
  reviewed_in uuid references checkins(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists checkin_items_checkin_idx on checkin_items (checkin_id);
create index if not exists checkin_items_agent_idx   on checkin_items (agent_id, kind, created_at);
-- Fast lookup of an agent's unreviewed commitments (the "review last 1:1's
-- commitments" step) regardless of which session set them.
create index if not exists checkin_items_open_commitments_idx
  on checkin_items (agent_id) where kind = 'commitment' and status is null;

-- ── 2. checkin_leader — LEADER-ONLY sidecar ──────────────────────────────────
-- Never add an agent policy to this table. Never select from it inside any
-- SECURITY DEFINER / anon-granted RPC (including any future extension of
-- get_agent_home). The agent-visibility contract in the design doc depends on
-- this table staying dark to every agent-facing code path, forever.
create table if not exists checkin_leader (
  checkin_id        uuid primary key references checkins(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  team_id           uuid not null references teams(id) on delete cascade,
  agent_id          uuid not null references agents(id) on delete cascade,
  checklist_version text  not null default 'tru-1on1-v1',
  checklist         jsonb not null default '{}'::jsonb,   -- { "<step_id>": true, ... }
  private_note      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists checkin_leader_agent_idx on checkin_leader (agent_id);

-- ── 3. org_id autofill — extend the existing trigger to the new tables ──────
-- fill_org_id() already exists (db/hq_coach_compat.sql:70-77). We only need to
-- attach it to the two new tables; the shared function itself is untouched.
drop trigger if exists checkin_items_fill_org on checkin_items;
create trigger checkin_items_fill_org before insert on checkin_items
  for each row execute function fill_org_id();
drop trigger if exists checkin_leader_fill_org on checkin_leader;
create trigger checkin_leader_fill_org before insert on checkin_leader
  for each row execute function fill_org_id();

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
alter table checkin_items  enable row level security;
alter table checkin_leader enable row level security;

-- Leader/coach: full access to their org's rows (mirrors every existing Coach
-- table's *_org_all policy, e.g. checkins_org_all in db/hq_coach.sql:132-142).
drop policy if exists checkin_items_org_all on checkin_items;
create policy checkin_items_org_all on checkin_items for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

drop policy if exists checkin_leader_org_all on checkin_leader;
create policy checkin_leader_org_all on checkin_leader for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Agent: SELECT-ONLY on checkin_items. Deliberately narrower than the existing
-- *_agent_self FOR ALL policies (db/hq_coach.sql:144-156) — the 1:1 record is
-- the leader's log; the agent reads it, never edits it directly (all agent-side
-- writes, if any are ever added, must go through a validated RPC, not raw table
-- access).
drop policy if exists checkin_items_agent_read on checkin_items;
create policy checkin_items_agent_read on checkin_items for select to authenticated
  using (agent_id in (select id from agents where auth_id = auth.uid()));

-- checkin_leader: NO agent policy of any kind, on purpose. RLS default-deny
-- does the work — do not add one later without re-reading the design doc §2.

-- ── 5. Atomic save — SECURITY INVOKER (the default), NOT SECURITY DEFINER ───
-- Runs AS THE CALLER, so every insert/update inside is still filtered by the
-- RLS policies above — this function is atomicity, not a privilege bypass.
-- Only granted to `authenticated` (never `anon`): the legacy token/anon agent
-- surface (agent_save_checkin, get_agent_home) is untouched and unrelated.
create or replace function log_structured_checkin(
  p_agent_id uuid, p_team_id uuid, p_met text, p_created_at timestamptz,
  p_wins text[], p_commitments text[],
  p_reviews jsonb,          -- [{ "item_id": uuid, "status": "done|partial|missed" }, ...]
  p_checklist jsonb,        -- { "<step_id>": true }
  p_private_note text
) returns uuid language plpgsql as $$
declare v_checkin uuid;
begin
  -- checkins.focus is back-filled from the FIRST next-commitment (the separate
  -- "next focuses" list was merged into "Next commitments") so roster pace, the
  -- hero "last / next focus" line, and Past 1:1s previews keep working untouched.
  insert into checkins (agent_id, team_id, logged_by, met, win, focus, created_at)
  values (p_agent_id, p_team_id, 'leader', p_met,
          nullif(p_wins[1], ''), nullif(p_commitments[1], ''),
          coalesce(p_created_at, now()))
  returning id into v_checkin;

  insert into checkin_items (team_id, agent_id, checkin_id, kind, body, position)
  select p_team_id, p_agent_id, v_checkin, k.kind, k.body, k.pos
  from (
    select 'win' as kind, w as body, ordinality::int as pos from unnest(p_wins) with ordinality as t(w, ordinality)
    union all
    select 'commitment', c, ordinality::int from unnest(p_commitments) with ordinality as t(c, ordinality)
  ) k where btrim(k.body) <> '';

  update checkin_items i
     set status = r.status, reviewed_in = v_checkin
    from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as r(item_id uuid, status text)
   where i.id = r.item_id and i.agent_id = p_agent_id and i.kind = 'commitment';

  insert into checkin_leader (checkin_id, team_id, agent_id, checklist, private_note)
  values (v_checkin, p_team_id, p_agent_id, coalesce(p_checklist, '{}'::jsonb), nullif(btrim(p_private_note), ''));

  return v_checkin;
end $$;
grant execute on function log_structured_checkin(uuid, uuid, text, timestamptz, text[], text[], jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Notes for Eric before running this:
-- 1. This is additive/idempotent and safe to run any time — it creates no
--    columns on existing tables and drops nothing that has data in it.
-- 2. `checkins.met` stays a free-form text column ('yes' | 'partial' | 'no').
--    The tri-state Met/Partial/Missed UI (Block 4b) sends one of those three
--    strings straight through as p_met — no migration, no new column.
-- 3. Audit reminder (also called out in the design doc, re-verify in Block 6):
--    sign in as a linked agent and confirm
--      supabase.from('checkin_leader').select('*')  →  zero rows
--      supabase.from('checkins').select('*, checkin_leader(*)')  →  embed empty
--    and that INSERT/UPDATE/DELETE on checkin_items as that agent is denied.
-- ═══════════════════════════════════════════════════════════════════════════
