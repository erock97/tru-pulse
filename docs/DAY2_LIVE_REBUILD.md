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
