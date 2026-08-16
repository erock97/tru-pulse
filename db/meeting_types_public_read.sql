-- ═══════════════════════════════════════════════════════════════════════════
-- meeting_types: public vs owner-only
-- ═══════════════════════════════════════════════════════════════════════════
-- Propose this in the SQL Editor (or supabase db push) ONLY after Eric says
-- to apply it. Do not run it against production as a side effect of a code
-- task. This file is the migration. It is not an instruction to apply it.
--
-- Why: `published` means "this type is active for its owner." All five live
-- types are published, so anon RLS `meeting_types_public_read` (`published =
-- true`) lets anyone with the page's publishable key list internal names
-- (1:1 With Eric, Intro call, Leadership Sync, Strategy session).
--
-- The public book page already allowlists `client-consultation-call` in
-- web/public/book/book.js. That is defense in depth. This file is the real
-- gate: a stranger using PostgREST directly must not see internal types.
--
-- After apply (preview / test project — not before Eric says so):
--
--   GET {SUPABASE}/rest/v1/meeting_types?select=slug,name,description,duration_minutes&published=eq.true&order=sort_order.asc
--   Headers: apikey and Authorization Bearer = the publishable/anon key
--
--   Must return only client-consultation-call.
--   slug=eq.1-1-with-eric (or intro / leadership-sync / deep-dive) must
--   return []. slug=eq.client-consultation-call must still return that row.
--   A signed-in owner (user_id = auth.uid()) must still see their own
--   internal types. Service role is unchanged (bypasses RLS).
-- ═══════════════════════════════════════════════════════════════════════════

-- Future inserts stay private unless someone explicitly sets is_public.
alter table meeting_types
  add column if not exists is_public boolean not null default false;

alter table meeting_types
  alter column is_public set default false;

-- One public slug. Everything else, including any leftover null, is false.
update meeting_types
set is_public = (slug = 'client-consultation-call');

alter table meeting_types
  alter column is_public set not null;

comment on column meeting_types.is_public is
  'True only for types strangers may read via anon PostgREST. published means active for the owner, not public.';

-- Anon (and a signed-in visitor who is not the owner) may read the consult.
drop policy if exists meeting_types_public_read on meeting_types;
create policy meeting_types_public_read on meeting_types
  for select
  to anon, authenticated
  using (published = true and is_public = true);

-- Owner-scoped booking / settings: Eric still sees his own internal types
-- when logged in. OR'd with the public policy above.
drop policy if exists meeting_types_owner_read on meeting_types;
create policy meeting_types_owner_read on meeting_types
  for select
  to authenticated
  using (user_id = (select auth.uid()));
