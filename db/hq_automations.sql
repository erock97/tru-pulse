-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Agents — the automation shelf, its run log, and its safety interlocks
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
-- Block 1 of TRU Agents (SQL only). Nothing reads these tables yet; this file
-- is inert until the Worker block lands.
--
-- ── What this is ────────────────────────────────────────────────────────────
-- A short SHELF of pre-built agents that a platform owner switches on per team.
-- Deliberately NOT a builder: automation_types is seeded here, by hand, and no
-- Worker route ever inserts into it. A team lead handed an empty "what should
-- your agent do?" box does not know what is possible or what is reasonable, so
-- they never come back. The scoping happens once, in this file.
--
-- ── The rule every write path here obeys ────────────────────────────────────
-- Writes ALWAYS go through the Cloudflare Worker using the SERVICE ROLE, the
-- same as every other write in this schema (see schema.sql header). There are
-- deliberately NO client-facing INSERT/UPDATE policies in this file. The
-- browser only ever reads, and today it reads nothing at all.
--
-- ── Five invariants, each locked in two independent places ──────────────────
-- Because these agents text real people and one of them writes to a paying
-- customer's CRM, no single mistake may be sufficient to cause a bad send.
--
--   1. Only a platform owner sees any of this.
--        Lock A: the admins-table check on /admin/* in worker/src/index.ts.
--        Lock B: every table below is RLS-on; the only reader is the service
--                role, and the two _public views are predicated on a flag that
--                defaults false on every row.
--   2. A draft can never send.
--        Lock A: automations.mode defaults 'off'.
--        Lock B: automations.enabled is only ever written as (mode <> 'off'),
--                mirroring rep_modules' active = (status = 'published') in
--                hq_rep_authoring.sql — a draft cannot be born live.
--   3. Nothing sends twice.
--        Lock A: automation_runs.idempotency_key is unique and is CLAIMED
--                before any work happens.
--        Lock B: automation_deliveries.dedupe_key is unique and is written
--                before any network call.
--   4. A live CRM write takes two deliberate acts.
--        Lock A: an automation_capabilities row, which ONLY this file and its
--                companion grant file can create — no route writes that table.
--        Lock B: a compile-time team allow-list in the Worker.
--   5. Everything can be stopped from outside the code.
--        platform_flags, read at SEND time rather than at runner start, so
--        flipping a flag mid-run stops the very next message.
--
-- ── Deliberately NOT in this file ───────────────────────────────────────────
-- call_transcripts (the warm cache) and agent_conversations / agent_messages
-- (the two-way text agent) come with the phases that need them. Their shape
-- depends on choices not yet made — which transcription service, and whether
-- threads key per agent or per team — and guessing now would bake a wrong
-- answer into a table other things then reference.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. teams.timezone ───────────────────────────────────────────────────────
-- "Morning brief" is a wall-clock concept and there is no timezone anywhere in
-- this schema today. Four of the five live teams are Eastern and one is
-- Central, but the default below is Pacific because that is what an unset
-- value has effectively meant everywhere else in this system (the existing
-- agent text queue is built on a Pacific date boundary). Set it per team
-- explicitly; do not rely on the default being right for anyone.
alter table teams add column if not exists timezone text not null default 'America/Los_Angeles';


-- ── 1. automation_types — the shelf ─────────────────────────────────────────
-- Seeded at the bottom of this file and nowhere else. Adding an agent to the
-- product is a migration, which is the point: it is a dated, reviewable act.
create table if not exists automation_types (
  key            text primary key,          -- 'morning_brief' | 'speed_to_lead_nudge' | 'lead_reassign'
  label          text not null,
  blurb          text not null,             -- one plain sentence, shown on the card
  trigger_kind   text not null,             -- 'schedule' (a clock) | 'event' (a webhook)
  -- The ceiling on how autonomous ANY instance of this type may ever be,
  -- regardless of what its config row says. Raising it is a migration.
  max_mode       text not null default 'notify_only',
  channels       text[] not null default '{email}',
  -- The capability an instance must hold before it may take a real-world
  -- action. Null means the type is incapable of doing anything irreversible.
  capability     text,
  -- Whether a team lead may ever be shown this type at all. Both this and the
  -- per-instance flag must be true; see the view further down.
  leader_visible boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ADD CONSTRAINT has no IF NOT EXISTS, so guard via pg_constraint.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'automation_types_mode_check') then
    alter table automation_types add constraint automation_types_mode_check
      check (max_mode in ('off','notify_only','ask_first','full_auto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_types_trigger_check') then
    alter table automation_types add constraint automation_types_trigger_check
      check (trigger_kind in ('schedule','event'));
  end if;
end $$;


-- ── 2. automations — one row per (team, agent-on-the-shelf) ─────────────────
create table if not exists automations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id)  on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,
  type_key      text not null references automation_types(key),
  name          text,
  -- THE safety mode, and the only thing that decides `enabled`.
  --   off         - inert. The runner does not select it.
  --   notify_only - it runs and records what it WOULD do, and sends nothing.
  --   ask_first   - it proposes; a human approves before anything happens.
  --   full_auto   - it acts.
  -- Born 'off'. Always.
  mode          text not null default 'off',
  enabled       boolean not null default false,
  -- Browser-safe knobs: send times, thresholds, which agents are in scope.
  config        jsonb not null default '{}'::jsonb,
  -- Server-only: recipient phone numbers, action-plan text patterns, anything
  -- whose disclosure would matter. Never selected by the _public view, and
  -- stripped again in the Worker route before it reaches even the owner's
  -- browser. Same split as rep_scenarios' facts/expected.
  secure_config jsonb not null default '{}'::jsonb,
  -- Belt to the code's braces. A rule that suddenly matches two hundred rows
  -- is the failure mode that actually hurts, not a single wrong send.
  max_per_day   int not null default 2,
  -- Per-instance live-send lock, independent of mode and of the platform flag.
  sms_live      boolean not null default false,
  -- ── The leader-exposure switch ──
  -- Flip visible_to_leader and this row starts appearing in automations_public.
  -- Nothing else changes: no new table, no new policy, no rewrite. That is the
  -- whole mechanism by which "Eric only, for now" becomes "brokers too".
  visible_to_leader boolean not null default false,
  leader_editable   boolean not null default false,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (team_id, type_key)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'automations_mode_check') then
    alter table automations add constraint automations_mode_check
      check (mode in ('off','notify_only','ask_first','full_auto'));
  end if;
end $$;

create index if not exists automations_team_idx on automations (team_id);
create index if not exists automations_due_idx  on automations (enabled, type_key);


-- ── 3. automation_runs — the admin log ──────────────────────────────────────
-- Every execution, including the ones that decided to do nothing. A run that
-- skipped matters as much as a run that sent: a cap or a staleness guard that
-- silently no-ops is indistinguishable from a broken runner.
--
-- Bodies do NOT live here. This table is redacted by construction so that it
-- stays readable without exposing a client's lead list.
create table if not exists automation_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id)  on delete cascade,
  team_id         uuid not null references teams(id) on delete cascade,
  automation_id   uuid references automations(id) on delete set null,
  type_key        text not null,
  -- The claim. Unique, and inserted as the FIRST statement of a run - before
  -- any work, any fetch, any send. A retried cron loses the race and stops.
  -- Format: '<automation_id>:<slot>', where slot is the local date + send time
  -- for a schedule, or '<event>:<resourceId>' for an event.
  idempotency_key text not null unique,
  trigger         text not null,   -- 'cron' | 'webhook' | 'manual' | 'reveal'
  -- The mode AT RUN TIME, not the current mode. A later config change must not
  -- be able to rewrite what this run was allowed to do.
  mode            text not null,
  status          text not null default 'claimed',
  -- claimed | ok | no_content | queued_for_approval
  -- | skipped_stale | skipped_capped | skipped_killed | error
  actions_proposed int not null default 0,
  actions_executed int not null default 0,
  -- Redacted: first name + last initial, phone last four. Never a lead's name,
  -- phone, or email.
  summary         text,
  detail          jsonb not null default '{}'::jsonb,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists automation_runs_team_idx on automation_runs (team_id, started_at desc);
create index if not exists automation_runs_auto_idx on automation_runs (automation_id, started_at desc);


-- ── 4. automation_actions — the approval queue ──────────────────────────────
-- One row per PROPOSED side effect. Nothing here has happened yet.
create table if not exists automation_actions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id)  on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,
  run_id        uuid not null references automation_runs(id) on delete cascade,
  automation_id uuid references automations(id) on delete set null,
  kind          text not null,   -- 'notify.sms' | 'notify.email' | 'fub.reassign'
  payload       jsonb not null default '{}'::jsonb,
  -- What it would take to UNDO this, captured BEFORE the write rather than
  -- reconstructed after. Follow Up Boss offers no undo, so the only accurate
  -- record of the prior state is the one taken while it was still true.
  revert_payload jsonb,
  status        text not null default 'pending',
  -- pending | approved | rejected | executed | failed | expired | reverted
  -- A proposal has a shelf life. One approved at 8:00 that the agent finally
  -- worked at 8:05 must not still be executable.
  expires_at    timestamptz not null default now() + interval '24 hours',
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  executed_at   timestamptz,
  reverted_at   timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists automation_actions_pending_idx
  on automation_actions (status, expires_at) where status = 'pending';
create index if not exists automation_actions_run_idx on automation_actions (run_id);


-- ── 5. automation_deliveries — the only place a full message body lives ─────
create table if not exists automation_deliveries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id)  on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  run_id      uuid references automation_runs(id) on delete set null,
  channel     text not null,   -- 'email' | 'relay' | 'twilio'
  -- The second idempotency layer, independent of the run claim: a hash of
  -- (automation, slot, channel, target, body). Written before any network
  -- call, so a duplicate throws instead of sending.
  dedupe_key  text not null unique,
  target      text not null,   -- e164 or email address
  body        text not null,
  segments    int,
  mode        text not null,   -- 'live' | 'dry_run' | 'blocked'
  blocked_reason text,
  provider_id text,            -- twilio message sid, or the relay claim id
  status      text not null default 'queued',
  claimed_at  timestamptz,     -- relay: when the phone picked it up
  purge_after timestamptz not null default now() + interval '30 days',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists automation_deliveries_cap_idx   on automation_deliveries (org_id, created_at desc);
create index if not exists automation_deliveries_purge_idx on automation_deliveries (purge_after);


-- ── 6. automation_capabilities — the allow-list ─────────────────────────────
-- THE server-side grant. Seeded ONLY by SQL, by hand, in a dated file. There
-- is deliberately no Worker route that writes this table, so neither a UI
-- mistake nor a forged request body can hand another team the ability to have
-- its CRM written to. Verify that property with:
--     grep -rn "automation_capabilities" worker/src/
-- It must appear only inside select calls.
create table if not exists automation_capabilities (
  team_id    uuid not null references teams(id) on delete cascade,
  capability text not null,   -- 'fub.reassign' | 'notify.relay' | 'notify.twilio'
  granted_by text not null,   -- who ran the SQL, for the audit trail
  note       text,
  expires_at timestamptz,     -- null = no expiry
  created_at timestamptz not null default now(),
  primary key (team_id, capability)
);


-- ── 7. automation_backtests — the interlock, not a report ───────────────────
-- A ten-minute speed-to-lead rule that has never been replayed against real
-- history is a guess, and the thing it guesses with is a paying client's lead
-- flow. Reassignment cannot leave notify_only without a reviewed row here.
--
-- The replay reads Follow Up Boss directly rather than stored history, because
-- the `events` table this schema defines has never had a row written to it —
-- there is no local history to replay. It is chunked because a month of one
-- team's leads is more subrequests than one Worker invocation may spend.
create table if not exists automation_backtests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id)  on delete cascade,
  team_id           uuid not null references teams(id) on delete cascade,
  type_key          text not null,
  params            jsonb not null,   -- { days, thresholdSeconds, autoTextWindowSeconds, patterns }
  status            text not null default 'running',  -- running | complete | reviewed | failed
  cursor            text,             -- resume point between chunks
  leads_seen        int not null default 0,
  would_act         int not null default 0,
  contacted_in_time int not null default 0,
  -- Uncertain cases, which the detector resolves as "contacted, do nothing".
  -- A high number here means the rule is blind, not that the team is clean.
  unknown_failsafe  int not null default 0,
  -- Per-lead verdicts. Names redacted to first name + last initial; no lead
  -- phone or email is ever stored here.
  results           jsonb not null default '[]'::jsonb,
  -- The distribution the decision actually rests on, including the near-miss
  -- bucket: leads worked between the warn and the act threshold. That bucket
  -- is the honest answer to "is thirty minutes the right number?"
  histogram         jsonb not null default '{}'::jsonb,
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);

create index if not exists automation_backtests_team_idx
  on automation_backtests (team_id, type_key, reviewed_at desc);


-- ── 8. platform_flags — stop everything, without a deploy ───────────────────
create table if not exists platform_flags (
  key        text primary key,
  bool_value boolean,
  text_value text,
  note       text,
  updated_at timestamptz not null default now()
);

insert into platform_flags (key, bool_value, note) values
  ('automation_enabled',    true,  'Master switch. False stops every automation at send time.'),
  ('automation_live_sends', false, 'Platform-wide permission to send for real. Stays false until a channel is proven.')
on conflict (key) do nothing;


-- ── 9. Row-level security ───────────────────────────────────────────────────
-- Every table on, service-role only. RLS with no policy is how this schema
-- already hides team_secrets and admins; the same shape applies here.
do $$
declare t text;
begin
  foreach t in array array[
    'automation_types','automations','automation_runs','automation_actions',
    'automation_deliveries','automation_capabilities','automation_backtests',
    'platform_flags'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- An explicit deny on the two tables a future leader-facing UI would be most
-- tempted to read directly. A stated `using (false)` is louder to the next
-- reader than the absence of a policy.
drop policy if exists automations_no_read on automations;
create policy automations_no_read on automations
  for select to authenticated using (false);

drop policy if exists automation_deliveries_no_read on automation_deliveries;
create policy automation_deliveries_no_read on automation_deliveries
  for select to authenticated using (false);


-- ── 10. The browser-safe views ──────────────────────────────────────────────
-- Note what is NOT selected: secure_config, sms_live, created_by. And note the
-- predicate: visible_to_leader defaults false on every row, so today these
-- views return nothing to anyone. Flipping that flag per row is the entire
-- leader-exposure mechanism.
--
-- These views deliberately run as their OWNER (the Postgres default), not as
-- the caller. That is load-bearing: `automations` carries a `using (false)`
-- policy, so a caller-rights view would return zero rows forever and the
-- leader-exposure switch would be a switch wired to nothing. Running as owner
-- bypasses that policy, which makes the WHERE clause below the ONLY thing
-- standing between a team lead and this data — so read it carefully. It is the
-- same shape as rep_scenarios_public, and auth.uid() still resolves correctly
-- because it reads the request's JWT claim rather than the current role.
drop view if exists automations_public;
create view automations_public as
  select a.id, a.org_id, a.team_id, a.type_key, a.name, a.mode, a.enabled,
         a.config, a.max_per_day, a.leader_editable, a.updated_at
  from automations a
  join automation_types t on t.key = a.type_key
  where a.visible_to_leader = true
    and t.leader_visible = true
    and is_org_member(a.org_id);

drop view if exists automation_runs_public;
create view automation_runs_public as
  select r.id, r.org_id, r.team_id, r.automation_id, r.type_key, r.status,
         r.summary, r.actions_proposed, r.actions_executed,
         r.started_at, r.finished_at
  from automation_runs r
  join automations a on a.id = r.automation_id
  where a.visible_to_leader = true
    and is_org_member(r.org_id);


-- ── 11. Seed the shelf ──────────────────────────────────────────────────────
-- Three agents. Note the max_mode column, which is the ceiling no instance can
-- exceed:
--   morning_brief       - only ever informs, so it may run unattended.
--   speed_to_lead_nudge - texts an agent about their own lead. Also unattended:
--                         its false positives are self-reporting, because an
--                         agent who replies "I already called her" is telling
--                         you the rule is wrong, for free, before anything has
--                         been moved.
--   lead_reassign       - writes to a customer's CRM. Capped at ask_first here.
--                         Reaching full_auto is a separate, dated migration, so
--                         that going live is a reviewable act rather than a
--                         dropdown someone clicks at 11pm.
insert into automation_types (key, label, blurb, trigger_kind, max_mode, channels, capability, leader_visible)
values
  ('morning_brief',
   'Morning brief',
   'Every morning: yesterday''s new leads, which agent each went to, and who needs a nudge.',
   'schedule', 'full_auto', array['email','relay','twilio'], 'notify.relay', true),

  ('speed_to_lead_nudge',
   'Ten-minute nudge',
   'Texts an agent when a lead they were just given has sat ten minutes with no call or real text.',
   'schedule', 'full_auto', array['relay','twilio'], 'notify.relay', true),

  ('lead_reassign',
   'Hand off an un-worked lead',
   'Moves a lead to another agent when it has sat thirty minutes with no call or real text.',
   'schedule', 'ask_first', array['email','relay','twilio'], 'fub.reassign', false)
on conflict (key) do update set
  label          = excluded.label,
  blurb          = excluded.blurb,
  trigger_kind   = excluded.trigger_kind,
  max_mode       = excluded.max_mode,
  channels       = excluded.channels,
  capability     = excluded.capability,
  leader_visible = excluded.leader_visible;

notify pgrst, 'reload schema';
