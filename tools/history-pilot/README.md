# Costigan historical milestone pilot

Collects January 1, 2026 onward Zillow Preferred leads using normal authenticated FUB requests. Runtime login values come from Infisical prod /fub-logins. No credentials or cookies are persisted. Raw customer files belong outside git and must not be published as public preview assets.

Run from repository root:

    ./tools/history-pilot/collect.ps1 -OutputDirectory ../../outputs/costigan-history-private
    node tools/history-pilot/build-report.mjs ../../outputs/costigan-history-private
    node --test tools/history-pilot/metrics.test.mjs

Collector follows same-host pagination, rejects ownership mismatches, retries bounded transient failures, checkpoints per lead and stops on authentication refusal. A rerun reuses complete checkpoints: use a NEW output directory for a fresh historical snapshot, as completed histories are deliberately not refreshed automatically. Failed records retry. This is a snapshot collector, not a scheduler.

Report defaults to Jan 1–Sep 5, 2026, Pacific reporting dates, source Zillow Preferred, current assigned owner. Date controls narrow the cohort. Milestones use historical changes through the selected end date; Nurture now always uses the current snapshot. Pending and Under Contract collapse to one per-lead milestone. Eric's cumulative credit rules preserve preceding production milestones without inventing dates. Actor identity does not affect inclusion. Historical old/new stages are parsed from descriptions; current state does not manufacture historical events.

Live pilot verification: 488/488 histories collected, zero failures and zero unparsed stage descriptions after supporting observed automated and actorless formats. Counts: Met 87, Offers 31, UC 29, Closed 17, ever Nurture 258; current Nurture 233/488 (47.7%). Thirteen meaningful calculation tests pass. Standalone report script syntax validated. Browser visual verification unavailable because the browser URL policy blocked local HTML; no workaround attempted.

This is a private local interactive report and repeatable collector. It is NOT yet a deployed authenticated app integration, database import or webhook change. Backend storage/import must be reviewed separately; no shared database records were changed. Access to deleted/inaccessible FUB people is not certified. Output is limited to the currently identified source cohort. Current source/owner may differ from historical source/owner.

Monthly production now attributes skipped-stage credits to the qualifying later event timestamp; first credit is retained across periods. Production view covers the collected January-to-date source roster, not uncollected prior-year leads. Eighteen calculation tests pass. Current owner remains the attribution basis.
