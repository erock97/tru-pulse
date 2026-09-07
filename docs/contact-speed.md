# Contact speed ownership and rollout

The Worker owns arithmetic in src/contactSpeed.ts. Pulse and Coach read the same authenticated /data/contact-speed response. Neither Hermes nor the frontend recomputes averages. No model/API tokens are used for this calculation.

Input contract: shared/contactSpeed.ts. A private SESSIONS KV snapshot lives at pulse-contact:v1:<org UUID>. Membership is checked as the signed-in user before reading; snapshot and lead org identities must agree. Snapshot range is start-inclusive, end-exclusive. Cohort is leads created in that range. Values measure CRM creation to first verified personal recorded outreach, not lead acceptance. Source attribution/history/provenance must be reviewed before setting historyComplete, personal and timeVerified. Those flags are evidence assertions, not model confidence scores.

Email/automatic outreach excluded. Unknown earlier contact, ambiguous personal initiation, mismatched actors, missing communication records, and provider connections without a verified start are held apart from measured rows. Missing is never zero. Snapshot results are recalculated by the same Worker module on read after any import replacement; repeated GETs cannot double count. Duplicate lead IDs rejected.

Call-first practice uses first verified outreach for leads created in the seven days ending at the report end/capture, excluding contacts after that end. Above30% text-first surfaces a practice focus without a minimum-count gate (Eric September6). Counts must remain visible; behavior does not prove fear. Partial seven-day coverage is explicit and does not trigger a full-week claim.

## Current rollout boundary

The authenticated read/calculation path and UI are implemented. A reviewed Costigan pilot input is prepared outside the repository; customer data is never committed or embedded in public JS. No automatic all-team collection is implemented here. The current webhook receiver does not supply these normalized records yet. Source collection must capture Zillow messages/connections, native calls, manual entries and automation provenance before expansion. A webhook notification is an update trigger, not a source of missing historical conversation content. Do not claim this feature is continuously refreshed until that collector is wired and checked.

Importer: validate any incoming file with calculateContactSpeed before storing the unchanged normalized snapshot. Keep the previous snapshot as a rollback, enforce organization identity from the authenticated import context, and publish atomically only after complete collection. Do not use a partial batch as a complete replacement. No metric is calculated by a second module.

## Pending upstream coaching work

The separate rolling Hermes handoff in the workspace contains Eric's critical pre-qualification, response-context, channel-selection, missing-record and skills requirements. This PR restores existing narrative opportunities ahead of isolated actions; it does not rewrite or semantically validate source coaching recommendations. Report-source contracts must still be updated on the laptop.

## September 7 collection repair

`tools/contact-collection` now retrieves and paginates the authenticated Costigan timeline, including `InboxAppMessage` records identified as Zillow Messages. It refreshes the existing pilot cohort, validates ownership, retains source timestamps and delivery status, and normalizes through `shared/contactCollection.ts`. Public API timeline access returned 403 during verification; ordinary textMessages returned no Zillow messages. This manual collector does not establish continuous refresh or all-team rollout. See the collector README for the reviewed-coverage and atomic replacement procedure.
