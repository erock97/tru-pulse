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
