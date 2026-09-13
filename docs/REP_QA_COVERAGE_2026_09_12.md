# Rep QA coverage follow-up — September 12, 2026

This pass reproduced and fixed offscreen FUB dialogs, voice-call lifecycle failures, partial course publication, quiz loss on failed replacement, missing media previews, and stale facilitator instructions. It adds eight printable PDFs and a repeatable 50-learner HTTP/polling check. Real hosted integrations and the operational pilot remain unverified; the PR is not an all-green production sign-off.

## Reproduced defect and fix

On main `71221d4`, open Day 1 missed-call task as a learner at 390 × 844, choose **Enlarge record controls**, horizontally scroll to Tasks, and press its +. The 1,400px record placed its 644px task form at x=-676px, entirely left of the visible viewport. Escape did nothing and focus remained on +. The form was an unnamed div without native modal behavior. Task/deal forms shared this implementation; the ungraded deal demonstration also used an absolute overlay.

All three forms now use a named native dialog in the browser top layer. Forms stay within the viewport, use readable controls independent of screenshot scale, stack their fields on small screens, scroll vertically when needed, focus the name input, dismiss with Escape, and return focus to the opener. Background page controls are inert while open. React Strict Mode's queued cleanup event cannot immediately close a reopened dialog. Existing save/edit logic, five FUB scenarios, grading, certification, and course identities are unchanged.

## Environment and evidence

- Windows, Google Chrome **152.0.7977.83**; actual viewport overrides: **320 × 568**, **390 × 844**, **768 × 1024**, **1280 × 720**. Phone/tablet sizes are desktop Chrome emulation, not physical devices or Safari.
- Real Vite/React app at `http://127.0.0.1:5174`; real Worker handlers and migration via loopback fixture adapter at port 8791 with a new isolated PGlite database. Ports differ from documented defaults because another task was using 5173/8790.
- Separate fixture identities: presenter, Alice (team A), Blair (team B), and team-A coach. Browser identities were switched sequentially; this is not a simultaneous hosted cohort.
- UI session: `712b4757-c91e-49a4-8cc3-c15098051dbb`; independent HTTP smoke session: `3c32cc20-6d9f-4fa2-89e0-a1352bb46a45`.
- [Phone task correction](rep-qa-coverage-evidence/rep-task-phone.png), [tablet deal form](rep-qa-coverage-evidence/rep-deal-tablet.png), [HTTP cohort results](rep-qa-coverage-evidence/cohort-smoke-results.json).

## Additional reproduced failures and fixes

- Voice allocation resolving after the learner left could start a microphone connection. A dropped call followed by the provider's end event could invoke grading, and duplicate end events could grade twice. A call generation guard now cancels stale setup/results; errors stop the client without grading; grading runs once. Late connection completion cannot re-arm audio after teardown. Five rendered-DOM regressions cover these paths with a fake SDK; actual microphone/audio quality remains an external check.
- Publishing saved the module as published before its quiz completed. A failed quiz left a partial publication, and retrying a new module created a duplicate. The editor now saves a draft, retains its ID, saves the entire quiz (including an empty draft), and publishes only after success. Publication is disabled while quiz loading or upload is in flight. Five DOM tests cover recovery, final-question removal, upload completion, and the actual learner media player in preview.
- The Worker deleted existing questions before inserting replacements in a separate HTTP request. The proposed service-only `rep_replace_custom_questions` RPC locks the draft and replaces questions in one transaction. A forced post-deletion insert failure preserves the exact original rows. A publication trigger also protects the list shortcut/direct API from publishing an empty or malformed quiz. Eleven isolated Postgres tests cover rollback, validation, role denial, cross-org rejection, and preservation of system-course behavior. **This migration is proposed, not applied to production.**
- Guides no longer ask for a second invitation or imply that every selected team needs a separately assigned coach. They describe Eric selecting existing agents, the creator owning follow-up by default, private/shared screens, and speaking/feedback/retry with an absent-partner fallback.
- Every guide and worksheet now has a downloadable PDF. All eight files (43 pages) were rendered and visually checked; 961 source paragraphs/headings/list entries were checked against extracted PDF text. This is printable-file validation, not a physical printer test. Rebuild with `node scripts/build-rep-guides.mjs`, then `python scripts/build-rep-guide-pdfs.py` (ReportLab and BeautifulSoup required).

## 50-learner HTTP and polling result

[Recorded run](rep-qa-coverage-evidence/local-http-load.json): 50 separate fixture identities across two teams, 150 submissions over three rounds, 151 learner reads, four presenter reads, no HTTP errors or missing attempts. The presenter polling delay uses the application's `LIVE_POLL_MS` (2,000 ms). Submission-to-presenter response latency: p50 **1,034 ms**, p95 **1,902 ms**, p99 **2,014 ms**, maximum **2,047 ms**. Submission requests: p95 421 ms; learner reads: p95 428 ms. Shared projection still contained no submitted wording.

This runs through loopback HTTP, real Worker session handlers, and embedded Postgres. It includes polling and local request handling, but excludes hosted network/service delays and browser rendering. It does not establish the hosted three-second target. Reproduction commands are in `worker/ops/REP_LIVE.md`.

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
| Microphone/audio/paid voice | **Lifecycle fixes verified; real integration blocked** | Five new regressions pass; no approved integration account or paid test flow configured, and no service calls made. |
| File upload → publish → playback → archive | **Recovery fixes verified; hosted flow blocked** | Five authoring DOM tests and eleven transactional SQL tests pass. Real storage signing/upload, learner playback and archive require an isolated environment. No real courses used as test fixtures. |
| Printable output | **Pass for generated PDFs** | Eight downloadable PDFs, 43 pages rendered and reviewed; source content preserved. Physical printing and browser-native print output are not claimed. |
| Safari, physical devices, OS enlarged text, complete screen-reader audit | **Blocked / not run** | Chrome responsive checks above do not establish these outcomes; no Safari/device environment available. |
| Operational pilot with Eric and speaking/partner coverage | **Blocked** | Requires real participants and the existing meeting platform. Peer/coach attribution backend tests pass; no actual speaking performance is claimed. |

## Regression and build validation

- Added four rendered-DOM regressions: record task modal, record deal modal, ungraded deal modal, and queued close event during Strict Mode. The first three failed against the original code before implementation.
- Retained date/time correction and no-duplicate regressions; jsdom explicitly stubs native dialog methods. Real browser checks above establish top-layer layout and keyboard behavior, which jsdom does not implement.
- Frontend: typecheck, **525 tests / 64 files** passed in the full suite, followed by all five authoring tests after adding the upload regression (**526 total tests**). Production build passed.
- Worker: typecheck, **821 tests / 60 files** plus **6 native Node operations tests**, passed. New SQL was executed only in isolated embedded Postgres.
- Production build uses the existing copied `web/.env.production` with `https://api.truhq.co`. Existing Vite large-chunk advisory remains.

## Preview, release and rollback

Hosted frontend preview: https://fix-rep-qa-coverage.tru-pulse-app.pages.dev/#/rep (alias: https://fix-rep-qa-coverage.tru-pulse-app.pages.dev). It uses the existing API, so use local fixtures for test writes; this frontend preview does not validate the proposed authoring migration or Worker.

Local review: use the existing `worker/ops/live-preview.ts` fixture instructions in `worker/ops/REP_LIVE.md`, then `npm --prefix web run dev`; open `#/rep/sessions` or a self-paced workshop from `#/rep`. In this task's running isolated preview, use `http://127.0.0.1:8791/preview/login?user=alice` and open the UI session listed above.

This PR now spans frontend, Worker authoring, a proposed database migration, and workshop materials because the verified failures cross those boundaries. Production was not deployed and no shared database, real assignment, certification, email or integration state was changed.

After approval and staging validation, the designated operator must apply `supabase/migrations/20260913014446_rep_authoring_atomic_quiz.sql` **before** deploying the updated Worker, then publish the frontend. Do not deploy the new Worker without its RPC. Legacy cached editors must reload: their publish-before-quiz sequence is deliberately rejected by the new database guard. The migration requires the existing Rep authoring schema; it changes no existing rows and leaves system curriculum/certification untouched.

Record the current Worker and Pages versions before release. For a coordinated rollback, restore the prior Worker and frontend; if old authoring behavior must be restored, the approved database operator can drop only `rep_custom_publication_check` from `public.rep_modules`. The unused service-only RPC can remain. Do not drop question, progress, session, or certification data. Old authoring code reintroduces the original partial-save risks.

## Remaining external checks

Read-only discovery confirmed TRU-Pulse has no development branch or separate staging project. A verified sending domain exists, but there is no designated test recipient. The user has been asked for the Supabase organization needed to quote a temporary branch, test email/device details, and has not yet supplied them. No paid branch or real messages were created.

- Hosted environment: provision isolated auth/database/storage and fixture identities after cost approval; run the two-team scenarios and 50-client test using proper staging credentials, recording network-to-render latency. The local runner deliberately rejects remote hosts and is not a hosted credential mechanism.
- Digest: use the designated test inbox, validate the one-daily-email grouping, displayed timezone/due dates, deep links, retries without duplicates, and day 1/3/7 coach review. Existing automated tests cover construction and leases; actual delivery is not observed.
- Media/voice: in a disposable custom course, upload a video/PDF, publish, view as a learner, and archive; confirm signed access expires correctly. Use the approved voice account for microphone permission, audible buyer, hang-up, interruption and one graded result. Fixture tests are not paid-service evidence.
- Device/pilot: check Safari/iPhone/tablet and OS enlarged text, complete keyboard/screen-reader coverage, then run Eric's real meeting with at least two teams. Observe every speaking turn, correction/retry and absent-partner case. These require people/devices; software tests cannot establish the outcome.

