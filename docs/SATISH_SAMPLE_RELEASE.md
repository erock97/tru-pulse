# Approved Satish sample release attempt

Code: cc6378e. PR: https://github.com/erock97/tru-pulse/pull/206
Worker: b75ec449-1a71-4513-adff-f4699b0c3579
UI: https://7c0d06b6.tru-pulse-app.pages.dev

Eric approved this exact partial sample in desktop chat. Exception binds operator,
team, run, payload hash, revision, operation ID and reason. Broad partial publishing
remains false; existing submission/schedule settings unchanged. No schema changes.
Tests: 85 receiver/coverage, 29 operator, 499 web passed; both typechecks/build passed.

Operation satish-sample-release-20260909-eric returned 409 evidence_conflict.
Reconciled original identity: held revision 1, zero stored operation rows.
Same exact command retried once to obtain sanitized error after reconciliation;
no replacement operation or run was created.

Read-only diagnosis found at least five conflicting legacy finding/pattern groups
among already published Satish reports. Their quote variants differ; none of those
groups involves the new sample. The transactional rebuild refuses conflicting
source evidence. No legacy report or evidence was changed to bypass this failure.
The sample remains held; broker publication is NOT complete.

Next correction requires an explicit evidence-preserving legacy projection policy;
do not silently choose a quote, erase a conflict, skip the transactional rebuild,
or call the report published. All original payloads and audit records remain intact.
