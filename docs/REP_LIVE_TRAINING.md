# TRU Rep live training: operator and engineering handoff

This release adds a persistent, presenter-led practice session around the existing Rep workshops. It preserves the original Follow Up Boss record recreation, its five exercises, the deal demonstration, server grading, and existing certification flow.

## Live release

Live sessions are available at `https://app.truhq.co/#/rep/sessions`, following Eric's release approval. From the platform-owner home, choose **Live training**. If viewing a team through Act as, return to your own workspace first. Filter the roster by name or team; selections remain selected across filters. See `REP_LIVE_RELEASE.md` for deployment and validation details.

## Review preview

The isolated preview runs the actual session Worker handlers, server grader, and additive migration in embedded Postgres (PGlite). Its named fixture accounts are local test identities. It refuses outbound network requests, does not read production credentials, and does not send email. The adapter is in `worker/ops/live-preview.ts`, outside the deployed Worker entrypoint.

From this checkout, use two terminals:

```powershell
npm --prefix worker ci
npm --prefix worker run preview:live
```

```powershell
npm --prefix web ci
$env:VITE_WORKER_URL='http://127.0.0.1:8790'
npm --prefix web run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:8790/preview/login?user=presenter` to create a session. The other local identities are `alice`, `blair`, and `coach`. Signing in changes that browser's identity; use separate browser profiles to keep presenter and learner signed in simultaneously. The local database lives in `worker/.wrangler/live-preview/` and survives restarts. Do not publish this adapter or expose its port outside loopback.

## Run a session

1. In Rep, choose **Join or run a live training session**. A global administrator selects the training and agents. The signed-in presenter automatically owns all follow-up, including across teams. The timezone defaults to the browser timezone; another presenter is optional. Unlinked accounts and missing email addresses are identified before joining.
2. Selected agents open the session from Rep in their existing TRU accounts. No second invitation is required. The join link is an optional shortcut and does not authorize access by itself.
3. Keep the **presenter console** private. Open **shared presentation** in a separate window and share only that window through the meeting platform. Never share the console.
4. Choose the slide. Selecting an activity slide opens that activity; the explicit Open button also supports returning to an already selected activity. Start or extend the timer. Learners retain an unfinished activity when you move ahead and can select **Return to presenter** when ready.
5. Look at the first independent answer totals, explicit help requests, and missing record actions. Expand an agent only when you need their submitted evidence. Draft writing stays in that agent's browser.
6. Reveal one example after the first responses, coach one gap, and ask for a retry. Attempts after a reveal are labeled assisted; earlier attempts remain unchanged.
7. For optional partner practice, create rotating pairs or trios from joined participants, or assign rounds individually. Place those groups in the meeting platform's breakout rooms. A round names the speaking learner, buyer, and observer. In a pair, the buyer observes. Assign a coach for solo practice or leave its observation outstanding. Add late arrivals explicitly.
8. End the session to create its 24-hour, three-day, and seven-day follow-ups once. Learners can still finish previously opened activities. Coaching review happens through existing assignments; ending does not certify or activate anyone.

Team leaders and coaches can choose **Coach evidence & follow-up** from the session list or an assignment. This private, read-only session view shows their authorized agents' original attempts, revisions, and observations alongside the existing assignment review form. It does not require presenter permission or grant session controls. Its summary denominators cover only the visible agents.

The Welcome pilot is 57 minutes. First Conversation is 67, Show Like a Pro is 75, and Home Loans is 54. Extend practice rather than skipping attempts. Each original FUB exercise is a distinct case. Navigation in People/search needs a coach's observation in the actual training account; the simulator starts inside the contact.

The session screens use the existing premium app palette: warm off-white surfaces, charcoal navigation and text, and restrained gold actions. Original training visuals and the FUB simulator keep their own styles.

## What results mean

- **Connection interrupted** concerns connectivity. It does not mean the agent lacks attention or effort.
- **Working / submitted** is participation in the current activity. A changed record requires another check.
- **Record check passed** validates required saved actions. It does not judge note wording, reasoning, spoken skill, readiness, certification, or activation.
- **Partner observed** identifies practice evidence. **Coach reviewed** is a separate attributable review.
- **Application observed** is an explicit coach decision. If no real client opportunity occurred, use a fresh practice case and keep real-work application marked unobserved.

New practice choice IDs remain stable while their display order varies. Existing certification question IDs, positions, thresholds, and historical results are not changed. Nurture reasoning has no automatic grade or invented timeline.

## Content and materials

The source of truth is `web/public/workshops/day1.json` through `day4.json`. Stable slide and activity IDs are declared in those files, with kind, fields, choices, model, explanation, and rubric. `shared/workshopCatalog.ts` loads them into a versioned definition and removes presenter notes and unrevealed examples from learner/shared responses. A session stores the complete definition on creation, so later edits do not change a running session.

Run `node scripts/build-rep-guides.mjs` after a content change. It generates all four facilitator guides and agent worksheets. Keep the workshop library duration and screen counts in `web/src/workshops/types.ts` consistent. If content meaning changes, increment the version; do not repurpose an old activity ID for a different skill.

## Session interfaces

All routes use the existing opaque session cookie. Mutations validate Origin and authenticated identity. The join URL is an identifier, not a bearer credential. The server derives roles and agent identity on every operation.

| Interface | Request / result |
|---|---|
| `GET /rep/sessions` | Enabled state and accessible sessions. |
| `GET /rep/sessions/preflight` | Authorized creation capability, agents, linked accounts, eligible coaches. |
| `POST /rep/sessions` | `{id,day,timezone,participants:[{agentId,coachId?}],presenterIds}`; returns `{ok,id}`. |
| `GET /rep/sessions/:id?view=agent\|presenter\|shared\|coach&cursor=...` | Authorized snapshot or `{unchanged,cursor,serverTime}`. `canReview` permits team-scoped evidence review; `canPresent` separately permits presenter controls. |
| `POST /rep/sessions/:id/join` | Authenticated join / presence heartbeat. |
| `POST /rep/sessions/:id/commands` | `slide`, `open`, `timer`, `reveal`, `group`, `end`; exact types in `shared/liveWorkshops.ts`. |
| `POST /rep/sessions/:id/progress` | Activity, status, fixed action metadata, dirty flag, and explicit help. Omitted fields preserve prior metadata. No response text. |
| `POST /rep/sessions/:id/submissions` | `{id,activityId,response}`. Record response is `{submission:{stage,stageSaved,note,task,deal}}`; diagnosis uses `{submission:{phase:'audit',faults}}`. Returns `{ok,attempt}`. |
| `POST /rep/sessions/:id/observations` | UUID, group, rubric criteria, correction, retry; server derives observer and review authority. |
| `GET /rep/sessions/deliveries` | Administrator-only recent digest status and retry errors. |
| `POST /rep/record/grade` | Existing contract remains valid. Optional session/activity/attempt context persists a live attempt using the original grader. |

Polling is every two seconds while active and ten seconds while hidden or ended. Presence has a separate ten-second heartbeat while visible. A 30-second presence gap displays connection interruption. Persistent database state is authoritative; browser storage contains identity/session/version/activity-scoped drafts and unsent operation IDs only.

A pending submission retries its original UUID and payload after an uncertain network response. New attempts use a new UUID. The database serializes attempt numbering and reveal state. Browser Web Locks allow only one editor per learner/activity across tabs; a second tab waits. In a browser without Web Locks, the UI asks the learner to edit in one tab.

## Database and access

`db/hq_rep_live.sql` is additive. It creates session, participant/progress, attempt, observation, follow-up, and digest state plus narrowly granted functions. Raw session snapshots are not granted to browser roles. Attempts and follow-ups have explicit row-level access rules; mutating functions are service-only. Mixed-team presenter membership does not expand access to underlying CRM records.

Global administrators create sessions. Team leaders/coaches receive individual evidence only for currently authorized teams. Learners see their own work and limited names/roles needed for their group. Shared presentation responses contain no roster, private submissions, coaching notes, observation records, or follow-ups.

**The normal repository database is shared with production.** The additive migration was tested in isolated PGlite, compared against production schema and privileges, and applied after Eric approved release. Production grants and RLS were checked afterward. A hosted multi-user load test and real remote cohort remain unperformed.

## Follow-up and email

Live follow-ups extend `GET/POST /data/coaching-assignments`; existing KV-backed assignments remain intact. A session/agent/checkpoint uniqueness constraint prevents duplicate assignments. The creating presenter owns the review by default. Explicit API coach overrides remain supported. Fresh-case prompts are frozen into the assignment at session end. Practice and review history are retained.

Both `REP_LIVE_SESSIONS=1` and `REP_LIVE_DIGESTS=1` are required to send live-training digests. The existing scheduled Worker invokes the digest runner. It combines due/overdue/awaiting-review training work per recipient, starts after 08:00 in the selected session timezone, and includes links without response text. With assignments across timezones, the earliest due assignment in the digest determines the displayed scheduling timezone.

Database claims and provider idempotency keys prevent overlapping sends and ambiguous retries from producing duplicate mail. Delivery status is separate from assignment completion. Inspect `/rep/sessions/deliveries` for failures. Confirm sender configuration and the provider's retry/idempotency behavior in staging before enabling mail. No email is sent by the isolated preview.

## Verification and rollout

The automated suite covers tenant scoping, direct-table access, immutable attempts, duplicate submissions, reveal assistance, the repair diagnosis gate, observed roles, named non-presenter coach review, once-only follow-ups, digest claims, original grading, and certification compatibility. Frontend tests cover identity-scoped drafts, stable choice identities, uncertain-response retries, and existing course navigation.

The local concurrency check runs 50 submissions through actual response validation and durable SQL, followed by 50 authorized reads. Its measurements exclude deployed network latency and do not establish a production SLA. Run the same load and a mixed-team remote pilot on staging; verify normal presenter visibility within three seconds before release.

Operator pilot: join as presenter and learners from two teams; retain an unfinished record across advance/refresh; submit and reveal an opening; rotate every learner through a speaking round; submit peer and coach feedback; end twice; complete and review the follow-ups; inspect the digest failure/retry path. Check full-width FUB controls, keyboard access, enlarged text, late arrival, and second-tab recovery.

Release only after Eric reviews the preview and can identify a specific gap, coach a retry, and later see evidence of application. The approved migration and deployment are complete; the live release record distinguishes automated/local validation from the remaining real-cohort evaluation.

## Rollback

Set `REP_LIVE_DIGESTS=0` to stop training email, then `REP_LIVE_SESSIONS=0` to disable live-session routes and new live work. Existing self-paced courses, quizzes, custom modules, certifications, and historical certification data continue through their original routes. Keep the additive tables and session history; do not drop them as rollback. Re-enable against the same schema to recover live history. The previous application/Worker release can also run while the additive tables remain in place.
