# TruHQ → Brian pull/lease API

Production base: `https://api.truhq.co`. All five routes use `Authorization: Bearer <TRUEHQ_COACH_TOKEN>`; server validation uses existing `COACH_INGEST_TOKEN` and `secretsMatch`. No new credential or customer/admin access. JSON mutation bodies require `Content-Type: application/json`.

| Method | Path | Operation |
|---|---|---|
| GET | /coach/run-events/agent-queue?limit=1 | Retrieve actionable groups |
| POST | /coach/run-events/:incidentId/claim | Claim/reclaim |
| POST | /coach/run-events/:incidentId/claim/renew | Renew |
| PATCH | /coach/run-events/:incidentId | Update |
| POST | /coach/run-events/:incidentId/claim/release | Release |

## Request schemas

Every object rejects unknown keys. No write has a `schemaVersion` field. All fields below are required except those explicitly marked optional.

Claim and renewal:
```json
{"agentId":"brian","expectedVersion":1,"leaseSeconds":1800}
```
Investigating/needs-human update:
```json
{"agentId":"brian","expectedVersion":2,"status":"investigating","diagnosis":"A synthetic parser variation was identified.","nextStep":"Review the bounded repair."}
```
`status` is `investigating`, `fixed`, or `needs-human`. For fixed, all three additional fields are required (arrays may be empty):
```json
{"agentId":"brian","expectedVersion":3,"status":"fixed","diagnosis":"A synthetic parser variation was identified.","remediation":"Handled the synthetic variation.","filesChanged":["src/parser.mjs"],"testsRun":["parser regression"],"nextStep":"Allow the next controlled run to verify the repair."}
```
`remediation`, `filesChanged`, and `testsRun` are optional for investigating/needs-human. Omitted fields preserve previous values. Diagnosis and nextStep replace previous values; every successful write is retained in history.

Release:
```json
{"agentId":"brian","expectedVersion":2,"diagnosis":"Synthetic integration check completed.","nextStep":"Continue the synthetic integration test."}
```
Diagnosis and nextStep are optional on release. Omission preserves them.

## Limits and safety

- `limit`: default 1, decimal integer 1–5; no duplicates or other query keys. Mutations accept no query parameters.
- `incidentId`: 1–120 ASCII characters; first alphanumeric, remaining alphanumeric, underscore, dot or hyphen. Existing ingestion IDs need not be UUIDs.
- `agentId`: exactly `brian` (5 characters).
- `expectedVersion`: integer 1–2,147,483,646.
- `leaseSeconds`: required integer 300–3600; no default.
- Mutation payload: maximum **8192 UTF-8 bytes**, streamed check, invalid UTF-8/JSON rejected.
- `diagnosis`, `remediation`: 1–500 JavaScript UTF-16 code units; nonblank.
- `nextStep`: 1–300 code units; nonblank.
- `filesChanged`: 0–10 strings, each 1–160 characters. Regex `^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*$`; repository-relative slash paths only, no traversal, spaces, backslashes, URL escapes, drive letters or absolute paths. Credential-like path components rejected.
- `testsRun`: 0–10 nonblank strings, each 1–100 code units; test names only.
- Text is single-line; control characters, markup, backticks, braces, backslashes, double/curly quotes, recognized email/phone patterns, absolute paths, credential keywords, transcript/stack markers, code/output patterns and name-like capitalized word pairs are rejected. Conservative rules can reject harmless prose; rewrite it as a short impersonal summary.
- These deterministic checks do not prove that arbitrary natural-language text is free of all possible names or paraphrased private content. Brian must send sanitized impersonal summaries, never raw evidence. This is an explicit limitation, not a guarantee of semantic anonymization.
- Limits are shared across all server instances: **60 authenticated queue requests per fixed 60-second window**, and **60 authenticated mutations per separate 60-second window**. Window starts at first request, not a sliding window. Invalid authenticated requests count. `429` includes `Retry-After: 60`. Unauthorized requests never query the database. No token or request body is logged.

## Success response schemas

All mutations return exactly this object (status/claim vary):
```json
{"ok":true,"incidentId":"synthetic-incident","status":"investigating","version":2,"claim":{"agentId":"brian","claimedAt":"2026-09-06T03:00:00+00:00","expiresAt":"2026-09-06T03:30:00+00:00"}}
```
- `ok`: literal true; `incidentId`: requested ID; `version`: integer.
- Claim/renew status: `investigating`; update status: requested allowed status; release status: `open`.
- `claim`: shown three-field object while investigating; null after fixed, needs-human, or release. Dates are ISO timestamps; clients must accept `Z` or UTC offsets.

Queue returns exactly `{ "ok": true, "tickets": [] }` when empty. Each of 0–5 tickets has these exact fields:
```json
{
  "schemaVersion":1,
  "incidentId":"synthetic-incident",
  "fingerprint":"synthetic-fingerprint",
  "batchId":"synthetic-batch",
  "accountId":"synthetic-account",
  "occurredAt":"2026-09-06T03:00:00+00:00",
  "severity":"nonfatal",
  "scope":"event",
  "stage":"synthetic",
  "code":"SYNTHETIC_TEST",
  "title":"Synthetic incident",
  "explanation":"Synthetic evidence only.",
  "impact":"No production work affected.",
  "nextStep":"Review synthetic evidence.",
  "action":"synthetic_test",
  "continued":true,
  "position":null,
  "total":null,
  "technical":{},
  "status":"open",
  "occurrenceCount":1,
  "firstSeenAt":"2026-09-06T03:00:00+00:00",
  "lastSeenAt":"2026-09-06T03:00:00+00:00",
  "version":1,
  "claim":null
}
```
`severity`: fatal/nonfatal. `scope`: event/contact/team/batch/delivery. `status`: open/investigating. `continued`: boolean. `position`/`total`: nonnegative integers or null. `occurrenceCount`/`version`: positive integers. `claim` is null or the above object (an expired lease may be returned). `technical` is `{}` if omitted at ingestion, otherwise exactly `{stage,code,fingerprint,message}` with string values.

Existing ingestion limits remain unchanged: up to 200 incidents / 1,000,000 bytes per push; short fields 120 characters (identifier regex permits 128 but field checks limit them to 120); title 200; explanation/impact/nextStep/technical.message 1000; schemaVersion 1; UTC occurredAt. The queue exposes no agent diagnosis, admin notes, history, reports or customer-table joins.

## Errors

Agent route errors: `{ "ok": false, "error": "CODE", "code": "CODE" }`; validation adds `"details":["fieldName"]`, maximum 12 unique field markers. Unknown keys use `unknownField`, so attacker-controlled key text is never reflected. Body failures use `body`. Query errors use `limit` or `query`.

| HTTP | Code |
|---|---|
| 401 | UNAUTHORIZED |
| 404 | INCIDENT_NOT_FOUND |
| 405 | METHOD_NOT_ALLOWED |
| 409 | CLAIM_CONFLICT, VERSION_CONFLICT, CLAIM_EXPIRED, INVALID_STATUS_TRANSITION |
| 413 | PAYLOAD_TOO_LARGE |
| 422 | VALIDATION_ERROR |
| 429 | RATE_LIMITED |
| 503 | SERVICE_UNAVAILABLE |

An invalid agentId is a 422 schema error. A valid-shaped request attempting open/verified via PATCH receives 409 INVALID_STATUS_TRANSITION. Database faults never expose their original message.

## Ownership, concurrency and recurrence

- One grouped ticket per fingerprint. Any stored incident ID in that group addresses the same lease/version. Queue chooses the oldest fatal occurrence if any, otherwise oldest nonfatal; ties use incident ID. Queue ordering is fatal first, occurredAt ascending, ID ascending. Individual occurrences remain immutable.
- Queue includes open or investigating with expired lease; active leases and all terminal statuses are excluded. Reads do not reserve tickets; claim with the returned version.
- Mutations lock the problem row and check version in one database transaction. An active claim always conflicts, even for another process calling itself Brian. Renew/update require current unexpired Brian lease. Release accepts the current owner's expired lease too.
- Every successful mutation increments version exactly once and appends immutable history. Duplicate deliveries create neither an occurrence nor a version. Retried writes with an already-consumed version return conflict and append nothing (no success-replay idempotency key).
- Brian transitions: claim open/expired investigating → investigating; update investigating → investigating/fixed/needs-human; release investigating → open. Terminal update clears the lease. A subsequent release after terminal completion has no owner and conflicts; it is unnecessary.
- New occurrence increments recurrence counts, preserves diagnosis/remediation/history/lease, and reopens fixed → open. Only that reopening increments the workflow version and appends a status-history entry; metadata-only recurrence keeps the version unchanged so an active owner can still renew/update. Individual occurrences remain the complete recurrence record. Open remains open; investigating remains investigating; needs-human and verified remain unchanged.
- No automatic trusted-run verification or production rerun mechanism was added. Only an administrator may verify a fixed problem. Brian must use needs-human for authentication/MFA/CAPTCHA, uncertain routing, missing authorization, or unsafe/missing evidence. Server records results; it does not run repairs or pipelines.

## Admin surface

Existing admin gate remains mandatory. GET /admin/failure-logs adds claim, diagnosis, remediation, relative files, test names, next step and complete history. History labels Brian/administrator/ingestion. PATCH /admin/failure-logs now requires expectedVersion, plus fingerprint and one or more of status/notes/releaseClaim. Notes max 500 with the same prose checks (empty clears). Admin release clears incorrect/stale claims; fixed → verified is allowed. A stale admin write conflicts too. Coaching bearer tokens have no admin access.

## Implementation and database verification

Migrations: `brian_failure_log_queue` and `brian_recurrence_lease_version`; source `db/hq_brian_failure_log_queue.sql`. Adds lease/investigation/version columns, immutable `coach_run_event_history`, rate-window table, service-role-only RPCs and recurrence/version/audit triggers. Existing ingestion RPC remains unchanged; triggers extend it atomically. Baseline entries capture pre-existing status without inventing prior history. Migration is one-time and cleanly fails if reapplied; use migration tracking.

`db/hq_brian_failure_log_queue_verify.sql` runs synthetic lifecycle, recurrence, ordering, status-history tamper, limits and privilege tests inside BEGIN/ROLLBACK. No production reports are submitted.

Changed files: shared/agentRunEvents.ts; worker/src/agentRunEvents.ts and .test.ts; worker/src/failureLogsAdmin.ts and .test.ts; worker/src/index.ts; web/src/lib/api.ts; web/src/pages/AdminFailureLogs.tsx and failure-logs-render.test.ts; the three database SQL files; this document.
