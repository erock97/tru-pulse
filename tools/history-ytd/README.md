# TrueHQ YTD history

Public census and saved-evidence adoption are separate from historical collection,
validation, and publication. None of these scripts performs website login or
reconstructs transitions from current stages.

Run `inventory.sql` read-only against the target database and save its `inventory`
object privately. Supply the verified account audit separately; it contains no
secret values. Never commit real census records, ledgers, or snapshots.

```
node tools/history-ytd/census.mjs inventory.json audit.json private/census [team-id ...]
node tools/history-ytd/adopt.mjs inventory.json audit.json private/backfill 2026-09-12T02:16:35.917Z
node --test tools/history-ytd/ledger.test.mjs
```

`census.mjs` reads the public API using existing Infisical credentials in memory.
It verifies numeric account identity and domain before listing users, registrations,
and all accessible people (including older leads and trash). Requests are serial,
bounded to 2,000 pages per endpoint, with four attempts and rate-limit handling.
Only exact approved source labels qualify. A failed census is unknown, never zero.
No registration writes are made by the census.

`adopt.mjs` reparses original private receipts, preserves their offsets and original
IDs, and commits per-account checkpoints with an exclusive writer lock and atomic
rename. Resume by rerunning the same command and cutoff. After a killed process,
verify the PID in `*.lock` is no longer running before removing that specific lock.
The `*.tmp` file is never accepted as committed state. Unknown descriptions and
conflicting event identities fail the receipt before any event is added.

Coverage uses half-open intervals. The legacy date-only September 5 endpoint is
conservatively September 5 midnight Pacific. Legacy checkpoints lack page receipts;
they are collected evidence with validated event parsing, not certified interval
coverage. Reuse their events, but do not promote their coverage by assertion.
Current-owner profile counts do not prove historical ownership. All profile
exclusions are retained; missing mappings, inaccessible people and ambiguous
sources remain explicit review items.

## Production sequence and rollback

1. Validate the additive migration in isolated PostgreSQL. Apply it before enabling
   canonical receipt draining. Populate `history_accounts` only from refreshed
   `/identity` results matched against database team/org IDs.
2. Record the current Cloudflare deployment/version and download its bundle. Compare
   production edits before deploying from the reviewed implementation branch.
3. Deploy durable envelope retention and draining. Original per-event/person
   receipts remain in the existing queue after import. A failed import does not
   discard pending evidence or prevent the existing reconciliation from running.
4. Verify real per-team processing receipts and reconciliation. Active webhook
   registration alone is insufficient. Freeze the final collection cutoff after
   forward persistence is verified; the dry-run cutoff above is provisional.
5. Complete historical exports, validate intervals and the historical/live overlap,
   then publish immutable snapshots through the authenticated history interface.
   Never label incomplete jobs validated or published to bypass a collection blocker.

Before a rollback, preserve outstanding durable receipts. Roll back the worker to
the recorded version only when necessary; that version may lack event retention,
so record any resulting live gap. Leave the additive provenance tables intact.
Do not drop evidence as part of rollback. Historical snapshots and live leads are
not mutated by census, local adoption, or receipt draining.

The old timeline-session implementation remains retired. New missing history needs
an authorized provider export or a reviewed capture with an existing authorized
session. A login form, expired session, client block, or missing permission is a
collection blocker, not permission to restart automated logins.
