# Four-quadrant training edition

September 16, 2026. The curriculum JSON files are shared by Rep and the live-session catalog. A newly created live session snapshots this edition; existing sessions retain their original content and evidence.

## Teaching structure

- Day 1: demonstrate, practice in the simulated Follow Up Boss record, and review the saved result. All five record scenarios, the contact tool map, and the deal demonstration remain.
- Days 2–4: introduce the topic, hear agents' initial reasoning, teach the steps and examples, then practice. New discussions are ungraded. Existing roleplay, observation and retry contracts remain.
- Each day has four named sections, an agenda, section dividers and independent-review directions. Teaching explanations appear in the slides, not only in presenter notes.
- Day 3 starts with preparation: property research, listing-agent questions, a relevant tour of two to four homes when appropriate, confirmation of access and buyer priorities, and a useful packet. The post-tour opening remains “Did we see any homes we want to write an offer on?”

| Day | Slides | Planned minutes |
| --- | ---: | ---: |
| Follow Up Boss | 40 | 61 |
| First conversation | 35 | 90 |
| Showing and buyer decision | 32 | 75 |
| Lender introduction | 28 | 71 |

Section dividers have no additional planned minutes. Timing includes practice and discussion.

## Review materials

`/workshops/training-review.html` links to all four portable HTML decks and agent PDF references. HTML decks embed their images and font, include navigation, answer reveals, saved local notes and a reading view. The hosted decks load a same-origin script to comply with the existing Content Security Policy. The portable output embeds that script too and works as a standalone file. Native record practice links back to Rep, where the controls and saved-action checks run. The portable files do not submit live evidence or issue certification.

Agent references now contain teaching explanations, practice space and a separate answer-review section. Facilitator guides retain cues, timing and observation instructions. Live learners still receive redacted answers until the presenter reveals them; the downloadable reference deliberately contains the complete material for later study.

## Sources and editorial choices

The existing Day 1–4 curriculum, `docs/SALES_DOCTRINE.md`, existing Day 2/3 source generators, and Eric's September 16 instructions supply the teaching process. The supplied preparation slide adds the research, listing-agent call, tour size and packet topics. Its “best property last” memory claim was not adopted as a universal rule. New conversations are labeled fictional examples. The September 16 Zillow Home Loans FAQ review informs the financing definitions; lenders must confirm inquiries, conditions and timing for the individual buyer.

## Regeneration

Run from the repository root:

```sh
node scripts/build-training-quadrants.mjs
node scripts/build-rep-guides.mjs
node scripts/build-training-review.mjs --portable-dir=/path/to/review-package
node scripts/build-training-review-index.mjs
python scripts/build-rep-guide-pdfs.py
```

PDF generation needs ReportLab and Beautiful Soup. The Day 2 and Day 3 original generators also apply the quadrant revision before saving. The quadrant revision is idempotent; do not manually edit generated decks.

## Validation and release

- Web: 594 tests; TypeScript and production build checked.
- Worker: TypeScript checked; 954 tests passed. Two existing failures in `liveSessionsDb.test.ts` reproduce on unchanged `origin/main`: the solo-test migration's source-string guard and its dependent test. No database code or migration is changed here.
- Operations: nine checks passed.
- Browser: all 135 portable slides inspected for missing images and footer overlap; Day 3 live submission, presenter receipt and answer reveal exercised against local fixture handlers; Day 1 simulated stage save and record check passed.
- Generated references rendered for visual review.

Release requires the normal worker-first, web-second process because the worker bundles the shared curriculum. Previewing only the web build does not replace the live worker's catalog. No production data or schema changes are required. Existing live sessions should be left intact; create new sessions for this edition.

## Standing presentation standard — Eric's review

Every section must announce the topic change and show the same discuss → learn → practice flow (Day One: demonstrate → practice → review). Exercises must serve their section; relocate, rewrite or remove a mismatched prompt rather than preserving it to fill a slide. Plain English remains required. Preserve the TRU palette and original imagery, use content-appropriate visual variety, and inspect animation and transitions in the browser. A slide must read as part of the presentation, not float on an application backdrop. Keep navigation aligned and practice-card tools out of the slide canvas until requested.

The first revision after review replaces Day Three's home-selection challenge with an applied tour-preparation exercise and turns slide 14's question bank into a sequenced conversation example. The review renderer now preserves photo themes, uses a full-width canvas and distinctive section dividers, and puts practice writing in an optional disclosure. Optimized JPEG exports preserve the original source imagery; generate them with `python scripts/build-review-artwork.py`. Do not embed large image values in CSS custom properties: browser size limits can silently discard them. The same section and conversation layouts are included in Rep/live styles.
