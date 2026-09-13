# Receipt cutover and publication policy — offline proposal

No step below has been executed. No deployment, live verification, credential provisioning, schedule change or report mutation is authorized by this document.

## Contract delta and exhaustion

Relative to a1db5c3, source and replacement expectedRevision now require an integer in [1,2147483647], otherwise HTTP 422 invalid_control before SQL. All other receipt fields, hashes, coverage and responseTiming contracts are unchanged. JSON parsing still precedes control validation: invalid JSON/nonfinite or unsafe numeric input remains 422 invalid_json.

Stored revisions are PostgreSQL int32. At maximum, an operation attempting to increment fails with 503 receipt_transaction_failed and rolls back, without wrapping, resetting, new audit/operation receipt or partial publication. This is not an automatic recovery path. Stop retries and escalate if a receipt has reached the maximum. A future widening migration or exhausted-report recovery requires separate design/approval; neither is implemented. An identical already-committed operation may still replay without incrementing.

## Credential proposal — not provisioned

Proposed project: existing Infisical project UUID `8ae8aecb-79a2-4311-8fa3-82c44c2c5662`, observed as a reference in tools/history-pilot/inventory-teams.ps1. Its current name, access grants and runtime binding were not queried. This is a proposed target, not a claim that it is already configured for receipt secrets.

Proposed environment slug: `prod`. New paths/keys (none created):

| Path | Key | Intended reader |
|---|---|---|
| /TruHQ/Receipts/Producers/signature | TOKEN | Hermes signature publisher |
| /TruHQ/Receipts/Producers/costigan | TOKEN | Hermes costigan publisher |
| /TruHQ/Receipts/Producers/scottmoore | TOKEN | Hermes scottmoore publisher |
| /TruHQ/Receipts/Producers/woosley | TOKEN | Hermes woosley publisher |
| /TruHQ/Receipts/Producers/synergy | TOKEN | Hermes synergy publisher |
| /TruHQ/Receipts/Producers/satish | TOKEN | Hermes satish publisher |
| /TruHQ/Receipts/Operators/eric | TOKEN | Eric's separately authorized release tool |
| /TruHQ/Receipts/Receiver | COACH_REPORT_CLIENTS | Authorized deployment process |

Use distinct high-entropy tokens per account and a separate operator token. Proposed producer client IDs are `hermes-signature`, `hermes-costigan`, `hermes-scottmoore`, `hermes-woosley`, `hermes-synergy`, `hermes-satish`; proposed operator ID `eric-receipt-operator`. Each producer has exactly one verified canonical team UUID. Operator gets only the approved team list. No wildcard. Laptop producer identity must not read operator paths.

Worker configuration is COACH_REPORT_CLIENTS, a nonempty JSON array of `{id,tokenHash,role,teamIds}`; id is unique 1–128 ID syntax, tokenHash is unique lowercase SHA-256 hex of the raw token, role producer|operator, teamIds nonempty lowercase UUID array. Future authorized deployment copies the hash-only registry to the Worker secret. This receiver does NOT dynamically resolve that registry from Infisical; do not assume automatic vault synchronization. No raw tokens in the registry/package/logs. No provisioning or ACL tooling is included.

Existing COACH_INGEST_TOKEN, ADMIN_TOKEN, incident/directory/FUB secret references and their paths remain untouched. There is no legacy fallback on the three controlled routes. Approval must cover actual project binding, grants, token generation and deployment-secret population before cutover; these are proposals only.

## Legacy inventory and evidence

Available locally: legacy table definition and receiver source, cleanup SQL, saved account/history exports. They show semantics and mapping candidates but are NOT an authoritative complete legacy run inventory. No comprehensive stored-run ledger or completed duplicate-cleanup receipt was found in the reviewed artifacts. Laptop owns the staging queue; its inventory is not accessible from this Windows filesystem.

Request laptop's sanitized inventory with sourceAccount, legacyRunId, payload SHA-256 (identify raw-vs-canonical scheme), stagedAt, lastAttemptAt, attempt outcome, known server reportId, and local state. No report bodies, quotes, credentials or contact names are needed for the coordination inventory. Preserve original bodies privately on the laptop. This package is the coordination request; no claim is made that laptop has supplied or accepted it.

Authoritative receiver evidence needed after separate approval: paginated read-only export of coach_weekly_reports matching every staged run, including id, run_id, team_id, org_id, team_slug, status, received_at and receipt_managed where available; reconcile normalized stored payload securely where necessary. Legacy stored payload coercion means its hash may differ from the original request: do not equate these hashes without normalization evidence. Matching run ID proves an occupied identity, not that the newest attempted payload was accepted unchanged.

Categories:
- Already stored: authoritative row by exact run_id and correct organization/team. Published requires its persisted published status; held means stored only. Do not convert/replay these as new receipts. New receiver returns legacy_conflict for existing unreceipted runs.
- Confirmed never stored: complete authoritative negative lookup after sender pause, all in-flight requests resolved, captured server checkpoint and laptop attempt reconciliation. A timeout, old screenshot, missing log, missing receipt or partial export cannot establish this.
- Ambiguous: conflicting identities/payloads, incomplete inventory, in-flight request, timeout without reconciliation or missing server evidence. Quarantine and investigate. Never auto-create a new run to escape ambiguity.

## Proposed coordinated sequence

1. Both Codex sides agree on contract revision, hash vectors, mapping evidence and inventory format. Obtain separate authorization for read-only production evidence before any such query.
2. Obtain explicit deployment/cutover authorization. Laptop pauses only outbound report submission/retries, with a UTC checkpoint and queue manifest; do not unnecessarily stop collection/review. Drain or reconcile all in-flight attempts. No pause is executed now.
3. Freeze an authoritative server inventory at the reconciled checkpoint. Classify every laptop entry. Retain snapshots and decisions. Resolve duplicate-team identity before granting credential scope.
4. Provision approved scoped credentials separately. Prepare operator access independently. Apply reviewed receipt migration and deploy receiver in a maintenance interval while sender remains paused. Preserve legacy rows, partial gate false and immutable guards. Confirm deployed revision, configuration and actual grants. The old token will no longer submit.
5. Under separate limited-verification approval, use synthetic held reports to verify accept/lookup/replay/conflict isolation and agreed operator controls. HTTP 2xx alone is not publication verification. Verify broker visibility only for a separately authorized release. No customer backfill as a test.
6. Laptop activates only the agreed producer adapter after confirmed receiver deployment and verification. For confirmed never-stored legacy data, create a controlled submission with canonical team identity and a separately recorded new runId, retaining legacy-to-new linkage. Stored legacy remains legacy; ambiguous remains quarantined. This conversion is a proposed separately approved migration, not implemented here.
7. Resume submission with bounded retry/reconciliation. Monitor held backlog, auth/conflict failures and release lag. Report generation and publication must have separate operational states.

Recovery: uncertain submission -> authorized lookup of same team/run, compare hash, bounded identical retry. Uncertain control -> lookup both affected receipts and replay same operationId/actor/body. Never regenerate payload or alter expected revision on the same operation. Auth/config failure -> stop sending and resolve, do not fall back to legacy credentials. Deployment failure -> keep sender paused/queue durable, preserve ledger/guards, forward-fix; do not roll back to auto-publishing code. No destructive down migration. Released-report rollback uses a separately authorized audited withdrawal and transactional projection rebuild; held rows can simply remain held. Existing browser/PDF copies are not recallable.

## Daily publication operating policy — proposal

Initial launch: Eric (or a separately named, authorized operator) reviews and explicitly releases complete daily reports using the operator credential in a separate release tool. No operator token or control task in the producer process. Release tool automation/UI is not implemented by this change; agree owner and review cadence before activation so held reports do not silently accumulate.

Eligibility for normal daily release: verified account/team association, matching receipt hash and current revision, coverageState complete, complete roster and review coverage, valid observed evidence, no unresolved legacy identity/correction issue, expected report window, not superseded. Coverage complete does NOT require responseTiming; unavailable timing must remain explicit. Unknown coverage is not eligible for routine daily release under this policy, even though current API permits an explicit operator release of unknown coverage. Thus this stricter policy must be enforced by the human/operator tool, not falsely claimed as receiver enforcement. Partial remains disabled by the existing receiver gate.

Audit: human approval reference in non-PII reason, unique operationId, authenticated operator actor, team/run/hash/revision, persisted before/after and server timestamp. After operation, verify published and derived complete separately from coverage. Failures leave held/prior state and require review; no producer escalation to operator.

Future automatic release requires Eric's separate explicit approval of eligible teams, full eligibility rules (including handling unknown coverage), cadence/SLA, independent operator identity/ACL, dry-run review, bounded retry/idempotency, notification/kill switch and withdrawal policy. It would be a separate trusted release service with operator authority, not a producer permission change. No automatic release service, schedule, new gate or partial permission is implemented or enabled here.
