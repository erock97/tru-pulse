# Rep QA coverage follow-up — September 12, 2026

The remaining QA gaps were treated as unverified checks. This pass reproduced and fixed offscreen FUB task/deal dialogs and missing modal keyboard behavior. It does not establish readiness of a real remote cohort, hosted load, or external integrations.

## Reproduced defect and fix

On main `71221d4`, open Day 1 missed-call task as a learner at 390 × 844, choose **Enlarge record controls**, horizontally scroll to Tasks, and press its +. The 1,400px record placed its 644px task form at x=-676px, entirely left of the visible viewport. Escape did nothing and focus remained on +. The form was an unnamed div without native modal behavior. Task/deal forms shared this implementation; the ungraded deal demonstration also used an absolute overlay.

All three forms now use a named native dialog in the browser top layer. Forms stay within the viewport, use readable controls independent of screenshot scale, stack their fields on small screens, scroll vertically when needed, focus the name input, dismiss with Escape, and return focus to the opener. Background page controls are inert while open. React Strict Mode's queued cleanup event cannot immediately close a reopened dialog. Existing save/edit logic, five FUB scenarios, grading, certification, and course identities are unchanged.

## Environment and evidence

- Windows, Google Chrome **152.0.7977.83**; actual viewport overrides: **320 × 568**, **390 × 844**, **768 × 1024**, **1280 × 720**. Phone/tablet sizes are desktop Chrome emulation, not physical devices or Safari.
- Real Vite/React app at `http://127.0.0.1:5174`; real Worker handlers and migration via loopback fixture adapter at port 8791 with a new isolated PGlite database. Ports differ from documented defaults because another task was using 5173/8790.
- Separate fixture identities: presenter, Alice (team A), Blair (team B), and team-A coach. Browser identities were switched sequentially; this is not a simultaneous hosted cohort.
- UI session: `712b4757-c91e-49a4-8cc3-c15098051dbb`; independent HTTP smoke session: `3c32cc20-6d9f-4fa2-89e0-a1352bb46a45`.
- [Phone task correction](rep-qa-coverage-evidence/rep-task-phone.png), [tablet deal form](rep-qa-coverage-evidence/rep-deal-tablet.png), [HTTP cohort results](rep-qa-coverage-evidence/cohort-smoke-results.json).

## QA matrix

| Check and reproduction | Result | Expected / actual evidence |
|---|---|---|
| Enlarged record → task + at phone width | **Fail → fixed** | Previously offscreen at x=-676; now native modal bounds x=12, y=207.6, w=351, h=428.8 at 390 × 844. |
| Narrow task dialog at 320 × 568 | **Pass** | Bounds x=12, y=69.6, w=281, h=428.8; dialog client width and scroll width both 281, so no horizontal form overflow. |
| Native keyboard behavior | **Fail → fixed** | Name field gets focus; reverse Tab reaches Close and Cancel without activating background page controls; Escape removes dialog and restores + focus. Named close buttons and dialog labels appear in accessibility tree. |
| Save incomplete task, reopen, add date/time, save | **Pass** | One task named QA follow-up, Sep 14 2026 at 09:30. Correction updates the existing row. |
| Tablet deal save | **Pass** | At 768 × 1024 dialog is 560 × 321.2 at x=96.5, y=351.4; QA offer, $265000, close 2026-09-30 saves. |
| Ungraded deal demo on shared presentation at 320 × 568 | **Pass** | All fields/buttons visible; dialog width and scroll width both 281; height 537 fits viewport. Escape restores Add a deal focus. |
| Reload learner with saved record | **Pass** | Task date/time and deal amount/close date restored without duplicates. |
| Second learner tab, then close original | **Pass** | Second tab displays edit-ownership notice and no record editor; closing first tab hands over with saved task/deal intact. |
| Presenter advances from unfinished task to deal demo; learner reconnects | **Pass** | Task remains selected with saved work and explicit presenter-moved notice; catch-up control remains available. |
| Two-team cohort via local HTTP | **Pass locally** | Duplicate UUID creates one attempt; changed payload with same UUID is refused; reveal preserves independent first attempt and labels revision assisted. |
| Shared projection and team scoping | **Pass locally** | Shared response has zero participants/attempts/observations/followups and no submitted wording. Blair cannot read Alice's attempts or presenter view. Team-A coach sees one authorized participant. Shared browser page displays material without roster/drafts. |
| End local cohort twice | **Pass locally** | Exactly six follow-ups, checkpoints 1/3/7 for two agents; no email sent. |
| Hosted 50-learner submission-to-presenter latency | **Blocked** | No isolated hosted cohort/test accounts configured in this pass. Local tests exclude hosted polling/network and do not prove the three-second target. |
| Actual digest arrival/retry/timezone links | **Blocked** | No designated email recipients or isolated mail environment supplied. Automated digest/lease/timezone tests pass; real delivery remains unverified. |
| Microphone/audio/paid voice | **Blocked** | No approved integration test accounts or paid test flow configured; no service calls made. |
| File upload → publish → playback → archive | **Blocked** | Local live-session adapter does not implement authoring storage; no isolated authoring environment configured. Real courses were not used as test fixtures. |
| Physical printing / print output | **Not run** | No materials changed. Existing guide loading is prior coverage, not evidence of print output. |
| Safari, physical devices, OS enlarged text, complete screen-reader audit | **Blocked / not run** | Chrome responsive checks above do not establish these outcomes; no Safari/device environment available. |
| Operational pilot with Eric and speaking/partner coverage | **Blocked** | Requires real participants and the existing meeting platform. Peer/coach attribution backend tests pass; no actual speaking performance is claimed. |

## Regression and build validation

- Added four rendered-DOM regressions: record task modal, record deal modal, ungraded deal modal, and queued close event during Strict Mode. The first three failed against the original code before implementation.
- Retained date/time correction and no-duplicate regressions; jsdom explicitly stubs native dialog methods. Real browser checks above establish top-layer layout and keyboard behavior, which jsdom does not implement.
- Frontend: typecheck, **516 tests / 62 files**, production build passed.
- Worker: typecheck, **810 tests / 59 files** plus **6 native Node operations tests**, passed. Worker source and schema unchanged.
- Production build uses the existing copied `web/.env.production` with `https://api.truhq.co`. Existing Vite large-chunk advisory remains.

## Preview, release and rollback

Local review: use the existing `worker/ops/live-preview.ts` fixture instructions in `worker/ops/REP_LIVE.md`, then `npm --prefix web run dev`; open `#/rep/sessions` or a self-paced workshop from `#/rep`. In this task's running isolated preview, use `http://127.0.0.1:8791/preview/login?user=alice` and open the UI session listed above.

This is a frontend-only PR. Production was not deployed and no shared database, real assignments, certification, email or integration state was changed. After review, the designated release operator can deploy the configured frontend build. Record the then-current Pages deployment before publishing; rollback restores that frontend deployment. No Worker rollback or database migration is required. Do not assume the older deployment IDs in the previous handoff are still the current release.
