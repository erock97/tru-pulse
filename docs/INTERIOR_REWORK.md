# Interior review — September 5, 2026

## Direction
Keep the accepted stone/cream surfaces, slate navigation, serif emphasis, gold actions and terracotta attention. The UI should help a broker choose the next useful conversation without presenting activity metrics as proof of conversational quality.

## Implemented
- A scoped app presentation layer covers leader and agent shells, Pulse, Coach, Rep, Team, admin teams, team data, revenue, contracts, calendar and the signed-out form. Public marketing styling is outside the scope selector.
- Desktop navigation is a solid horizontal bar. Phone navigation keeps all five owner tabs in one row. Account context and sign-out stay visible on phones.
- Impersonation has a persistent team banner and return action using the existing server session flow.
- Larger primary charts have numeric axes; roster filters and all underlying drill-ins remain available. Decorative grain, glows, ambient rooms and scroll-reveal hiding are removed from the new presentation.
- Calendar leads with a seven-day agenda using the account timezone. Day selection, next/previous week, Today, next booking, and all-upcoming disclosure use the existing bookings response. Google events outside TRU bookings are explicitly not implied. Existing booking controls and authorization remain intact.
- Pulse interpretation now distinguishes contracts from closings and avoids asserting that a high worked percentage proves poor call quality. The detail drawer uses the same contract terminology and supports keyboard focus containment/return.
- Coach headline leads with coaching work rather than a blanket personality prescription. Existing assessment details and weekly evidence remain available.

## Validation and limits
- TypeScript and production build pass.
- Web suite: 389 passed, one failed. The failure is the existing Day 1 slide-5 content-hash expectation in `zillowDecks.test.ts`. Both the test and deck JSON are unchanged from base/main 16161d8; this rework does not alter training content or update its snapshot.
- Local browser checks at 1440 and 390 pixels: Pulse, Coach, Rep, Team, agent home, login; owner teams, targets, revenue, contracts, calendar. No page overflow or runtime errors in the test run. Owner responses were intercepted test fixtures; no real private owner data was used for these checks.
- Mock logout returned to the login form. Actual owner-session verification remains a pre-production step: the available live session returned to the agent account “Eric and Adam”, not an owner account. No permissions were expanded to work around that.
- No production deploy, backend change, email, invoice, contract, invite, or booking mutation is part of this rework.
- Semantic report validation and issue-ranking improvements discussed in the earlier audit are separate pipeline work; this visual pass does not certify Hermes recommendations.

## TRU Brain activity (local fallback)
`open_current_project` was unavailable. Eric's earlier explicit override was retained. No project ID was invented.

Activity: created isolated `feat/premium-interior-rework` from main; implemented app styling, navigation, calendar agenda, factual-copy corrections and drawer accessibility; ran build, typecheck, regression and local browser checks; prepared a preview and PR.

Proposed decision for Eric: accept this visual direction after reviewing the phone preview, then verify Eric's and Adam's actual owner sessions and a live team impersonation round-trip before promoting the interior to production. This proposal is not recorded as an approved production decision.

## Second pass — focused Coach and Today (September 5)

Replaces the published coaching card grid with a searchable people queue and one agent review, preserving source evidence and existing 1:1 forms. Team measures and full directory remain available as disclosures. Adds explicit return navigation. Pulse and Coach targets have explicit browser-local, account/team-scoped save controls. Reduces secondary chart/card decoration and removes remaining green presentation in the affected Coach/Rep surfaces.

Today uses the existing authenticated coaching roster and open-commitment loaders. Recorded check-in gaps determine cadence order, not conversation quality. Commitments are not falsely labelled overdue: the source has no due date. Broker calendar is explicitly not connected yet. This is a first functional Today surface, not a claim that all tasks are integrated.

Validation: typecheck and production build pass. Web suite: 389 pass, 1 existing unrelated Zillow Day 1 HTML hash failure. Browser: Coach search/selection, evidence disclosure, session navigation and return; Today action data; phone layout and fixed navigation verified. Previous target Save/reload verified in demo. Production unchanged.

## Third pass — working hierarchy
Rep now opens on agent progress and a compact status line; the curriculum and aggregate track are disclosed below the roster. Removed duplicated Live Sim action, corrected displayed module numbering, and flattened per-agent results. Team now has shorter task-oriented copy, membership help disclosure, corrected role/account column widths and no overlapping sticky header. Pulse adds agent search and precise no-contract/within-target labels. Coach has a wider focused workspace and consistent proof controls. Today distinguishes missing history from old recorded check-ins, including gaps of 99+ days, with regression tests. Shared colors, focus rings, calendar borders and sign-in edges refined.

Checks: typecheck/build pass. 391 tests pass; same pre-existing Zillow hash failure. Browser verified Rep roster/results, Team columns, Pulse search and signed-out route. Owner/admin authentication and broker calendar integration remain unverified/unfinished; no production deployment.

## Fourth pass — Pulse rebuilt around the register
Removed the standalone target slider, duplicated attention cards, personality subtitles, green avatar treatments and full-row warning fills. Four summary figures lead into the agent register. Review-only filtering and search compose; reasons appear in their agent row. Target editing is disclosed and only saved values govern comparisons. Existing detail drawer, period selection, sorting and all data columns remain. Zero counts now display as zero. Source/coverage notes remain available below the table. Drawer surfaces and source marks use the neutral palette.

Verified desktop/table, review filtering, detail open/close, target Save/reload, and phone summary/controls. Typecheck/build pass. Web tests remain 391 pass, one existing unrelated Zillow hash failure. Preview only.

## Fifth pass — unified navigation and stone surfaces
Moved Search into the single pinned top navigation across app tabs and removed the duplicate logo/search strip. Contextual period and return controls remain below the navigation where needed. Added Today to command navigation. Deepened the stone canvas, queue and table headers; reserved lighter surfaces for the selected coaching review and active work. No hero cards or shadows added. Mobile retains a labelled Search button and bottom section navigation.

Typecheck and production build pass. Web tests: 391 pass, same existing Zillow slide hash failure. Desktop Search and sticky navigation checked; phone layout and Search checked. Preview only; production and backend unchanged.

## Minimum expectation and trend requirements — September 5
Changed Pulse and its detail view to treat fewer leads per contract as stronger performance. 1 in 11 and 1 in 16 both exceed a 1 in 30 minimum. Equality is explicit; comparisons use unrounded values. The UI retains contract terminology because this loader does not measure closed transactions.

Trend proposal (not enabled): show routine movement in Pulse; escalate only sustained deterioration toward/below the minimum with comparable lead cohorts, consistent outcome maturity, sufficient sample size and source coverage. Every alert should expose periods, lead/outcome counts, change, source and reason. Missing history must produce an unavailable result. Current roster filtering uses fub_created and current stages, not dated assignment/outcome history; it cannot establish historical conversion or new assignments in the last 30 days. Inspect the available stage-event history and its coverage before selecting an implementation.

Pending Eric clarification: whether the 15-lead rolling 30-day cap is per agent or per team, and whether it counts new assignments. Do not apply 15 to current created-date cohorts as an assignment cap. Today should receive actionable cap/minimum alerts once definitions and coverage are established, not every negative fluctuation.

Checks: typecheck/build pass, 394 tests pass with the existing Zillow hash failure. Demo browser confirms Priya 1 in 11 exceeds minimum and absent ratio is not established.

## Agent proof, calendar periods, Worked removal — September 5
Eric clarified: allowance is 15 newly assigned leads per agent, MONTH TO DATE (supersedes rolling 30 days). Proposed deterioration trigger is five additional leads per contract or more; show assignment-volume changes beside it. These alerts remain unimplemented until dated assignment history and comparable outcome coverage are available. Do not use creation dates as assignment dates.

Implemented: Month to date replaces 30d and is the default. Six months is current month plus five preceding calendar months, using browser-local boundaries disclosed in About these numbers. Each agent has a collapsed Proof disclosure with exact ratio arithmetic, contributing lead rows, current stage, source, creation timestamp and FUB identity. Source links use the matching team subdomain; missing link metadata is explicit. Offer/contract numerator filters use the same stage classifiers as the aggregate. This proves how the loaded snapshot is counted, not historical assignment or source-data accuracy.

At Eric's direction removed Worked from the Pulse column, summary, detail and priority copy; no replacement activity score. Corrected the shared worked counter to accept only explicit worked flags. Low volume alone no longer creates a review alert, preventing month-start false urgency. Existing underlying activity ingestion remains unchanged.

Checks: typecheck/build pass. Tests 397 pass and one existing unrelated Zillow slide hash failure. Browser checked MTD, 6mo, absence of Worked and five contract records matching the selected agent numerator. Production unchanged.

Removed the redundant Pulse View column at Eric's request. Agent names are accessible buttons opening the existing detail panel; Proof remains separate. TRU Brain still unavailable; existing override retained.
