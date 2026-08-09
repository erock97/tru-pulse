-- Public application submissions from truhq.co/apply.
--
-- Written ONLY by the Worker's service role. RLS is enabled with ZERO policies,
-- so anon and authenticated clients can read nothing and write nothing — the
-- same posture as team_secrets. This table holds names, work emails, and
-- business context for people who are not customers yet; nothing in the browser
-- has any business reading it.

create table if not exists applications (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  full_name         text not null,
  email             text not null,
  role              text not null,
  team_size         text not null,
  bottleneck        text not null,

  -- Consent is stored with the EXACT wording shown at the time, not a boolean
  -- alone. That is the whole point: what someone agreed to must be provable
  -- later, not inferred from whatever the page happens to say by then.
  marketing_opt_in  boolean not null default false,
  consent_text      text not null,
  consent_at        timestamptz not null,

  source_path       text,
  ip_hash           text,          -- salted SHA-256; supports rate limiting, not identification
  user_agent        text

  -- Deliberately NO phone column. We do not collect a phone number.
);

create index if not exists applications_created_idx on applications (created_at desc);
create index if not exists applications_ip_idx on applications (ip_hash, created_at desc);

-- Enabled with no policies at all => every client role is denied by default.
alter table applications enable row level security;
revoke all on applications from anon, authenticated;
