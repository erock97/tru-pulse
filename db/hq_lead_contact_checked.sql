-- ═══════════════════════════════════════════════════════════════════════════
-- leads.contact_checked_at — the rotation clock for contact lookups
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
--
-- Reading a lead's calls and texts costs 2 FUB subrequests, so a sync can only
-- afford 250 of them. A team with more in-horizon leads than that (Signature
-- has ~840, Scott Moore ~600) never got the rest read, and — worse — every
-- unread lead was written back as 'worked', erasing a zero_contact flag an
-- earlier run had correctly established. The nightly 07:05 reconcile sees one
-- frame of that flicker, so a lead was struck only if it happened to read
-- zero_contact at that exact moment. The only two teams over the budget were
-- the only two teams missing strikes.
--
-- This column is what lets the budget ROTATE instead of landing on the same
-- leads every run: the sync spends its lookups oldest-checked-first, so every
-- in-horizon lead comes round on a fixed cycle — about four syncs, roughly two
-- hours, for the largest team.
--
-- NULL means "never read", which is deliberately distinct from "read and
-- clean". A lead we have never looked at still defaults to 'worked' and so can
-- never produce a false strike; a lead we HAVE read keeps what we learned.
--
-- Backfill note: every existing row starts NULL, so the first few syncs after
-- this lands will prioritise leads by id and then settle into the rotation.
-- That is the intended cold start — no backfill is needed or wanted, because
-- a fabricated timestamp would claim we had read leads we have not.
-- ═══════════════════════════════════════════════════════════════════════════

alter table leads add column if not exists contact_checked_at timestamptz;

-- The sync orders by this column within one team's in-horizon slice. Nulls
-- first is the default for ASC in Postgres only with NULLS FIRST, and the
-- ordering is done in the Worker rather than in SQL — this index exists for
-- the operational query "which leads has nobody looked at lately", which is
-- how you check the rotation is actually turning.
create index if not exists leads_contact_checked_idx
  on leads (team_id, contact_checked_at nulls first);

notify pgrst, 'reload schema';
