# Desktop receipt operations — H03 / H04

This tooling adds no receiver routes or report-contract changes. It targets receiver
`e1966bcd0e7eb9e31ab885841accd5857d83ae95`. Deployment is H05, not this PR.
No production report endpoint was called during H03/H04.

## Operator access (provisioned 2026-09-09 UTC)

The shared producer project grants the existing `jarvis-brain-laptop` identity
the project-wide Viewer role. A new folder there would not isolate release
authority. Existing identity permissions were left unchanged.

Created **TruHQ Receipt Operators**, project
`744e501e-1a55-41c1-a7d9-a4bede367a63`, in the existing organization
`140cbcc9-3902-4950-81dd-a06db7884a2e`.

Operator reference: environment `prod`, path
`/TruHQ/Receipts/Operators/eric`, key `TOKEN`, domain
`https://app.infisical.com/api`.

Verified project memberships: Eric's user alone, no group memberships and no
machine identity memberships. The six scoped producer bootstraps cannot retrieve
the operator token. These checks do not claim to revoke an organization's admin
authority or Eric's human access from another machine. Runtime isolation requires
the laptop sender to receive only its scoped bootstrap, as specified in H01.

The deployed registry entry `eric-receipt-operator`, role `operator`, has the six
previously verified team UUIDs. The local operator map now also recognizes Maggie,
but that seventh UUID is not yet provisioned in the registry. SHA-256 binding was
verified against the
actual token through the command's resolver. Six producer entries preserved
unchanged. Registry remains in the existing producer project at
`/TruHQ/Receipts/Receiver/COACH_REPORT_CLIENTS`; **not installed in Cloudflare**.
Only its hash is present there; the operator token is in the isolated project.

Do not hand the operator project/token/login to the laptop runtime. Operator
lookup uses the desktop human CLI session and removes inherited service/machine
token overrides. Tokens remain in memory; command files contain metadata only.

## Review and execution

Node built-ins only. Use a verified absolute path to the desktop Infisical binary.
The command has no default mutation, scheduler, report submission or automatic
retry. `prepare` is offline and needs no credentials. `lookup` is a live metadata
read; `execute` is a live control and must only be invoked after Eric approves
the exact report/action. Do not execute either against an undeployed receiver.

```text
node ops/receipts/operator.mjs lookup <account> <runId> <absoluteInfisicalExe>
node ops/receipts/operator.mjs prepare <receiptJson> <account> release <approvalReference> <newCommandFile>
node ops/receipts/operator.mjs execute <commandFile> <approvedCommandSha256> <approvalReference> <absoluteInfisicalExe>
```

Prepare accepts a receipt object or `{receipt: ...}`. It displays the exact wire
command and SHA-256 of the command file. That **file hash** binds Eric's approval;
it is distinct from `expectedHash`, the receiver's existing canonical report hash.
The approval reference must identify the real approval before execution; preparing
a reference does not establish that Eric approved anything. Present the report
preview, account, window, coverage, run/hash/revision and action to Eric.

Routine launch release accepts complete or partial coverage after Eric approves
the exact report/action and command-file hash. Unknown coverage remains held.
Partial release does not publish unsupported coaching: the immutable report must
retain its actual coverage gaps, while only evidence-backed findings enter the
derived projection. The command supports release and withdraw; supersession is
intentionally not exposed by this minimal launch tool. Acceptance never releases
a report automatically.

Execution verifies the approved file hash, obtains current receipt metadata,
checks the exact report hash/revision and coverage, sends the exact prepared body
once, then performs a fresh lookup to verify publication/derived state. It still
returns `brokerVisibilityVerified:false`: the correct broker view must be checked
separately. A metadata receipt is not a report preview.

## Ambiguous outcomes and rollback

Never edit an existing command file or reuse an operation ID with changed fields.
After timeout/503, preserve that file and lookup the same report. This tool does
not automatically retry controls or infer operation success from state alone.
Reconcile its operation ID with the audited operation before any manual replay.
If the revision changed, execution stops; do not mint another operation merely
to escape uncertainty.

For an approved rollback, lookup the current receipt and prepare a **new**
`withdraw` command with its current hash/revision and a new Eric approval reference.
Verify withdrawal, correct-broker invisibility and derived reconciliation.
Do not delete receipt/audit tables, restore an old auto-publishing receiver, or
reset the queue. Infrastructure failure means keep senders paused and forward-fix.

Before H05, access rollback is to remove only `eric-receipt-operator` from the
staged registry and revoke/delete only the newly created operator token if needed;
preserve all six producers and existing shared-project memberships. After H05,
revocation also requires updating the deployed Worker registry. Removing a vault
value alone does not revoke an already deployed token hash.

## Verification

`node --test ops/receipts/operator.test.mjs`: **28 passed, 0 failed**.
Mocks only; default network access throws. Tests cover exact command fields,
approval hash/ref binding, int32 bounds, coverage policy, stale revisions,
lookup/POST/lookup, held-versus-published distinction, response bounds, full-body
timeout, no automatic retry and sanitized CLI/server errors.

Separate live vault-only checks passed: actual desktop resolver's operator hash
matches registry; six scoped producer bootstraps cannot obtain operator value;
membership isolation verified. No production receipt/control calls occurred.

`rehearse.py` ran against a dedicated local PostgreSQL **17.11** instance on
`127.0.0.1:55439`, using the reviewed migration unchanged. Production version was
read-only inspected as PostgreSQL 17.6 Linux. No production data was copied.
32 checks passed; exact results and migration SHA-256 are in
`rehearsal-results.json`. Both real acceptance sessions were observed waiting
concurrently on the team advisory lock before allowing them to proceed.

Run with an existing local PostgreSQL instance on that port:

```text
python ops/receipts/rehearse.py <absolutePsqlExe> <reviewedReceiverCheckout>
```

The script creates a uniquely named rehearsal database and synthetic identities.
Coach tables use source DDL plus the two additional production pattern columns
confirmed by metadata inspection. Production table grants were inspected and
reproduced for the affected roles. Synthetic broker org-claim policy tests RLS
visibility; this is not a complete Supabase Auth, REST, schema or customer-history
clone. HTTP auth and actual broker refresh remain H05–H07 checks.

Tests include permissions, immutable identity/payload, concurrent acceptance,
publication visibility, control replay, shared legacy evidence, failed release
and failed withdrawal atomic rollback, explicit partial release and unknown
coverage hold.
The local server was stopped after rehearsal; synthetic databases retained for
inspection. The added policy migration changes control gating only; coverage and
timing JSON contracts remain unchanged.

## Next dependency

H03 and H04 are ready for the coordinated H05 checkpoint after laptop H01/H02.
Reconfirm the delivery pause, check current production revision once, preserve
newer unrelated work, and deploy only through the fixed plan. All 55 historical
IDs remain blocked; 11 quarantines unchanged. Eric still approves each real release.

## Maggie caller inventory correction — September 12, 2026

The existing Desktop directory link was read-only resolved at 2026-09-13T04:13:22Z: Maggie is The Loving Team, futurehomerealty, UUID `99c0f65d-7443-45ea-a256-e83239eddac9`. The operator caller now recognizes that existing team. Tests exercise complete- and partial-report prepare plus GET/POST/GET identity continuity while rejecting wrong-team inputs and holding unknown coverage.

This code change does not provision credentials or grant receiver scope. A fresh live check found no `hermes-maggie_loving` entry in the current vault receipt registry, and its operator entry omits this UUID. The existing producer resolver also returned `credential_failed` for Maggie. No receipt-specific safe provisioning helper exists; `worker/src/provision.ts` is tenant/CRM provisioning and must not be used for this task. After merge, an authorized administrator must use the established vault/receiver mechanism: create a distinct high-entropy Maggie producer token in the existing producer vault path, add only its SHA-256 hash as `hermes-maggie_loving` scoped to the verified UUID, append that UUID to the existing `eric-receipt-operator` team list without changing its token hash or the six existing producers, then install the reviewed hash-only `COACH_REPORT_CLIENTS` JSON as the Worker secret during the coordinated deployment. Verify producer isolation, operator scope, authenticated lookup and a held acceptance before any separately approved release. Preserve existing CRM/team provisioning and never put raw tokens in registry JSON, packages or logs. Do not claim seven-team operator access before those checks pass.
