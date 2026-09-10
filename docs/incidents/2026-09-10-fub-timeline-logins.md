# FUB login alert loop: containment and laptop handoff

## Incident and evidence
The Pulse Cloudflare worker's TimelineCollector used Durable Object alarms to run independently of the laptop and ordinary cron schedules. Its FubTimelineSession read account usernames/passwords from Infisical /fub-logins, submitted the FUB website login form with remember=0, then requested private website timeline endpoints. This was HTTP website login automation, not the approved API-key sync.

The code covers six configured account suffixes. A collection error discarded the session and scheduled another attempt five minutes later. That explains repeated new-session alerts and why updating the stored credentials could restart successful authentication attempts. A separate investigation reported timeline HTTP 403 responses; the retry code was verified here, but that specific production response was not independently captured in this patch work.

Turning off the laptop did not stop the cloud alarms. An emergency guard, FUB_TIMELINE_LOGIN_DISABLED_20260910, was deployed in Cloudflare version d6a77b98 at approximately 12:48 PM Pacific on September 10, 2026, before credential reads or login requests. The public API health check returned 200 afterward. Eric subsequently confirmed the emails stopped. That supports this collector as the cause of the alert loop; it is not an account-wide security certification.

## Permanent source change
- All FubTimelineSession entry points are inert and throw the disabled error. Credential reading, login form submission, cookies, redirects and private timeline fetching are removed.
- Timeline enqueue calls are no-ops. Existing Durable Objects cancel alarms when invoked and never reschedule. Keep the binding/class/migration so existing objects can execute this cancellation.
- Stored evidence is retained. Collector reports say disabled; historical snapshots retain their last successful capture time. The dashboard excludes disabled collector snapshots and uses its existing uploaded baseline, if available.
- Archived collector Zillow counts are no longer added to API contact counts. This removes supplemental Zillow coverage: API counts alone must not be described as proof that a lead received no contact across all channels. Review any operational flag depending on that coverage before relying on it.
- No API-key sync, password values, local schedules or weekly report settings are enabled by this patch.

The emergency Cloudflare edit and this Git source patch are separate. Until this branch is merged and its worker released, a deployment from unpatched source can restore the login loop. Never roll back to a version containing the active collector. Do not test by attempting a real FUB login.

## Laptop Codex implementation handoff
Eric authorizes metadata interpretation of already available, approved data. Do not introduce another cloud or local scraper, login/session renewal, polling schedule, private website endpoint reader, or collection fallback. Do not restart paused jobs as part of this work.

1. Fetch and review fix/disable-cloud-timeline-logins in erock97/tru-pulse. Reconcile it with current main and preserve unrelated changes. Coordinate the worker release; do not overwrite the live emergency guard with old code.
2. Inspect Quinn's existing payloads and the actual receiver built during this incident. Establish the endpoint, authentication, tenant mapping and one redacted payload before implementation. This source review found shared/contactCollection.ts as an existing pure normalizer and the pulse-contact:v1:<orgId> read path, but did not establish the laptop receiver contract. Do not invent one or assume the timeline collector was that receiver.
3. Map only fields already present: team/account ID, contact ID, event ID, event timestamp plus timezone, direction, sender/recipient identities, channel, automation provenance and delivery status. Use explicit recorded direction first. Infer from known sender/recipient identities only under a documented rule. Otherwise record unknown.
4. A timestamp tells when an event occurred. It does not prove inbound versus outbound, manual versus automated, delivery, connection, or who acted. Contact updatedAt is not a communication timestamp. Missing fields or history mean unknown/incomplete, not zero activity. Preserve source timestamps separately from ingestion time.
5. Use a pure interpreter with no network or secret access. Reuse shared/contactCollection.ts only if its expected payload genuinely matches existing input; its current timeline schema is not proof that Quinn already has those fields. Sender attribution must remain tenant-scoped and account for reassignment. Deduplicate with account/contact/event identity; tolerate repeated and out-of-order delivery.
6. Test with redacted fixtures: inbound, outbound, unknown direction, automated message, failed delivery, timezone offset, duplicate event, reassigned owner and incomplete history. Missing evidence must never trigger a login or scraping attempt.
7. Report exactly which existing metadata supports the output and which fields remain unknown. If existing data is insufficient, present that gap to Eric before expanding collection. Audit dependent Zillow-only contact flags so unavailable coverage does not become an unsupported zero-contact conclusion.

## Release acceptance
Source tests must show every session method rejects without credential access or network; existing alarms cancel without setting new alarms; enqueue cannot start work; archived data survives; disabled snapshots are not presented as live.
After the authorized worker release, verify deployed version, public API health and disabled collector state without touching FUB login pages. Observe through at least two former retry intervals and confirm no new attempts. Keep local/weekly jobs paused unless separately authorized. Removing the emergency guard is not a rollback plan.

## Validation on September 10
TypeScript passed. All worker/src tests passed: 751 tests in 50 files. The full Vitest invocation additionally discovered an unchanged Node operations test, ops/link-hermes-team.test.mjs, and failed to load it with SyntaxError: Invalid or unexpected token. That full-suite limitation remains; its source was not changed here. Dependency installation used the lockfile with scripts disabled and reported existing dependency advisories; no dependency versions were changed.

## September 10 correction after laptop review
The initial PR was not safe to release because removing supplemental Zillow counts left unsupported negative decisions downstream. This revision explicitly holds contact-based accountability: no new strikes, automatic compliance closures or strike-based pause recommendations. The weekly accountability brief is suppressed while held. The morning brief preserves intake/stage observations but suppresses cached untouched claims and cannot say all clear when coverage is incomplete. No case ledger is rewritten.

API-only negative and missing classifications become unknown; cached zero_contact values are also normalized on the dashboard read path and after historical merging. The dashboard labels incomplete coverage and held contact review; manually paused states and independent volume/closing observations remain separate. API sync continues. This is a deliberate decision hold until a reviewed coverage contract can support those conclusions, not a new data collector or automatic retry setting.

Refreshed Cloudflare inspection confirmed d6a77b98 active at 100% traffic. The observed deployed bundle was copied for local comparison; text-transfer encoding was checked against the browser copy (same normalized length and checksum). After correcting transfer-only encoding differences, the candidate differs solely in the retired collector, contact evidence hold and their consumers. coachBriefIngest and other unrelated compiled modules match. Neither deployed code nor this candidate includes /coach/weekly-report/receipt or COACH_REPORT_CLIENTS. Local receipt-cutover documents explicitly describe unreleased proposals; the laptop's configured transport must not be assumed to prove receiver deployment. No receipt upgrade is included in this release.

Validation: worker/src suite 754 passed before adding the historical-snapshot case; the collector suite then passed all six cases including preserved nonempty capturedAt/through. Web suite 486 passed in 57 files. Both TypeScript checks and local worker/web production builds passed. Full worker Vitest includes a Node-native operations suite; run that suite with node --test rather than Vitest. No live FUB request is part of validation.
