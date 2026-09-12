# Interactive Rep validation — September 12, 2026

## Passing checks

- Frontend TypeScript check; 498 tests in 59 files.
- Worker TypeScript check; 788 Vitest tests in 54 files; six existing native Node operations tests.
- Frontend production build. The existing application still emits Vite's large-chunk advisory; the build succeeds.
- Whitespace/diff validation.
- Isolated additive migration execution in PGlite with service-role grants, browser-role denials, and cross-team result scoping.

The Worker test command now runs the existing native Node operations test with `node --test` instead of asking Vitest to import it. No existing test was removed to obtain a green result.

## Browser verification using the actual new session handlers

The browser connected to the real React app on port 5173 and the isolated Worker adapter on port 8790. Fixture authentication and embedded Postgres replace external services only in the local adapter. These checks used fictitious Alice/Blair accounts from two different teams, with a separate presenter identity.

| Flow | Observed result |
|---|---|
| Mixed-team creation | Presenter selected agents from two teams and created a session without assigning coaches or sending a second invitation. The authenticated creator became both agents' follow-up coach. |
| Original FUB control | Stage menu, native Save control, and original server grader produced a persisted record-check attempt. |
| Edit after success and refresh | The new stage remained saved; the learner saw that the current record differed from the last checked submission. |
| Presenter advancement | Unfinished work stayed on screen with the presenter-moved notice. |
| Second browser tab | The second tab waited for edit ownership and could not overwrite the first tab's active draft. |
| Written draft privacy | Presenter state contained zero attempts and none of the typed wording before submission. |
| Submitted wording | The exact opening became visible after submission, preserving the initial missing introduction details for coaching. |
| Reveal and revision | First attempt remained independent; the revision after the model was labeled assisted. |
| Pair rotation | Both learners received a speaking turn, with the other learner assigned as buyer/observer. |
| Observation | The designated observer could submit attributed feedback. Speaking was explicitly confirmed; retry remained unobserved. |
| Session end | Ending twice produced six assignments total: three checkpoints for each of two learners. |
| Shared presentation and keyboard | Shared view showed the training material without a private roster or responses. Enter opened the full People screenshot; Escape closed it. |
| Non-presenter coach | Team A coach could open Alice's original attempt, assisted revision, and peer correction beside her three follow-up review forms. Team B's agent and private results were absent; presenter controls were unavailable. Server tests also denied coach presenter commands. |

Browser checks complement the SQL/transport tests for access failures, invalid observer roles, duplicate attempts, repair diagnosis, named non-presenter coach review, masked projection, and digest leases. The test observations are fixture data, not evidence that real agents demonstrated these skills.

## Concurrency result

In the final full test run, 50 concurrent submissions through actual validation and durable SQL completed in **376 ms**. Those submissions plus 50 authorized state reads completed in **891 ms** on this local machine. An earlier isolated run measured 654 ms for the same combined sequence.

These measurements exclude browser polling delay, network latency, and hosted Supabase/Worker performance. They do not establish a production three-second SLA. A staged 50-learner test remains a release gate.

## Required before production rollout

1. Review the additive migration; apply and test it in an isolated Supabase staging project with the current full application schema and actual authenticated test users.
2. Verify deployed cookie/CORS configuration, cross-team permissions, reconnect behavior, full-width FUB controls, keyboard and enlarged-text usability on the devices used in training.
3. Verify the configured email sender, consolidated daily digest, failure visibility, and retries in staging. The local adapter sends no email.
4. Run Eric's mixed-team remote pilot through the existing meeting platform, including a speaking turn, correction, targeted retry, and later application review.
5. Enable live sessions and digests only after review. Preserve the existing certification and custom-course flows during rollout.

No production schema or data was changed, no production Worker/Pages deployment was made, and no email was sent during this implementation. See `REP_LIVE_TRAINING.md` for operator instructions, interfaces, and rollback.
