-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — the shelf: tracks, assignment, certificates, module metadata
-- ═══════════════════════════════════════════════════════════════════════════
-- Additive + idempotent. Writes are service-role-only (no client INSERT/UPDATE
-- policies) — same contract as db/hq_rep_authoring.sql.

-- ── 1. Module metadata for browsing ─────────────────────────────────────────
alter table rep_modules add column if not exists kind         text not null default 'lesson';
alter table rep_modules add column if not exists duration_min int;
alter table rep_modules add column if not exists level        text;
alter table rep_modules add column if not exists tags         text[] not null default '{}';
alter table rep_modules add column if not exists cover        text;
alter table rep_modules add column if not exists version      int not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rep_modules_kind_check') then
    alter table rep_modules add constraint rep_modules_kind_check
      check (kind in ('lesson','sim','voice','assignment'));
  end if;
end $$;

-- ── 2. Tracks ────────────────────────────────────────────────────────────────
-- org_id NULL = a shared TRU track every team sees, mirroring rep_modules.
create table if not exists rep_tracks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references orgs(id) on delete cascade,
  slug       text not null,
  title      text not null,
  subtitle   text,
  cover      text,
  order_idx  int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists rep_tracks_global_slug_uk on rep_tracks (slug) where org_id is null;
create unique index if not exists rep_tracks_org_slug_uk    on rep_tracks (org_id, slug) where org_id is not null;

create table if not exists rep_track_modules (
  track_id  uuid not null references rep_tracks(id) on delete cascade,
  module_id uuid not null references rep_modules(id) on delete cascade,
  idx       int  not null default 0,
  required  boolean not null default true,
  primary key (track_id, module_id)
);
create index if not exists rep_track_modules_track_idx on rep_track_modules (track_id, idx);

-- ── 3. Assignment ────────────────────────────────────────────────────────────
create table if not exists rep_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  learner_id   uuid not null references rep_learners(id) on delete cascade,
  track_id     uuid not null references rep_tracks(id) on delete cascade,
  due_at       timestamptz,
  assigned_by  uuid references auth.users(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (learner_id, track_id)
);
create index if not exists rep_assignments_org_idx on rep_assignments (org_id, due_at);

-- ── 4. Certificates ──────────────────────────────────────────────────────────
create table if not exists rep_certificates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  learner_id    uuid not null references rep_learners(id) on delete cascade,
  track_id      uuid not null references rep_tracks(id) on delete cascade,
  issued_at     timestamptz not null default now(),
  signed_off_by text,
  unique (learner_id, track_id)
);
create index if not exists rep_certificates_org_idx on rep_certificates (org_id, issued_at desc);

-- ── 5. RLS — reads only; every write goes through the Worker ─────────────────
alter table rep_tracks        enable row level security;
alter table rep_track_modules enable row level security;
alter table rep_assignments   enable row level security;
alter table rep_certificates  enable row level security;

-- Tracks: global or own-org — the same predicate rep_modules_read uses, so a
-- learner agent (anon-role token) can read the shared shelf.
drop policy if exists rep_tracks_read on rep_tracks;
create policy rep_tracks_read on rep_tracks for select to anon, authenticated
  using (org_id is null or is_org_member(org_id));

drop policy if exists rep_track_modules_read on rep_track_modules;
create policy rep_track_modules_read on rep_track_modules for select to anon, authenticated
  using (exists (select 1 from rep_tracks t
                  where t.id = track_id and (t.org_id is null or is_org_member(t.org_id))));

-- Assignments / certificates: a leader sees their org's; a learner sees their own.
drop policy if exists rep_assignments_org_read on rep_assignments;
create policy rep_assignments_org_read on rep_assignments for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_assignments_self_read on rep_assignments;
create policy rep_assignments_self_read on rep_assignments for select to authenticated
  using (learner_id in (select id from rep_learners
                         where user_id = auth.uid()
                            or agent_id in (select id from agents where auth_id = auth.uid())));

drop policy if exists rep_certificates_org_read on rep_certificates;
create policy rep_certificates_org_read on rep_certificates for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_certificates_self_read on rep_certificates;
create policy rep_certificates_self_read on rep_certificates for select to authenticated
  using (learner_id in (select id from rep_learners
                         where user_id = auth.uid()
                            or agent_id in (select id from agents where auth_id = auth.uid())));

notify pgrst, 'reload schema';
