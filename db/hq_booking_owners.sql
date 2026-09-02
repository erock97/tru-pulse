-- ── Booking: per-admin calendars ─────────────────────────────────────────────
-- Two admins, two calendars. Which calendar an admin administers is a stored
-- fact, not a guess: Eric's personal login (39e87329-…) administers the
-- calendar that has always been owned by the old shared admin@ user
-- (d6b9504c-…) — the one the desk engine, the public /book page, and every
-- existing booking are keyed to. Moving that ownership would have meant
-- re-pointing the engine and the public page in the same breath; a mapping
-- row costs one join and moves nothing.
--
-- Both tables are service-role only (RLS on, no policies), same as the money
-- tables: the browser never touches them, the worker does.

create table if not exists booking_admins (
  admin_id uuid primary key,           -- auth user id of the signed-in admin
  owner_id uuid not null,              -- user id whose booking rows they run
  created_at timestamptz not null default now()
);
alter table booking_admins enable row level security;

-- One row per calendar owner: is there a real Google account behind this
-- calendar? 'infisical' marks the original desk wiring (Eric's refresh token
-- lives in the vault and the Python engine reads it there — no token here).
-- 'google' rows carry a refresh token captured by the worker's link flow,
-- AES-GCM encrypted with FUB_ENC_KEY. A calendar with no 'live' row here
-- cannot publish meeting types: a published link books real meetings, and
-- there must be a calendar to put them on.
create table if not exists booking_calendar_links (
  owner_id uuid primary key,
  provider text not null check (provider in ('infisical', 'google')),
  status text not null default 'live' check (status in ('live', 'revoked')),
  refresh_token_enc text,              -- null for provider='infisical'
  google_email text,                   -- which Google account, for display
  linked_at timestamptz not null default now()
);
alter table booking_calendar_links enable row level security;

-- Seeds. Eric's personal login runs the original calendar, whose Google side
-- has been live through the vault since the scheduler shipped.
insert into booking_admins (admin_id, owner_id)
values ('39e87329-2df5-429a-b59c-5ed2a37aaee8', 'd6b9504c-f35e-49c9-af99-6a2de2069db8')
on conflict (admin_id) do nothing;

insert into booking_calendar_links (owner_id, provider, status)
values ('d6b9504c-f35e-49c9-af99-6a2de2069db8', 'infisical', 'live')
on conflict (owner_id) do nothing;

notify pgrst, 'reload schema';
