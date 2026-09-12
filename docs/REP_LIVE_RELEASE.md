# Rep live-session release record

## Authorization and prepared build

Eric approved production release after reviewing the updated palette and simplified session setup on September 12, 2026. Session creation defaults follow-up ownership to the authenticated presenter; agents use their existing accounts.

The deployed frontend identified source `7f0ad9822a85594c73ca91fdf88226b4859f9bb3`, which was not contained in `origin/main`. Its already-live history-reporting changes were merged into the training branch before release. This preserves historical coverage warnings, source provenance, and stage receipt handling.

The combined tree passes frontend TypeScript and 500 tests, Worker TypeScript and 810 tests plus six native Node operations tests. The production build uses `https://api.truhq.co`; the Worker dry run succeeds with existing durable-object, KV, service, and custom-domain bindings.

## Pre-release production observations

- Supabase project: TRU-Pulse (`yeyoteredgunhvhqmais`). No development branches or separate TRU-Pulse staging project were present.
- The live-session tables and mutation function are not yet present in production.
- Existing browser authentication works on the live app. The new session route is not deployed yet.
- Existing Worker rollback version: `dbd043f3-043e-4794-9d3a-22783aa38888`.
- Existing Pages deployment: `26d5cca0-ac36-45ac-a71e-516571d1c2fc`.

## Remaining release work

1. Completed isolated PGlite migration/access tests and a read-only comparison against the production schema. No paid branch was created. Hosted load testing and a real remote cohort remain unperformed; the local timing is not a production SLA.
2. Applied `rep_live_training_sessions` to production successfully. Verified all seven tables have RLS, no anonymous read/browser insert grants, and service-only session RPCs. No unrelated history migrations were rerun.
3. Deploy the Worker with existing variables retained and live-session/digest flags enabled. Deploy the verified Pages build after the Worker succeeds.
4. Verify the authenticated session list, presenter setup, shared-view restrictions, existing Rep workshops, and delivery status on the deployed app. Do not generate assignments or send test mail to real agents.
5. Record deployment identifiers and checks here. Retain additive tables if rolling back; disable live flags and restore prior application versions as needed.

Production migration and publication are complete. Worker version: `26d980c7-7aae-4ce2-9658-283d049b2919`. Initial Pages release: `f77a0776.tru-pulse-app.pages.dev`. Both live-session and daily digest flags are enabled. The temporary paid branch was not created.

Browser verification used the existing signed-in owner account after returning from a team impersonation view. The live roster and four training choices loaded correctly; the existing Rep workshop library, guides, and quiz identities remained visible. An unauthenticated API request returned 401. No real-agent session, follow-up assignment, or test email was created. A small frontend follow-up adds the owner-home entry, a return-to-owner notice, and roster filters.
