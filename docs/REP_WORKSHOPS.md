# Rep workshops

The four Zillow Preferred workshops use the visual style Eric approved for Day 4: charcoal `#171D22`, deep green `#20292C`, ivory `#F2F0E9`, sage `#E5E7DF`, and pale blue `#BDD1ED`, with Manrope and DM Sans. The house photograph comes from Eric's supplied Day 4 presentation.

Write as a coach speaking to agents. Use direct titles, realistic buyer language, specific actions, and questions the presenter can actually ask. Remove slogans, exaggerated promises, unnecessary recaps, and invented sales frameworks. Follow `SALES_DOCTRINE.md` and the supplied training material.

## Content and delivery

| Day | Workshop | Screens | Suggested room time |
| --- | --- | --- | --- |
| 1 | Welcome to Zillow Preferred | 24 | 79 minutes |
| 2 | Winning the First Conversation | 18 | 71 minutes |
| 3 | Show Like a Pro | 19 | 73 minutes |
| 4 | Zillow Home Loans | 18 | 58 minutes |

Time includes spoken practice, feedback, and retries. The short timer supports individual practice turns; use the room clock for longer rounds. All workshops have facilitator notes and printable participant worksheets. The guides suggest recall within 24 hours, another scenario in three days, and coaching on an actual example in seven days. These are not automated reminders.

The existing three modules open the new player through `Lesson`. Their IDs, quiz IDs, answer positions, grading endpoints, and stored scores stay intact. Day 4 appears as a supplemental workshop in leader Rep and agent Training; it does not add a certification requirement or write synthetic completion records. No database or worker change is part of this release.

`/#/workshop/1` through `/#/workshop/4` open presenter mode. Presenter mode allows free navigation. Learner mode requires the five Day 1 record checks before moving beyond them. Practice edits survive slide navigation during the same lesson. Leaving/reloading the lesson resets the record exercises. Written practice notes and selected answers use a separate per-day localStorage key and can be downloaded or cleared. Nothing is sent to the facilitator automatically.

## Preserve the original

The original `web/public/decks/zillow-day*.json`, their images, and the existing deck preview routes are retained. The original interactive record and deal components remain in use. The provided source HTML files were preserved separately in the authoring workspace, with SHA-256 checksums. This release overlays the current course experience; it does not erase the original presentation.

The old Day 1 hash fixture was already stale on origin/main: nine reflowed slides differed by whitespace. The fixture is updated to the unchanged origin/main assets; the assets themselves are not modified.

## Authoring another workshop

Edit `web/public/workshops/dayN.json`. Each slide has `chapter`, `title`, `lead`, `body`, `notes`, `cue`, `time`, and `theme`. Themes are `paper`, `dark`, `blue`, `sage`, and `hero`. HTML bodies are reviewed repository content, never arbitrary user HTML. The site's CSP remains unchanged: no inline scripts, external slide runtime, or iframe relaxation is needed.

Useful activities already supported by the player:

- Choices with feedback (`data-quiz`, `data-correct`, `data-feedback`). Ask the room before selecting.
- Written responses (`textarea[data-save]`) saved locally and included in notes downloads.
- Native `details` reveals for explanations after an attempt.
- Buyer case rotation and an observer scorecard. Give feedback, then repeat the missed part.
- Existing Day 1 `native: practice` and `native: deal` slides. Do not replace their server checks with a client-only passed flag.

Use a few questions, short explanations, modeled language, spoken attempts, feedback, and delayed recall. Add a new slide only when it teaches or checks something different. Keep long reference detail in the guide. Check desktop fit and mobile reflow, keyboard navigation, downloads, guide links, and native exercise gates.

Run `node scripts/build-rep-guides.mjs` after editing the JSON. Update workshop counts and timing in `web/src/workshops/types.ts`. Required checks are `npm --prefix web run typecheck`, `npm --prefix web test`, and `npm --prefix web run build`.

The player isolates its presentation styles in a shadow root. Nested exercise roots retain the actual Follow Up Boss screenshot layout and are kept mounted across slide navigation. `practiceRecord.css` contains the existing exercise rules from `styles.css`, plus local theme overrides in `WorkshopLesson`; review both if the original exercise styling changes.

Known legacy quiz wording is overlaid only when the exact old prompt matches. IDs, ordering, number of choices, and correct-choice positions are preserved. Unknown questions and custom modules continue through their existing paths.
