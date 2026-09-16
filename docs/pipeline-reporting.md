# Pulse Pipeline and coaching insights

Pipeline is a tab in Pulse (`#/pulse`). It reports retained stage progression and
current dispositions of tracked leads received in the selected period. It does not change accountability,
achievement history, FUB stages, lead routing, or the webhook subscriptions.

## Review and preview

Open `?demo=1&pipeline=1#/pulse` on the branch preview. This is an interactive
sample, with fictitious names and no customer lead records or links. The Alex
Morgan sample reproduces the supplied Adam example: 165 of 504 leads (32.7%),
12 of 31 conversions (38.7%), 7.3% conversion rate, 76 nurture and 26 rejected.
The demo insights are explicitly illustrative and do not call a model. One
sample Nurture lead also has illustrative Met-with history to demonstrate
retained progression. The supplied screenshots do not establish its history.

The deployed web preview does not install the new Worker endpoints. Signed-in
end-to-end validation requires a reviewed Worker deployment and the migration
sequence below. The production database and Worker are unchanged by this PR.

## Data contract

`shared/pipeline.ts` calculates team totals, owner rows, stage rows and the exact
lead keys behind each clickable count. Identity is team ID plus FUB person ID;
ownership is team ID plus current FUB user ID. Names alone never establish an
agent match. Ponds, unassigned, former members and unresolved identities have
separate rows. Saved historical-only records have an unverified-owner row.

- Lead share: agent leads / all selected team leads.
- Conversion share: agent conversions / all selected team conversions.
- Conversion rate: current under-contract or closed leads / selected leads.
- Nurture and rejected: current category count / selected scope's lead count.
- Zero denominators produce `null` in JSON and an em dash in the interface.

Under contract and closed remain separate stages. Unknown stages remain visible
as unmapped; known names use exact normalized matches. Optional team mappings
categorize raw IDs/names without writing to FUB. Agent selection never changes
the team denominator. Current-stage and owner counts reconcile to the selected
leads. Progression counts intentionally overlap and do not sum to 100%.

### September 16 correction: completed progression

Eric confirmed that reaching a later stage counts every preceding progression
step. The main chart now uses `shared/pipelineProgress.ts`: Lead received,
Attempted contact, Spoke with customer, Appointment set, Met with customer,
Showing homes, Submitting offers, Under contract, Closed. Moving directly from
Lead to Met with includes all steps through Met with. Moving to Nurture retains
those steps without adding Showing, Offer, Contract or Closed. This is a reporting
rule, not an optional earned-credit mode or a coaching issue about CRM updates.

The service combines saved JSON milestone proof, saved stage-log entries, current
FUB stages, and canonical `history_stage_events` from the historical change log
and retained webhooks. Canonical reads occur only after user/RLS team authorization,
are explicitly organization/team scoped, and fail rather than return partial pages.
This closes the Pipeline reporting gap where retained Met-with webhook events
were not included in the older offer-only compatibility sync projection.

Each lead appears once per progression step. A historical `from` stage proves
prior progress without inventing its original entry date. Dated entry evidence
retains the earliest available date; current status alone grants progression
without inventing historical dates. Missing history remains a coverage gap,
never an allegation of missing work. The received-date filter selects leads;
it does not exclude their subsequent progression. Current-owner attribution
and historical-only identity warnings remain intact.

The top conversion metrics retain the approved **current under-contract/closed**
definition and are now explicitly labeled current conversions. Historical
under-contract/closed progress stays visible in the main chart even if a lead
later moves backwards. Raw current FUB stages remain available in a disclosure.
Progress evidence participates in the report snapshot and therefore invalidates
AI caches even when the lead's current status has not changed. The AI prompt
and sales doctrine prohibit criticism for skipped intermediate stage updates.

No new migration is required for this correction, and it does not republish or
rewrite the historical JSON, canonical events, or legacy production calculations.

Dates use the existing Pulse local-time presets and show the browser timezone.
Custom dates start at local midnight and end at the next local midnight
(exclusive), capped at now for today. Leads with missing creation dates are
excluded and counted in coverage. Verified history keeps its source-start rules
and its existing Los Angeles coverage-day boundary. Current synced observations
win over saved stage and ownership; saved-only rows remain explicitly historical.
Freshness includes oldest/newest sync, unknown sync dates and history coverage.

## Authenticated endpoints

- `GET /data/pipeline`: `orgId`, optional `teamId`, optional ISO `from`, ISO
  exclusive `through`, IANA `timezone`, repeatable `source` parameters. Returns
  filters, team totals, owner/stage rows, exact leads, coverage, freshness and a
  SHA-256 snapshot ID. Lead loading is paginated and fails on incomplete reads.
- `PUT /data/pipeline/mappings`: same filters as JSON, one `teamId`, mappings
  keyed by `id:<FUB stage ID>` or normalized `name:<stage>`, plus `mappingVersion`
  (SHA-256 of the existing mappings JSON). Leader/admin only, with stale-save
  checking; the additive schema must exist first.
- `POST /data/pipeline/insights`: same JSON filters, `agentKey`, `snapshotId`.
  The server re-reads authorized data and never accepts client-provided counts.

Existing JWT authentication and RLS restrict team/organization visibility.
Leaders/admins/platform owners retain their existing scope; coaches can read
but cannot edit mappings. Responses are private and non-cacheable in browsers.

## AI behavior and evidence

The first release uses the existing Anthropic integration to prioritize up to
three grounded cards. The model selects candidate IDs; it cannot author or
alter counts, quotes, behavioral claims or coaching moves. Server-built metric
cards provide comparisons and cautious coaching questions. Published coaching
cards retain the source explanation, coaching action, matching quotation,
interaction date and FUB link. The prompt applies `docs/SALES_DOCTRINE.md`.

Evidence comes from the latest 14 published reports for the selected team, then
matches the agent's linked UUID. Held/unpublished reports, ambiguous identities
and findings without a matching quotation are excluded. Repeated findings are
deduplicated, and at most 24 coaching candidates are ranked. Coverage describes
these limits. Historical evidence carries its own dates and never purports to
explain all leads received in the selected period. This button does no scraping,
fresh conversation review, message sending or lead/agent mutations.

The one-hour KV cache includes organization, team, agent, filtered data snapshot,
evidence hash and prompt version. Snapshot and evidence changes during generation
return a refresh request. Unchanged polling timestamps do not invalidate the
snapshot. A per-user request interval and a 30-second provider timeout bound
generation. Failures leave the report usable and offer retry.

## Reviewed release sequence

1. Review the additive migration
   `supabase/migrations/20260916190216_pulse_pipeline.sql` before application.
   It adds nullable `stage_id`, `assigned_user_id`, `assigned_pond_id` to leads
   and a team JSONB mapping field. It does not alter RLS or existing rows.
   **The migration has only been tested in an embedded local database.**
2. Apply that reviewed migration through the normal release process. Deploy the
   Worker before the web app. Enable `PIPELINE_IDENTITY_ENABLED=1` only after
   the columns exist. This opt-in persists the IDs in existing people syncs.
3. Refresh tracked leads through the existing authorized sync/backfill process.
   Incremental updates alone do not prove that every old record has refreshed.
   Unresolved identities stay visible until a real FUB observation supplies IDs.
4. Validate signed-in data reconciliation, team access and freshness on the
   intended environment, then release the Pipeline reporting interface.
5. Keep `PIPELINE_INSIGHTS_ENABLED` unset until real published evidence and
   doctrine checks pass, including a controlled provider smoke test. Set it to
   `1` separately after review. The report works with this flag off.

Both flags default off in this PR. Neither the migration nor production releases
are performed by the preview workflow. The test suite mocks provider calls;
passing tests do not certify live provider output or production evidence quality.

## Validation

Worker tests cover the supplied example, count reconciliation, duplicate IDs and
names, reassignment, source/date bounds, zero denominators, custom mappings,
unknown stages, historical source coverage, owner ambiguity, team isolation,
pagination failures, stale snapshots, quoted evidence, unpublished exclusions,
cache versions and provider errors. The migration test applies the additive SQL
twice to an embedded Postgres database and checks existing data and policies.

Web DOM tests cover exact lead drilldowns, preserved team denominators, filter
changes, custom-date boundaries, coverage, AI request scope, stale responses and
failure recovery. Browser review covers desktop and 390px mobile layouts. Run
the Worker/web typechecks and complete test suites, plus the web production build.
