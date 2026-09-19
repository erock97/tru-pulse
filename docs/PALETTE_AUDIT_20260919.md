# TrueHQ retired-palette audit

September 19, 2026. Reference supplied by Eric: https://truhq.co/.

## Approved reference

The live homepage uses charcoal `#171D22`, ivory `#F2F0E9`, stone `#D6D2C7`, pale blue `#B9D1FD`, and border `#C9C9BE` in `https://truhq.co/cinema.css`. Headings use Manrope; body text uses DM Sans. Amber, brown/gold, and forest-green/gold are retired. Warm colors in photographs are not UI palette defects.

## Confirmed on live pages

| Surface | Evidence | Source / correction point |
|---|---|---|
| Public booking, including Assessment URL | Old production page uses the old cream/brown/gold style. First PR preview incorrectly used forest/amber. | `web/public/book/index.html`; corrected in current PR preview to the homepage palette. Production remains unchanged. |
| [Services](https://truhq.co/services/) | Logo, section labels, emphasized headings and numbers render amber `rgb(242,178,60)`. | `site/PublicSite.tsx` imports `Landing.css`, then `forest.css` and `forge.css`. |
| [About](https://truhq.co/about), [Apply](https://truhq.co/apply), [Work](https://truhq.co/work) | Shared logo and section labels render the same amber. | Same shared public shell and token sources. |
| [Privacy](https://truhq.co/privacy), [Terms](https://truhq.co/terms), [Refund policy](https://truhq.co/refund-policy), [SMS terms](https://truhq.co/sms-terms) | Shared logo and page labels render the same amber. | Same shared public shell. |
| Public 404 page | Missing workshop paths on the marketing domain render the old amber 404 shell. | `site/pages/NotFound.tsx` and shared public styles. |
| [Admin calendar](https://app.truhq.co/#/admin/calendar) | Logo `#C99A3F`; ON/Create buttons `#87671E`; active Calendar navigation `#EDCD83`. | `styles.css`, `premiumInterior.css`, inherited `truHqDark.css`. |
| App loading state | Login-route transition displayed a spinner with `#A9791F`. | Shared global gold tokens. Authenticated session means this was not a full signed-out login-page audit. |

The homepage is a separate deployed presentation using `cinema.css`; the supporting React pages still use the legacy palette. Changing only the homepage did not migrate the rest of the site.

## Additional source-confirmed locations

These are code-level findings, not claims that every component was rendered live. CSS overrides, hidden states and role-dependent screens require a visual check during remediation.

- **App-wide:** `premiumInterior.css` (primary buttons, selected navigation, impersonation context, targets, admin actions), `styles.css` (gold tokens, links, logos, spinner), `truHqDark.css` (forest base and amber accents).
- **Public marketing:** `Landing.css`, `site/forest.css`, `site/forge.css`, `site/components/serviceWalkthrough.css`; the common navigation, headings, CTA, and footer inherit these.
- **Agent learning:** `pages/liveSessions.css`, `pages/AgentCourse.tsx`, `workshops/workshop.css`, `workshops/practiceRecord.css`. Workshop `.slide.tru` even sets a token named `--blue` to gold `#8B733F`.
- **Training review artifacts:** `public/workshops/review-design.css` and embedded copies in `day1-review.html` through `day4-review.html` contain tan/gold covers and accents. Those URLs on truhq.co returned 404, so their live deployment on another host is unverified.
- **Profile and achievement UI:** `pages/personalProfile.css`, `components/AchievementEmblem.tsx`, `components/InterestPin.tsx`. Some colors describe literal award metals rather than the global theme; flag for an explicit design decision, not automatic recoloring.
- **Coach, assessments and data views:** `pages/Coach.tsx`, `pages/assess.css`, `pages/RecordMap.tsx`, `pages/DealSlide.tsx`, `pages/DeckPreview.tsx`, `components/hqUi.tsx`, `components/viz.tsx`, `components/CoachBrief.tsx`, `lib/assessmentData.ts`, `lib/coachData.ts`.
- **Smaller controls:** `components/coachingAssignments.css`, `contactSpeed.css`, `nameEditor.css`, `periodSelect.css`, `pipeline.css`, `pages/pauseRecommendation.css`, `pages/smsConsent.css`, `pages/Login.tsx`, `components/AdminIntake.tsx`, `pages/AdminFailureLogs.tsx`. Some hits are semantic caution/error colors and must be reviewed separately from brand accents.
- **Other assets:** `public/field.svg` has warm illustration fills; `web/mockup.html` is an old mockup, not evidence of a live route.
- **Adjacent generated communications:** `worker/src/brief.ts` and `worker/src/invite.ts` reference gold. These are outside the website audit's rendered-page proof and should be reviewed if brand consistency extends to emails/reports.

## Misleading guidance

`DESIGN_HANDOFF.md` previously declared restrained gold to be current. It is corrected in this PR. Historical `docs/PRELAUNCH_AUDIT.md`, `docs/DAY2_LIVE_REBUILD.md`, and `docs/REP_LIVE_TRAINING.md`, plus comments in `forest.css` and `truHqDark.css`, still describe superseded palettes. Their historical statements must not override the current handoff or Eric's homepage reference.

## Remediation order

1. Correct the public booking page (implemented and locally reviewed in this PR).
2. Migrate the shared public shell and its overrides; validate Services, About, Apply, Work, legal pages and 404 together.
3. Migrate the app's global and premium token layers, plus hard-coded navigation and button colors; verify admin and agent roles.
4. Review course, assessment, visualization and profile exceptions; preserve meaningful error/success distinctions.
5. Update generated training artifacts from their source styles and retire obsolete instructions.

No broad palette replacement, production deployment, meeting publication, or database change was made as part of this audit. Booking availability was restored earlier by re-enabling the existing Windows booking worker. Assessment remains a draft pending publication. Exact meeting-link routing fixes remain in PR #269.

## Source inventory

The following warm-color candidates were scanned from repository source. This is a detection inventory, not a count of confirmed UI defects. It includes semantic reds, illustrations, and award metals; it excludes embedded font data and test files. Line references identify the inspected source, before the booking correction in this turn.

| File | Candidate count | Example lines and values |
|---|---:|---|
| `web/mockup.html` | 15 | 9: `#a9791f`, 9: `#c99a3f`, 9: `#8f6416` |
| `web/public/field.svg` | 86 | 7: `#F2B23C`, 7: `#F2B23C`, 7: `#F2B23C` |
| `web/src/premiumInterior.css` | 45 | 7: `#705111`, 7: `#705111`, 7: `#c4af76` |
| `web/src/styles.css` | 27 | 2: `#a9791f`, 2: `#c99a3f`, 2: `#8f6416` |
| `web/src/truHqDark.css` | 26 | 46: `#F2B23C`, 47: `#FFDC93`, 50: `#FF6A45` |
| `web/src/components/AchievementEmblem.tsx` | 8 | 16: `#c5a165`, 16: `#fae3b0`, 16: `#88704a` |
| `web/src/components/AdminIntake.tsx` | 1 | 85: `#e0b055` |
| `web/src/components/CoachBrief.tsx` | 1 | 84: `#c89346` |
| `web/src/components/coachingAssignments.css` | 5 | 1: `#b3a56d`, 1: `#b3a56d`, 1: `#8d733d` |
| `web/src/components/contactSpeed.css` | 1 | 1: `#806224` |
| `web/src/components/hqUi.tsx` | 5 | 10: `#c9962f`, 10: `#a9791f`, 12: `#c06b4f` |
| `web/src/components/InterestPin.tsx` | 6 | 26: `#b89b64`, 26: `#f3e0b4`, 26: `#8b7045` |
| `web/src/components/nameEditor.css` | 3 | 4: `#a9926b`, 10: `#85704d`, 12: `#96703b` |
| `web/src/components/periodSelect.css` | 1 | 3: `#967649` |
| `web/src/components/pipeline.css` | 2 | 46: `#bd9177`, 59: `#b89b74` |
| `web/src/components/viz.tsx` | 4 | 137: `#F2B23C`, 138: `#D9C77E`, 139: `#E08A4A` |
| `web/src/lib/assessmentData.ts` | 3 | 91: `#EE7A3A`, 93: `#E0A340`, 103: `#D9923A` |
| `web/src/lib/coachData.ts` | 7 | 47: `#E0A34A`, 47: `#C96A46`, 100: `#FF6A45` |
| `web/src/pages/AdminFailureLogs.tsx` | 2 | 77: `#a9791f`, 92: `#a9791f` |
| `web/src/pages/AgentCourse.tsx` | 5 | 24: `#e0a340`, 24: `#d9694c`, 160: `#a9791f` |
| `web/src/pages/assess.css` | 2 | 23: `#8a7d68`, 27: `#8a7d68` |
| `web/src/pages/Coach.tsx` | 2 | 57: `#9c8659`, 64: `#9c8659` |
| `web/src/pages/DealSlide.tsx` | 2 | 193: `#D08A6A`, 218: `#867A65` |
| `web/src/pages/DeckPreview.tsx` | 1 | 28: `#e0a340` |
| `web/src/pages/Landing.css` | 5 | 10: `#E9A23B`, 10: `#F2C079`, 10: `#D2661C` |
| `web/src/pages/liveSessions.css` | 10 | 58: `#705111`, 61: `#705111`, 86: `#705111` |
| `web/src/pages/Login.tsx` | 2 | 143: `#EA4335`, 145: `#FBBC05` |
| `web/src/pages/pauseRecommendation.css` | 1 | 1: `#805321` |
| `web/src/pages/personalProfile.css` | 10 | 1: `#724632`, 1: `#724632`, 1: `#be8870` |
| `web/src/pages/RecordMap.tsx` | 4 | 26: `#8b733f`, 26: `#8b733f`, 26: `#c4af7622` |
| `web/src/pages/smsConsent.css` | 2 | 16: `#F2C079`, 105: `#F2C079` |
| `web/src/site/forest.css` | 4 | 47: `#F2B23C`, 48: `#FFDC93`, 49: `#FF6A45` |
| `web/src/site/forge.css` | 6 | 417: `#ffdb95`, 418: `#f2b23c`, 421: `#e6a52c` |
| `web/src/workshops/practiceRecord.css` | 5 | 146: `#eab863`, 147: `#f0d9ae`, 160: `#e8833a` |
| `web/src/workshops/workshop.css` | 30 | 33: `#8b733f`, 33: `#8b733f`, 35: `#705111` |
| `web/src/site/components/serviceWalkthrough.css` | 2 | 2: `#aa8744`, 2: `#d7922f` |
| `web/public/workshops/day1-review.html` | 23 | 17: `#dac5a4`, 20: `#bb9b70`, 25: `#b7986d` |
| `web/public/workshops/day2-review.html` | 23 | 17: `#dac5a4`, 20: `#bb9b70`, 25: `#b7986d` |
| `web/public/workshops/day3-review.html` | 23 | 17: `#dac5a4`, 20: `#bb9b70`, 25: `#b7986d` |
| `web/public/workshops/day4-review.html` | 23 | 17: `#dac5a4`, 20: `#bb9b70`, 25: `#b7986d` |
| `web/public/workshops/review-design.css` | 23 | 16: `#dac5a4`, 19: `#bb9b70`, 24: `#b7986d` |
