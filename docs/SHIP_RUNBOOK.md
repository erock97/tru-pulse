# Ship runbook — interior redesign (the workaround)

## The key realization that unblocks shipping
Per `DEPLOY.md`, **Web (Cloudflare Pages), Worker (`wrangler deploy`), and DB migrations
(manual SQL Editor) are THREE independent deploy actions.** Nothing rides along
automatically — a Pages build of `web/` does **not** deploy the worker and does **not** run
any migration. So the redesign frontend can ship on its own, and the backend/migration are
separate, deliberate steps. The audit's "NO-GO as-is" was about a *naive full merge+deploy*;
done in the right order it's a **GO**.

## What is safe right now
- **Frontend (`web/`)** = the redesign. Verified presentation-only (Blocks 2–5: zero
  data/auth/fetch/RLS). Ships via a Pages build. Does not touch the worker or DB.
- **Only coupling** to the inherited backend: the **admin-only** "Team connections" panel
  (platform owners) calls two new worker routes (`/admin/connections`,
  `/admin/connect-fub`). Regular org users and every redesigned surface are unaffected.

## Deploy order (safe)
1. **Pages (`web/`)** — ships the visual redesign. Safe to do first and alone.
2. **Worker (`wrangler deploy`)** — needed for the admin connections panel + sync/stage-log.
   Quick review first: the diff is 3 admin routes + sync/stage-log logic (`git diff main
   438e951 -- worker/`).
3. **Migration `db/hq_stage_log.sql`** — now **idempotent & non-destructive** (`create …
   if not exists`; the old `drop table … cascade` was removed). Run once in the Supabase SQL
   Editor; safe even if re-run. Creates `person_stage_log`, which the worker's sync writes.
   Its RLS is org-scoped (`is_org_member(org_id)`) — tenant isolation intact.

## Workarounds applied this pass
- **Destructive migration → safe.** `db/hq_stage_log.sql` no longer drops the table; it can
  never destroy accrued data on a cutover.
- **Coach previewable.** Added an `isDemo` roster (`loadRoster` → `demoAgentRows`, demo-only,
  never touches Supabase) so Coach renders on `?demo=1` like every other tab — closing the
  audit's "Coach unverified" gap and giving a clean sales demo.

## Still open (decide before / at launch)
- **Auth screens** (Login/Onboarding/SetPassword) aren't on the system yet — do the auth
  block (reuse landing video, `DESIGN_HANDOFF.md §7`) or ship as-is with a known seam.
- **Coach agent drill** ("Prep 1:1") still needs real data — the demo path covers the
  dashboard, not the per-agent detail. Verify in staging.
- **Confirm the admin "Team connections" panel** against the deployed worker.

## Verdict
**GO** for the interior redesign as an independent Cloudflare Pages build. The worker and the
(now non-destructive) migration are separate, deliberate steps — de-risked, not blockers.
