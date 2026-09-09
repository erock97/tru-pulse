# H05 — receipt receiver deployment

Deployed code revision: `2b16eb7` (full revision recorded by git below).
Reviewed receipt source remains e1966bcd0e7eb9e31ab885841accd5857d83ae95;
receipt handler, canonical hash module and migration are unchanged from it.
Integrated onto current main e95df6f to preserve newer product-engagement work.
The only cherry-pick conflict combined the coverage notice with the newer mobile
Coach workspace class. No UI was deployed in this step.

Prerequisites: Notion H01/H02 verified at laptop revision
a9f0c946c6d6c9ad97b0652cfcd523c3af924f3f, 223 tests passed, one Windows-only skip.
All six Linux credential bindings passed; pause checkpoint
2026-09-09T02:10:22Z: legacy pause intact, receipt/coverage/timing/scheduled gates
false, empty private receipt store, no running publisher/recovery process.
H03/H04 verified separately in PR #204.

Before deployment:
- Worker dc8401eb-cde9-4df1-a972-2d977ef34ff6.
- Production UI aeecbbc2-9e20-4e1d-8562-4c9b6e141cd2, source e95df6f.

Deployment:
- Supabase project yeyoteredgunhvhqmais.
- Reviewed migration file 20260908181709_report_receipt_controls.sql applied
  unchanged through the migration API. Server-assigned history version
  **20260909022501**, name report_receipt_controls. This version differs from the
  source filename because the API records the actual application timestamp.
- Seven-entry COACH_REPORT_CLIENTS installed from Infisical: six unchanged
  producers and isolated eric-receipt-operator.
- Worker **9129ab1a-cf6d-4a08-b47e-4c6cab459cfe**, tru-pulse-sync.
- https://api.truhq.co and existing workers.dev endpoint active.
- Existing four cron expressions, Durable Objects, KV and service binding retained.
- UI unchanged. Partial publishing remains disabled.

Verification:
- Worker and web TypeScript checks passed.
- 124 targeted Worker tests passed: receipt 67, coverage 17, timing 20,
  existing newer coaching-assignment functionality 20.
- Production migration present; all five receipt functions deny execute to anon
  and authenticated, permit service_role. Service role cannot update/delete audit.
- All six actual producer tokens: unused-run lookup returns 404 not_found with
  Cache-Control no-store.
- Signature token looking up Satish: 403. Producer POST to control with empty
  JSON: 403. Unrecognized bearer on submission/control: 401 unauthorized.
  No valid report/control payload submitted. The old actual credential was not
  retrieved for this probe; no-fallback behavior is additionally covered in the
  receipt source/tests. Existing directory authentication was not changed.
- Existing Costigan broker workspace: published Coach report selector, eight
  people and report headings rendered. Returned to owner workspace afterward.
- Exact historical inventory remains 45 published and 5 held; other 5 IDs absent.
- Controlled receipt count remains zero after migration. No customer report
  submitted, released, withdrawn, superseded, renamed or migrated.

Next: laptop H06 manual synthetic canary through the new sender. It must remain
HELD and invisible to brokers; verify hash/lookup/replay/conflict/role boundaries.
Scheduled delivery remains off. H07 first real release needs Eric's exact approval.
No automatic or partial release. Keep all 55 legacy blocks and 11 quarantines.

Recovery: pause senders; preserve receipt, audit, immutable guards and provenance;
disable controlled writes/controls if necessary and forward-fix. Do not restore
the old auto-publishing receiver or run a destructive down migration.
