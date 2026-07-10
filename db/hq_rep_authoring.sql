-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — authoring: custom modules, uploaded media, and their storage
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
-- Block 1 of the Rep authoring feature (SQL only). Lets an org author its own
-- rep_modules (org_id set) alongside the shared TRU curriculum (org_id null),
-- with a draft → published → archived lifecycle, and adds a private storage
-- bucket so authored lessons can embed uploaded video/PDF/slide assets.
--
-- Writes to rep_modules / rep_questions / rep-media ALWAYS go through the
-- Cloudflare Worker using the SERVICE ROLE — exactly like every other write
-- path in this schema (see schema.sql header). There are deliberately no new
-- client-facing INSERT/UPDATE RLS policies added here for authoring; the
-- browser only ever reads.
--
-- ── The new 'media' card variant (cards jsonb convention) ────────────────────
-- rep_modules.cards already holds a heterogeneous array of typed lesson cards
-- (see hq_rep_v3.sql: text/stat/stats/dialogue/script/compare/drill/callout/
-- video/steps). This file *reserves* one more shape — no schema change needed,
-- cards is jsonb:
--
--   { "t":"media", "kind":"video"|"pdf"|"slide", "path":"<org_id>/<uuid>.<ext>", "title":"..." }
--
-- This is an UPLOADED asset reference — "path" is an object key inside the
-- private `rep-media` bucket created below (first path segment = org_id, so
-- storage RLS can scope it). It is distinct from the existing
-- { "t":"video", "url":"...", "title":"...", "body":"..." } card (AgentCourse.tsx),
-- which embeds an external URL (Loom/YouTube) via <iframe src=embedUrl(url)>.
-- Rendering both card kinds is Block 3/4's job; this block only documents +
-- reserves the shape and gives it somewhere private to live.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. rep_modules: authorship columns ───────────────────────────────────────
-- author_id: the auth.users row that authored/owns a custom module. Nullable —
-- the 24 shared TRU modules (org_id null) have no author and stay NULL forever.
-- References auth.users(id) directly, matching the existing reference pattern
-- for user-authored rows in this schema (see agents.auth_id in hq_coach.sql /
-- hq_rep_agent.sql: `references auth.users(id) on delete set null`).
alter table rep_modules add column if not exists author_id uuid references auth.users(id) on delete set null;

-- source: 'system' = shipped TRU curriculum content; 'custom' = org-authored.
-- Independent of org_id (an org could theoretically be handed a org-scoped
-- system module later) but in practice today source='custom' implies org_id
-- is set.
alter table rep_modules add column if not exists source text not null default 'system';

-- status: authoring lifecycle, separate from the existing `active` boolean.
-- `active` is (and remains) the runtime on/off switch; `status` is where a
-- module sits in the authoring workflow (draft = being written, not yet
-- shown to agents; published = live; archived = retired but kept for history).
-- NOTE: neither `active` nor `status` is filtered inside the existing RLS
-- policies below (rep_modules_read has no `active`/`status` predicate) — that
-- filtering already happens at the app/query layer today for `active`, and
-- Block 2/3 must do the same for `status` (e.g. only query
-- status = 'published' for the agent-facing course list; drafts stay visible
-- to the authoring org via the leader UI only).
alter table rep_modules add column if not exists status text not null default 'published';

-- Idempotent CHECK constraints (ADD CONSTRAINT has no IF NOT EXISTS, so guard
-- via pg_constraint).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rep_modules_source_check'
  ) then
    alter table rep_modules
      add constraint rep_modules_source_check check (source in ('system','custom'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rep_modules_status_check'
  ) then
    alter table rep_modules
      add constraint rep_modules_status_check check (status in ('draft','published','archived'));
  end if;
end $$;

-- org_id, cards, pass_pct, active are unchanged.

-- ── 2. RLS: no new client write policies — writes are service-role-only ─────
-- The Worker's /rep/* routes already write rep_modules / rep_questions with
-- the service role (bypasses RLS), exactly like every provisioning write in
-- this schema (schema.sql header: "there are no INSERT/UPDATE policies for
-- `authenticated`"). Authoring keeps that pattern — a leader's authoring UI
-- calls Worker endpoints, which write with the service role. Do NOT add
-- authenticated INSERT/UPDATE policies on rep_modules or rep_questions here.
--
-- Reads of custom (org-scoped) rows are ALREADY covered by existing policies:
--   - rep_modules_read (hq_rep.sql): for select to anon, authenticated
--       using (org_id is null or is_org_member(org_id))
--   - rep_questions_public view (hq_rep_agent.sql), which replaced the base
--     table's select policy: exposes only id/module_id/idx/prompt/choices,
--     filtered by the same (m.org_id is null or is_org_member(m.org_id))
--     predicate, so answers never reach the browser for custom modules either.
-- Both predicates already permit an org member to read their own org's custom
-- rows. Nothing to add.

-- ── 3. Storage: private `rep-media` bucket for uploaded lesson assets ───────
-- Never public — assets are served later via signed URLs (Block 3/4). Path
-- convention: the object key's FIRST path segment is the owning org_id, e.g.
-- `<org_id>/<uuid>.<ext>` — this is what the storage policies below scope on.
insert into storage.buckets (id, name, public)
values ('rep-media', 'rep-media', false)
on conflict (id) do nothing;

-- Enforce upload size/type at the bucket itself (defense-in-depth alongside
-- the Worker's REP_UPLOAD_EXTS / REP_UPLOAD_CT_RE allow-list) — safe to
-- re-run, it just sets these two columns.
update storage.buckets
set file_size_limit = 524288000,  -- 500 MB, enough for a training video
    allowed_mime_types = array[
      'video/mp4','video/quicktime','video/webm','video/x-m4v',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/vnd.apple.keynote',
      'application/vnd.oasis.opendocument.presentation'
    ]
where id = 'rep-media';

-- NOTE: RLS is already enabled on storage.objects by Supabase — we do NOT run
-- `alter table storage.objects enable row level security` here because the SQL
-- Editor role is not the table owner (that statement errors 42501). Policies
-- below are creatable by the role as-is.

-- A user may read/write an object only when the first path segment is an
-- org_id they belong to (is_org_member takes a uuid — storage.foldername()
-- returns text[], so the first segment is cast to uuid).
drop policy if exists rep_media_select on storage.objects;
create policy rep_media_select on storage.objects for select to authenticated
  using (
    bucket_id = 'rep-media'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists rep_media_insert on storage.objects;
create policy rep_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'rep-media'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists rep_media_update on storage.objects;
create policy rep_media_update on storage.objects for update to authenticated
  using (
    bucket_id = 'rep-media'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'rep-media'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists rep_media_delete on storage.objects;
create policy rep_media_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'rep-media'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- ── 4. Reuse existing helpers ─────────────────────────────────────────────────
-- is_org_member(uuid) and has_org_role(uuid, text) are defined in schema.sql
-- and are NOT redefined here.

notify pgrst, 'reload schema';
