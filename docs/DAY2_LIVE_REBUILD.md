# Day 2 live learning rebuild

## Reviewed and corrected

The inherited work was preserved in a binary Git patch and a copy of its untracked learner-preview component before editing. The local-only preview was removed from the implementation: it did not submit learner evidence.

- 27 slides / 90 minutes, introduction and agenda first. Nine activities: three votes (one also asks for wording), four short-answer/discussion exercises, and two breakout practices.
- Lead receipt, channels, introduction, ALMS, buyer questions, and an agreed next step. September 12 teaching and interviews supersede the older LEAD and outreach standards.
- Channel examples precede the acknowledgment exercise. Discovery demonstration precedes the paired practice; the full call demonstration precedes trios. Breakout timing and role rotation are visible. The meeting platform owns video rooms.
- The accepted 1200×675 canvas remains. Day 2 returns to the original TRU charcoal, cream, and muted gold palette.
- Slide navigation uses the existing atomic database command, which both advances and opens an attached activity. Removed the redundant second browser command.
- Learners now see their saved presenter/partner feedback beside their activity. Full-call buyer cards are connected to group assignments.

## Solo rehearsal

Empty-roster Day 2 sessions expose a clearly labeled test learner through the normal learner route. The normal React forms, submission endpoint, response validation, answer reveal, and feedback display are used. Rehearsal evidence is stored separately on the test session via a service-role-only, admin-authorized RPC; it never creates agents, learner records, follow-ups, or certification results. Nonempty sessions continue using the existing agent database transactions.

Migration: `20260914232619_rep_live_rehearsal.sql` adds one JSONB column and one guarded RPC. No existing session curriculum or agent evidence is rewritten. Other training days retain their existing solo presentation behavior.

## Validation

- Web and worker TypeScript checks.
- Web suite: 564 passing tests after final UI checks.
- Worker suite: 928 passing tests plus 9 operational tests.
- Embedded Postgres integration covers real assigned learner identities: vote, written submission, presenter review, private response boundaries, and learner feedback retrieval.
- Separate rehearsal integration covers validation, submit retry deduplication, reveal, persisted writing, observation retrieval, unauthorized access, and zero agent/follow-up records.
- DOM checks cover learner submission and feedback display, and a single atomic command when navigating to activities.
- HTML/PDF companions regenerated from the curriculum. Representative PDF pages rendered and inspected.

Production rollout and browser results are recorded below after verification.

## Production verification — September 14, 2026

Published the additive migration, worker version `34e14480-5f4b-43ae-9e1d-0d99c442b50e`, then Pages deployment `831feb55`.

Production test session: `b9c6fbd8-58ff-4cd6-a45e-333951e73beb` (27-slide snapshot).

In separate signed-in browser tabs:

1. Created Day 2 without selecting agents.
2. Advanced by presenter dropdown; the actual learner received an open vote. Submitted an incorrect answer; presenter displayed 1/1 attempted and its exact choice. No grading gate blocked the submission.
3. Revealed the teaching example; the learner received it and saw later attempts labeled assisted.
4. Submitted a personal callback acknowledgment; the presenter saw the exact saved wording.
5. Created solo speaking practice, submitted the reflection, and saved explicitly labeled rehearsal feedback. The learner received the correction and retry notes. Reloading preserved the feedback.
6. Created the full-call speaking round and confirmed the Jordan buyer card appeared.
7. Inspected all 27 shared slides and measured their canvas: 16:9, no page scrolling, no content overflow. All content scales were 1 except the introduction (0.948). Also checked the full-call activity at a smaller laptop override (1093×614 CSS viewport under the browser’s existing zoom): no scrolling.
8. Verified the new RPC is inaccessible to anon/authenticated database roles, executable by the worker role, and the session table retains RLS. The shared browser console reported no errors.

Final UI cleanup removes repeated question headings, simulator-only status from written activities, and the incorrect coaching-assignment promise on a rehearsal finish. Buyer instructions are shown to the buyer/observer; the speaking learner sees the opening request. Solo rehearsal can inspect both sides.

Final web publication: Pages `6c756e2f` verified the rehearsal finish label and saved feedback. The completed QA rehearsal has zero real participants, zero agent attempts, and zero follow-ups. The original rejected session retains its 38-slide snapshot.

Clean rehearsal ready for Eric: [Presenter](https://app.truhq.co/#/rep/sessions/a64cac95-5a28-4f79-b446-4c1c9c5d1554/presenter), [presentation](https://app.truhq.co/#/rep/sessions/a64cac95-5a28-4f79-b446-4c1c9c5d1554/shared), [test learner](https://app.truhq.co/#/rep/sessions/a64cac95-5a28-4f79-b446-4c1c9c5d1554/agent). It starts at slide 1, with no submitted answers or revealed examples. Browser tabs are left open at these routes.

### Presentation-page participation follow-up (PR #234)

The shared page previously displayed static choices and sent participants to another page. It now loads the authorized agent view into a response panel beside the fixed 16:9 canvas. This uses the existing submission, draft, reveal, observations, and isolated rehearsal persistence paths. The panel is automatic in solo rehearsal and for participants; a presenter can hide it for screen sharing. Catch-up selection changes only the learner's activity.

Production checks on isolated session `1dc133b7-7a03-4963-916f-7a7a6c66a291`:
- Selected a quiz answer and submitted from `/shared`; presenter showed 1/1 attempted with the selected answer.
- Presenter revealed the example; it appeared in the same response panel.
- Typed and submitted a short answer from `/shared`; reloading retained the submitted attempt and text.
- Opened existing test-session feedback from the panel's activity selector; saved presenter correction and retry were visible.
- Measured the slide ratio at 1.77777788, with slide/canvas overflow hidden and the overall document fitting the viewport. Only the separate response panel scrolls.
- Web typecheck and all 567 tests pass, including both panel submission types and unopened-activity gating.

A production asset-loading failure during verification prompted a temporary rollback. Public build assets now receive an explicit CORS header and the service-worker asset cache version is rotated; subsequent production navigation, reload, styles, and submissions were verified. No curriculum, worker, database, real-agent assignment, or production roster changes in this follow-up.

### Website theme correction

Eric clarified that the reference is the live website. Verified https://truhq.co/ in the browser and read its current https://truhq.co/cinema.css. That website is a separate, newer implementation from the old `forest.css` / `forge.css` sources in this checkout. Training now uses its exact ink #171d22, paper #f2f0e9, stone #d6d2c7, blue accent #b9d1fd, line #c9c9be, Manrope headings and DM Sans body. The cover reuses the website's architectural poster and the same image shading. The working inline responses and 16:9 canvas are retained.

Final production verification: the new website theme renders with computed backdrop rgb(23,29,34), response surface rgb(232,229,220), three real quiz radio controls and Submit, 16:9 slide ratio 1.77777794, and no document overflow. During deployment propagation, a new CSS URL briefly returned HTML before returning CSS. The service worker no longer persists/replays build assets from Cache API, preventing an initial invalid response from remaining pinned there; native HTTP caching handles hashed assets. Added a regression test for module and stylesheet request handling. Temporary upload batching adjustments were restored in the local Wrangler installation after deployment.
