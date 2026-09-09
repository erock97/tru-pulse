# Product engagement changes — September 8, 2026

## Scope and decisions

Eric approved the product-design changes after the coaching-advice item. Advice generation, doctrine validation, and correction of published reports are deferred. Existing website results are confirmed real; client anonymity and current biographies are preserved. The current source already aligns public navigation and 60-minute consultation copy.

## Implemented for review

- Today is the leader landing page. It lists submitted practice first, then past-due agreed follow-ups, then recorded check-ins beyond the saved cadence. A practice row opens the exact assignment. Missing history and failed reads are explicit, and lead allocation calculations link to their current Pulse source.
- Coach removes the invented personal/team health score and unsupported invitation-open claim. Actual recorded gaps remain measurable even beyond 99 days. One finding and its evidence lead the review; supporting skills/performance are disclosures. Mobile selection opens a separate review with Back to people; search, selected person and queue position survive a trip to the person sheet.
- Quiz-only completion is labeled accurately. Certification presentation requires current module passes, simulation and recorded sign-off. Rep has full roster pagination and progress/readiness filters. Workshop rows use one collection image and the actual facilitated durations; Day 4 stays separate practice.
- Learners see the actual known lesson title and primary practice action. Empty accomplishment cards are removed. Saved reviews, resubmission status and follow-up dates agree with the shared action state.
- New practice and review events persist in existing assignment KV records. Prior follow-up dates remain visible. Legacy missing history is disclosed. Identical sequential retries do not add events; closed records cannot be reopened through the write endpoint. Existing role/team authorization remains enforced.
- Shared mobile headers wrap, duplicate team-view banners are removed, and content clears fixed bottom navigation. Canonical secondary/gold text colors exceed 4.5:1 on sampled warm surfaces.
- Team membership removal is explicit and confirmed. Assessment-link failures retain TRU identity and a return route. Owner pages use Automations; invoice review is named for its actual action; attainment can exceed 100% while the graphic caps.

## Verification and release boundaries

Web and Worker TypeScript checks passed. The full suites passed (486 web tests and 742 Worker tests), and the web production build passed. Browser verification used local sample data, including agent submission → Today review → keep practicing → learner return with saved follow-up and history. Responsive checks covered desktop, 390px and 320px shared mobile shells, the training list, and the separate Coach review. Vite retains its existing large-chunk warning; field performance was not measured.

This branch does not deploy either service or change live data. Deploy the matching Worker before the web app so saved history and retry handling are available. No database migration is needed.

Workers KV still does not offer atomic compare-and-swap for simultaneous updates to the same record. Sequential retries are covered; the event history is not an atomic audit log. A concurrent-write storage redesign remains separate work. Real leader/agent persistence and authorization must be verified in an agreed non-production environment before rollout; a demo cannot prove live account behavior.

The larger audit also proposed a full analytics/pilot program, source-to-assignment provenance, workflow queue filters, and test/synthetic owner filters. These are not claimed complete by this branch. Synthetic/live classification needs an explicit source marker; do not infer it from customer names. Actual screen-reader/device testing and field performance remain release checks. No new public customer story is introduced.
