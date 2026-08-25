-- ═══════════════════════════════════════════════════════════════════════════
-- Brief relay — getting the daily brief onto a phone
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
--
-- There is no Twilio number yet, so the phone that sends the text is Eric's own,
-- driven by Tasker: it polls a URL on a schedule and sends whatever comes back.
-- The existing agent-nudge relay in fub-kpi-puller works exactly this way, and
-- this deliberately speaks the same wire format so cloning that Tasker profile
-- and changing the URL is the whole setup.
--
-- What it does NOT copy is that relay's one real flaw. Its queue endpoint hands
-- back the same blob to every caller, so a retry, a second phone, or Tasker
-- firing twice on a flaky network re-sends everything. Here, asking for the
-- queue CLAIMS it: the unique key below is taken in the same statement that
-- builds the message, so the second caller finds the row already there and gets
-- nothing. That is the only reason this is a table rather than a cache.
--
-- ── Why claiming and telling are separate ───────────────────────────────────
-- Claiming stops a double send today. Marking the underlying habits as "told"
-- (coach_patterns.last_briefed_at) is a different decision, and it waits for the
-- phone to confirm the text actually left. If Tasker claims the brief and then
-- fails to send it, the claim still stands -- so nothing goes out twice today --
-- but the habits stay unmarked and tomorrow offers them again. A lost text is
-- retried rather than silently dropped, which is the failure that would be
-- impossible to notice.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Who gets a brief ─────────────────────────────────────────────────────
-- One row per (team, kind, phone). Today every row points at Eric: phase 1 is
-- deliberately one recipient he knows personally, because on this relay a reply
-- of STOP arrives on his own handset where no code can see it. Opting out is a
-- manual act until Twilio lands, and that is only acceptable while the
-- recipient is him.
--
-- The number is never committed and never pasted into a chat. It arrives
-- through POST /admin/brief-recipient and lives here.
create table if not exists brief_recipients (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  kind        text not null default 'coach_daily',
  phone       text not null,             -- E.164 digits, no punctuation
  label       text,                      -- "Eric" — for the admin list, not the message
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (team_id, kind, phone)
);


-- ── 2. Every brief that was built, claimed, and sent ────────────────────────
-- The idempotency key is what makes a poll safe to repeat. It is
-- (team, kind, local date), so a second poll on the same morning collides
-- rather than queueing a second message -- and it is claimed by the INSERT
-- itself, not by a read-then-write that two concurrent polls could both pass.
create table if not exists brief_sends (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references orgs(id)  on delete cascade,
  team_id          uuid not null references teams(id) on delete cascade,
  kind             text not null default 'coach_daily',
  local_date       date not null,
  idempotency_key  text not null unique,   -- '<team>:<kind>:<yyyy-mm-dd>'

  recipient        text not null,          -- E.164; redacted everywhere it is displayed
  body             text not null,
  segments         integer not null default 1,
  -- The habits this message spoke for. Marked as told only once the phone
  -- confirms the send, so a failed delivery is offered again tomorrow.
  pattern_ids      jsonb not null default '[]'::jsonb,

  -- queued -> claimed -> sent. 'skipped' records a build that deliberately
  -- produced nothing, so a quiet morning is distinguishable from a broken one.
  status           text not null default 'queued',
  skip_reason      text,

  built_at         timestamptz not null default now(),
  claimed_at       timestamptz,
  sent_at          timestamptz
);

create index if not exists brief_sends_day_idx on brief_sends (team_id, local_date desc);


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role only, no policy. `brief_sends.body` is the one place a full
-- message lives, and `brief_recipients.phone` is a personal mobile number.
-- Neither is reachable from a browser at any role.
alter table brief_recipients enable row level security;
alter table brief_sends      enable row level security;

notify pgrst, 'reload schema';


-- ── Grants ──────────────────────────────────────────────────────────────────
-- Same reasoning as hq_coach_patterns.sql: RLS-with-no-policy stops user roles
-- at the policy layer, but Supabase's default privileges still hand out
-- table-level SELECT. Revoked so nothing depends on the policy layer being the
-- only wall — one of these holds a personal phone number and the other holds
-- full message bodies.
revoke all on brief_recipients, brief_sends from anon, authenticated;
