# Live training backend: review and rollout

This change is disabled until `REP_LIVE_SESSIONS=1`. Daily mail additionally requires `REP_LIVE_DIGESTS=1`, `RESEND_API_KEY`, and the existing verified `INVITE_FROM` sender. Neither flag is enabled in checked-in production configuration.

## Database and access

`db/hq_rep_live.sql` is additive and reviewable. It has been executed against embedded, isolated Postgres with two tenant organizations and separate accounts. No hosted database was changed. Apply only to an approved isolated environment first; this repository's normal Supabase project is shared with production.

The session stores the complete server-selected workshop definition/version when created. Raw definitions and digest payloads are service-only. Authenticated table reads are limited by explicit row policies. Client roles cannot call the mutation/read inventory RPCs; the Worker verifies its cookie session and calls them with the authenticated actor. Each transaction rechecks role/roster permission. No user-entered draft wording goes to these endpoints before submission.

Session writes lock the session row. Attempt IDs are immutable/idempotent, numbers increase under that lock, and assistance is set from the server's reveal state. The original FUB grader remains unchanged. Repair requires a prior passing audit. A passed audit remains working; it does not complete the record exercise. An ended session accepts catch-up submissions only for previously opened activities. Quiz certification and activation are untouched.

Named coaches can review their own assigned follow-ups without being session presenters. Individual evidence remains scoped to the current team/organization role. Practice observers can submit only for their assigned speaking group; peer observation and coach review are separate records. Editing an already-observed group requires a new round.

## Worker interfaces

- `GET /rep/sessions`: enabled state and the caller's sessions. Disabled returns 200 with an empty list.
- `GET /rep/sessions/preflight`: administrator roster and eligible coach directory.
- `POST /rep/sessions`: `{id,day,timezone,participants:[{agentId,coachId}],presenterIds}`. Response `{ok,id}`.
- `GET /rep/sessions/:id?view=agent|shared|presenter&cursor=...`: typed state or `{unchanged,cursor,serverTime}`. Database cursor shortcut happens only after authorization.
- `POST /rep/sessions/:id/join`: join/connection heartbeat. Learner clients send this every ten seconds while active. Connection status is independent of activity progress.
- `POST /rep/sessions/:id/commands`: `slide`, `open`, `timer`, `reveal`, `group`, or `end` per `shared/liveWorkshops.ts`.
- `POST /rep/sessions/:id/progress`: activity ID and optional status/help/actions/dirty metadata. Omitted fields preserve existing values. Explicit help resolution increments a durable count.
- `POST /rep/sessions/:id/submissions`: `{id,activityId,response}`. Written responses use field IDs; records use `response.submission`. Response `{ok,attempt}`. Duplicate ID with changed content is refused.
- `POST /rep/sessions/:id/observations`: `{id,groupId,criteria,correction,retry,speakingObserved:true,retryObserved:false}`. Identity/round/coach status come from the authenticated assignment, not client assertions.
- `GET /rep/sessions/deliveries`: administrator-only status, attempts, and error history for the latest 100 daily deliveries. No submitted response text.
- Existing `/rep/record/grade` accepts optional `sessionId,activityId,attemptId`; no-context callers retain existing behavior.
- Existing `/data/coaching-assignments?agentId=...` merges durable live follow-ups with unchanged legacy assignments. `practice` records learner reflection; `review` records the named coach's outcome and optional boolean/null `applicationObserved`.

Poll active sessions every two seconds, slower when idle. Preserve the authenticated user/session/version/activity draft key and pending submission ID across refresh. Shared presentation responses omit individual data and coach notes. Choice distributions use each learner's first independent response; retries do not outvote peers. These practice materials remain separately available in self-paced training, so reveal metadata is a practice record, not exam security.

## Follow-up and daily email

Ending creates one assignment per participant for days 1, 3, and 7 in the session timezone. Day 1 recall and day 3 fresh-case guidance are frozen by training day. Day 7 requests coach-observed application or another practice case when no real opportunity occurred. Closing/retrying the session cannot duplicate assignments.

The existing automation tick also checks training digests when enabled. The runner paginates assignments, combines due/overdue/awaiting-review work per recipient, and sends at/after 08:00 in the first due assignment's session timezone. One recipient/day receives one digest even with several sessions. Links and dates are included; private reflection/review text is omitted.

A database lease plus the provider's idempotency key prevents concurrent/crash duplicates. Payload freezes at the first delivery attempt. Recipient lookup failure is recorded per recipient and does not stop other recipients; a corrected email can recover before the first provider attempt. Eight failed attempts leave a visible failed row for investigation. Read `/rep/sessions/deliveries` and inspect the cron's failure message when delivery is unavailable; in-app assignments remain due.

## Isolated working preview

`npm --prefix worker run preview:live` starts a loopback-only adapter on port 8790. It uses the real Worker handlers, grader, and migration in persistent local embedded Postgres at `worker/.wrangler/live-preview`. It refuses all remote network requests and reads no production credentials. Fixture auth and unrelated shell endpoints exist only in the preview script; they are never bundled into the deployed Worker.

Set the local frontend `VITE_WORKER_URL=http://127.0.0.1:8790` and open one of:

- `http://127.0.0.1:8790/preview/login?user=presenter`
- `http://127.0.0.1:8790/preview/login?user=alice`
- `http://127.0.0.1:8790/preview/login?user=blair`
- `http://127.0.0.1:8790/preview/login?user=coach`

These are fixture identities, not real user impersonation. Cookies are shared across tabs on the same hostname, so use separate browser profiles for simultaneous people, or switch identities and let each page reload. Keep the database folder to retain preview sessions on restart.

## Verification and rollback

`liveSessionsDb.test.ts` executes the migration in isolated Postgres and exercises tenant access, RPC/table denial, immutable/assisted retries, audit gate, catch-up, named-coach follow-up, scoped observer roles, cursor shortcut, daily leases, and 50 concurrent submissions/reads. `liveSessions.test.ts` covers transport guards, projection privacy, field validation, original grading, choice denominators, and mail contents. Existing record and coaching tests remain unchanged.

The isolated run processed 50 validated submissions in 224 ms and submissions plus 50 authorized state reads in 639 ms. A loaded full-suite run took 966 ms for both phases. This excludes network and polling delay; validate the three-second target against the approved staging Supabase environment before release.

Rollback is `REP_LIVE_SESSIONS=0` and `REP_LIVE_DIGESTS=0`. This disables live routes/mail while preserving sessions, assignments, legacy courses, and historical certification. Do not drop tables or alter learner history to roll back.

The default Worker test command runs Vitest for application tests and Node’s native runner for the existing `ops/link-hermes-team.test.mjs`; that file previously failed when Vitest tried to load the Node test module. No existing test is skipped.

Spoken practice requires the observer to explicitly confirm `speakingObserved=true`. `retryObserved` is a separate boolean and defaults false; retry prose does not establish that a retry happened. Existing rows receive false for both fields so historical notes are never retroactively promoted into observed performance.
