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
- Web suite: 562 passing tests before final presentation checks.
- Worker suite: 928 passing tests plus 9 operational tests.
- Embedded Postgres integration covers real assigned learner identities: vote, written submission, presenter review, private response boundaries, and learner feedback retrieval.
- Separate rehearsal integration covers validation, submit retry deduplication, reveal, persisted writing, observation retrieval, unauthorized access, and zero agent/follow-up records.
- DOM checks cover learner submission and feedback display, and a single atomic command when navigating to activities.
- HTML/PDF companions regenerated from the curriculum. Representative PDF pages rendered and inspected.

Production rollout and browser results are recorded below after verification.
