# Conversion audit — September 7, 2026

Read-only reconciliation of six private history snapshots through September 5: 13,495 leads, 9,775 milestone rows, 133 current-owner agent groups, 985 current/historical comparisons, no count discrepancies. 212 comparisons precede source coverage and are unavailable, not zero. No duplicate IDs within a team, invalid creation dates or cross-team rows were found.

Run `node scripts/audit-conversion.mjs <private-snapshot.json> ...` after installing web dependencies. AUDIT_NOW can pin the audit clock; default is September 7, 2026 at 17:00 UTC. The script transpiles the real frontend comparison function and compares its results with a separate milestone-ledger grouping. Keep snapshots and detailed reports outside the repository. This is an internal consistency audit of the import, not independent FUB source verification.

Current-owner attribution is explicit. A full reassignment timeline and a complete month-to-date assignment import are not established by these snapshots. No claim of historical agent ownership or intake completeness follows from a passing audit.

The fractional ratio formatter, zero-contract health classification/ranking, overall-rate review signals and comparison cohort guard were corrected with regression tests. The public website walkthrough uses invented sample data and makes no client performance claim. Its main next step is the existing booking page.
