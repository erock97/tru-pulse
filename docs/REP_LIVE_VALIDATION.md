# Interactive Rep validation — September 12, 2026

## Passing checks

- Frontend TypeScript check; 500 tests in 59 files.
- Worker TypeScript check; 810 Vitest tests in 59 files; six existing native Node operations tests.
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

## Live release checks and remaining evaluation

The approved production migration succeeded. All seven live tables have RLS enabled, anonymous reads and browser inserts are denied, and session RPCs are service-only. Worker version `26d980c7-7aae-4ce2-9658-283d049b2919` and the production Pages build were published. Browser verification confirmed the existing owner's session, real roster, four training choices, workshop library, and generated guide links. Unauthenticated API calls return 401.

The release preserves the already-deployed history baseline `7f0ad98`. Production-schema review also found and fixed the global presenter's live-follow-up review path without expanding legacy assignment or CRM access.

No paid Supabase branch, real-agent test assignments, or test email was created. Hosted 50-learner latency, actual email delivery, device coverage, and a real remote cohort still need observation; local tests do not establish those outcomes. See `REP_LIVE_RELEASE.md` and the operator handoff for deployment details and rollback.
