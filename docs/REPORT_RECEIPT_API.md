# Offline receipt and publication controls — laptop review

Status: OFFLINE ONLY. No deployment, live database migration, production gate change, sending, report submission, release or withdrawal occurred. The production receiver remains the prior b847a35 deployment. This package defines the implemented v1 contract for laptop agreement; it does not claim that agreement or activation has occurred.

## 1. Authentication and immutable identity
All three receipt routes use `Authorization: Bearer <client token>`.
The proposed Worker secret `COACH_REPORT_CLIENTS` is a JSON array:
`[{"id":"hermes-laptop","tokenHash":"<64 lowercase hex SHA-256 of token>","role":"producer","teamIds":["<canonical TRU team UUID>"]}]`.
Operator entries use a distinct token and `role:"operator"`. IDs must be unique, hashes unique, team lists nonempty, no wildcard. Use high-entropy random tokens; keep actual tokens in Infisical. This secret was NOT configured anywhere live.
Producer: submit and read receipts for its listed teams. Operator: those operations plus controls for its listed teams. No ADMIN_TOKEN/COACH_INGEST_TOKEN fallback for receipt routes. Existing GET /coach/teams keeps its existing separate directory credential.
`run.teamId` MUST be the lowercase canonical TRU team UUID. Slugs/aliases are rejected by the new receipt API, avoiding remapping. `run.runId` must match `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`.
Each runId is globally reserved, preserving the existing report table's unique constraint, and permanently bound to one team and canonical payload. Cross-team reuse returns 409 without revealing the other report. Existing legacy rows without receipts are NOT silently adopted or overwritten: 409 legacy_conflict.
No existing report is changed by acceptance of a different run. Any future adoption of legacy rows requires a separately reviewed operation; none is implemented.

## 2. Exact hash contract
Scheme: `receipt-jcs-sha256-v1`.
1. Strictly decode the entire HTTP body as UTF-8; reject malformed UTF-8/JSON and duplicate object keys at any nesting depth, including escaped-equivalent keys.
2. Parse the submitted JSON as IEEE-754 binary64 values, validate the existing Coach report schema and unchanged coverage/responseTiming contracts.
3. Canonicalize the ORIGINAL parsed report envelope, before the validator's coercion/defaulting: recursively sort object keys by UTF-16 code units, preserve array order, use ECMAScript JSON.stringify string/number serialization, and emit no whitespace. No Unicode normalization. -0 serializes as 0. Escaped/unescaped equivalent strings hash identically.
4. SHA-256 of the canonical string's UTF-8 bytes, lowercase hexadecimal, with NO prefix, salt, newline or wrapper. `hashScheme` is a separate receipt field.
This is an RFC 8785 serialization profile restricted to finite numbers, safe integers (abs <= 9007199254740991), valid paired Unicode, and maximum nesting 100. Larger integers/nonfinite values/lone surrogates are rejected. All original submitted fields, including unknown top-level fields, participate in the hash, even if display validation discards them. Coverage and responseTiming, when present, both participate independently.
Object order/JSON whitespace changes are replays; reordered arrays, changed timestamps, changed IDs, changed fields and added fields are conflicts under the same runId.
The receiver hashes; the producer compares that returned hash to its own calculation. There is no required hash header or new payload field. `report-receipt-hash.mjs` and `hash-vectors.json` provide a dependency-free Node reference and synthetic vectors.
The 4,000,000-byte UTF-8 cap applies to the entire RECEIVED HTTP body, before canonicalization, regardless of Content-Length. Streaming reads stop at overflow. Exactly 4,000,000 accepted if otherwise valid; 4,000,001 rejected.

## 3. Submit: POST /coach/weekly-report
Existing report envelope, unchanged coverage and responseTiming objects. Coverage-only schema 1.3 is supported; no timing gate is needed.
Every NEW report, including daily/weekly COMPLETE and legacy-without-coverage, is stored HELD. No implicit publication.
201 first insertion; 200 identical replay. Example:
```json
{
  "ok": true,
  "replayed": false,
  "receipt": {
    "reportId": "<UUID>",
    "teamId": "<UUID>",
    "runId": "synthetic-run-1",
    "hashScheme": "receipt-jcs-sha256-v1",
    "payloadHash": "<64 lowercase hex>",
    "storageStatus": "stored",
    "publicationStatus": "held",
    "derivedProcessing": {"status":"not_required","scope":"coach_patterns"},
    "revision": 1,
    "coverageState": "partial",
    "storedAt": "<timestamp>",
    "changedAt": "<timestamp>",
    "holdReason": "explicit_release_required",
    "supersededBy": null
  }
}
```
Same team/run/canonical payload => same stored identity/current receipt, no mutation, no publication recalculation, no new audit row, no derived processing. Works after withdrawal/supersession and after team deactivation; new acceptance requires active team. Stored normalized display payload and agent links remain unchanged even if the roster/validator later changes.
Different canonical payload => 409 payload_conflict; different team => 409 identity_conflict. SQL transaction locks plus unique constraints protect writes; not a check-then-unprotected-upsert.
HTTP 2xx and storageStatus=stored mean storage only. Check receipt.publicationStatus for publication, and derivedProcessing separately.

## 4. Read: GET /coach/weekly-report/receipt?teamId=<UUID>&runId=<ID>
Exactly one teamId and runId; extra/duplicate query parameters rejected.
200 `{ "ok":true, "receipt":{...same metadata...} }`; 404 not_found otherwise. No payload, contact names, quotes, canonical text, agent links or credentials returned. All replies are Cache-Control: no-store. Team authorization precedes lookup.
Publication states: held, published, withdrawn, superseded.
Derived states: not_required or complete. `complete` means the transactional Coach pattern projection was reconciled; it does NOT imply every activity was collected or reviewed. Coverage state remains separate: complete/partial/unknown.
There is no visible pending/failed half-publication: transaction failures return 503 and preserve the prior receipt/projection. The caller must lookup after ambiguous network outcomes.

## 5. Control: POST /coach/weekly-report/control
Operator credential required (producer gets 403).
Exact body, no additional fields:
```json
{
  "operationId":"unique-operator-command-1",
  "action":"release",
  "teamId":"<UUID>",
  "runId":"synthetic-run-1",
  "expectedHash":"<receipt payloadHash>",
  "expectedRevision":1,
  "reason":"Approved synthetic verification"
}
```
`operationId`: same ID regex as runId. action: release/withdraw/supersede. expectedRevision: integer from 1 through 2147483647 inclusive, for both source and replacement; invalid values return HTTP 422 invalid_control before RPC. reason: nonblank <=500 UTF-16 units, no C0/DEL controls. Do not include customer information in reasons.
`supersede` additionally REQUIRES exactly:
`"replacement":{"runId":"corrected-run-2","expectedHash":"<hash>","expectedRevision":1}`.
Replacement must be distinct, same team, and held. Submit it separately first with a new immutable runId.
200: `{ "ok":true,"replayed":false,"operationId":"...","receipt":{...} }`; supersede also returns replacementReceipt.
A repeated identical operationId + actor + canonical command performs no writes and returns replayed=true with CURRENT receipt metadata. The immutable audit retains the original result, but HTTP replay does not mislabel a subsequently withdrawn report as published. An operationId reused with a changed body/actor returns 409 operation_conflict.
Expected hash/revision protects against stale state. A new operation against an already completed transition returns 409 rather than guessing intent. Both reports' revisions advance for supersession, even when the replacement remains held.

Transitions:
- release: held or withdrawn -> published; derivedProcessing complete. Partial release is still blocked by the unchanged false gate. Missing coverage stays unknown and visible as such.
- withdraw: held or published -> withdrawn. Raw report becomes hidden; if it was published, the pattern projection is reconciled atomically.
- supersede held/withdrawn: original -> superseded, replacement stays held. No accidental release.
- supersede published: original -> superseded and replacement -> published in ONE transaction, including derived reconciliation. Partial replacement is blocked while the partial gate is false.
- superseded is terminal; it cannot be revived by retry or release.
Enabling the partial gate in some future approved version only permits EXPLICIT controls on individual receipts. No retries, scans or remapping release a backlog. The former republishHeldReports path is removed.

## 6. Errors
401 unauthorized; 403 team_forbidden/operator_required; 404 not_found (including unavailable team for new acceptance); 405 wrong method; 413 payload_too_large; 422 invalid_json/invalid_payload/invalid_identity/invalid_control/invalid_lookup.
409: identity_conflict, payload_conflict, legacy_conflict, operation_conflict, revision_conflict, invalid_transition, partial_release_disabled, evidence_conflict.
503: receipt_auth_not_configured or receipt_transaction_failed. Public errors never include database diagnostics/customer evidence. 503/timeout is NOT proof of failed persistence: lookup then retry identical request/operation ID as needed.

## 7. Audit, derived data and rollback
Audit records contain actor ID from authentication, operation ID, reason, before/after metadata and timestamp. Accepted receipt audit is written in the same transaction as storage. Successful controls and operation receipts commit with publication; failed transactions commit none of those partial effects. Ordinary service-role audit/operation update/delete/truncate permissions are revoked.
Published report status, receipt status, audit and Coach pattern rebuild share one SQL transaction and per-team transaction lock. The projection uses all currently published team reports, durable finding IDs, matching-agent evidence and report provenance. Duplicate observations stay deduplicated; withdrawing one report preserves evidence supported by another. A conflicting reused finding ID fails the release atomically.
Scope includes coach_patterns, coach_pattern_findings, coach_team_state and coach_report_evidence_sources. Managed reports are excluded from the separate legacy coach_issues replay because that store lacks retractable provenance. Existing legacy issue history is not edited. No emails, scheduled tasks, other external side effects or LLM processing are triggered by these controls.
A malformed/conflicting legacy published report can prevent the full-team rebuild; fail closed and review it rather than silently discarding evidence. Large-team latency and multi-session Postgres stress remain staging checks before activation.
Rollback:
- Held: leave stored, or explicitly withdraw to record the decision. No deletion needed.
- Released: operator withdraw with current hash/revision; raw report hides and projection rebuilds from remaining published sources in the same transaction. If reconciliation fails, prior state remains intact; return 503 and investigate.
- Accidental withdrawal: a NEW audited release command restores the same immutable receipt (subject to gates).
- Supersession: original remains terminal/auditable. To restore its content, submit a new correction run with that content and explicitly supersede the current published replacement; never overwrite history.
- Infrastructure rollback: disable/revoke control credentials and pause producer sending. Retain receipt tables/audit/provenance and immutable guard. Do not revert to the old auto-publishing receiver or drop the migration: that would undermine the guarantees. No destructive down migration is provided.
- Broker screens must reload/refetch after a control operation; already-delivered browser data/PDFs cannot be recalled. Server reads hide withdrawn/superseded reports through existing published-only policy.

## 8. Offline verification and rollout prerequisites
200 targeted tests passed, 0 failed, across 11 suites. Includes 56 receipt/hash/real-SQL tests using @electric-sql/pglite 0.5.8, exact Unicode byte boundaries, parallel queued requests, auth/role isolation, service-role execution, anonymous denials, stale revisions, original-command replay after withdrawal, both supersession modes, provenance preservation, and injected rollback failures. Worker and web TypeScript checks passed.
PGlite is an embedded PostgreSQL engine, not a mock repository. It serializes its local connection; this is not a multi-session production load test. No production network calls were used for tests. Package/documentation downloads only.
Coverage and responseTiming validators and the production partial gate file are byte-unchanged from b847a35. The stopped collector implementation is unchanged; its obsolete tests now assert shutdown instead of expecting logins.
Migration is a LOCAL reviewed artifact: supabase/migrations/20260908181709_report_receipt_controls.sql. Not applied to production or any existing rows. Test schemas were created only in fresh in-memory databases.
Before any deployment: laptop must agree on the hash vectors, canonical UUID identity, new response envelope, 201/200 semantics, immutable correction workflow and scoped credentials. Existing producer sends must be paused for a coordinated migration/API rollout; the old credential is deliberately not a fallback. Existing legacy run IDs cannot be reused as new receipts.
After separate authorization, staging then limited synthetic production verification can check actual RLS/environment grants, latency and broker refresh. Nothing here authorizes sending, publishing partial reports, release of existing rows, or applying the SQL.
