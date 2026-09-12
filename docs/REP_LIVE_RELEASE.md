# Rep live-session release record

## Authorization and prepared build

Eric approved production release after reviewing the updated palette and simplified session setup on September 12, 2026. Session creation defaults follow-up ownership to the authenticated presenter; agents use their existing accounts.

The deployed frontend identified source `7f0ad9822a85594c73ca91fdf88226b4859f9bb3`, which was not contained in `origin/main`. Its already-live history-reporting changes were merged into the training branch before release. This preserves historical coverage warnings, source provenance, and stage receipt handling.

The combined tree passes frontend TypeScript and 500 tests, Worker TypeScript and 804 tests plus six native Node operations tests. The production build uses `https://api.truhq.co`; the Worker dry run succeeds with existing durable-object, KV, service, and custom-domain bindings.

## Pre-release production observations

- Supabase project: TRU-Pulse (`yeyoteredgunhvhqmais`). No development branches or separate TRU-Pulse staging project were present.
- The live-session tables and mutation function are not yet present in production.
- Existing browser authentication works on the live app. The new session route is not deployed yet.
- Existing Worker rollback version: `dbd043f3-043e-4794-9d3a-22783aa38888`.
- Existing Pages deployment: `26d5cca0-ac36-45ac-a71e-516571d1c2fc`.

## Remaining release work

1. Confirm the temporary Supabase branch cost of $0.01344/hour, create it, and validate the additive migration against hosted schema and access rules. Remove the temporary branch after validation.
2. Apply the reviewed live-session migration to production. Do not rerun unrelated history migrations.
3. Deploy the Worker with existing variables retained and live-session/digest flags enabled. Deploy the verified Pages build after the Worker succeeds.
4. Verify the authenticated session list, presenter setup, shared-view restrictions, existing Rep workshops, and delivery status on the deployed app. Do not generate assignments or send test mail to real agents.
5. Record deployment identifiers and checks here. Retain additive tables if rolling back; disable live flags and restore prior application versions as needed.

Production has not been changed by this release yet. The paid test-branch confirmation is pending; production-release authorization does not need to be requested again.
