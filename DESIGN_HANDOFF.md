# TRU HQ — Product design handoff

## Current visual foundation

**Eric's current direction (September 19, 2026): `https://truhq.co/` is the visual source of truth.** Amber, brown-and-gold, and forest-green-and-gold themes are retired throughout TrueHQ. Do not restore them from older CSS or documentation.

The live homepage's `cinema.css` defines charcoal `#171D22`, ivory `#F2F0E9`, stone `#D6D2C7`, pale blue `#B9D1FD`, and borders `#C9C9BE`, with Manrope headings and DM Sans body text. Verify the current live reference before further visual changes. Photography may naturally contain warm tones; those are not brand-color tokens.

`premiumInterior.css`, `truHqDark.css`, `site/forest.css`, and `pages/Landing.css` still contain obsolete brand styles. Their presence is technical debt, not design authority. The app's `.tru-dark` class is a legacy component scope. Existing typography and palette instructions elsewhere are superseded where they conflict with this direction.

Edit existing relevant rules rather than appending competing themes. Preserve page behavior, founder photography, and semantic error/success clarity. The booking page is corrected in PR #269; the broader source and live-page audit is recorded in `docs/PALETTE_AUDIT_20260919.md`.

## Working screens

- Give each screen one clear primary action. Keep supporting controls quiet and evidence readable.
- Today prioritizes submitted practice awaiting leader review, follow-ups, and due check-ins. An item must open the specific work.
- Coach centers one supported finding and its evidence. Changes to coaching advice generation are deferred.
- Pulse explains the date window, population, and metric definitions. Unknown or unassessed states must not look like measured scores.
- Training uses concise lesson rows and meaningful filters. Quiz completion is not certification; simulation and leader sign-off remain distinct requirements.
- Agent pages name the actual next lesson or task and show submission, review, and check-in status.
- Practice engagement means completed practice receiving leader review; show review speed and follow-through only when their underlying data supports them.

## Shell and accessibility

`HqShell` and `AgentHqShell` are shared frames. Desktop navigation uses the slate header; phones use the fixed bottom navigation. Header content must wrap without collisions, and all main content needs bottom clearance including the device safe area. A team impersonation context appears once, with a visible return action. Keep keyboard focus visible and text readable against its actual surface; reduced-motion preferences remain respected.

## Public content and owner decisions

Home, Services, About, and Apply already state a 60-minute consultation and use `BUSINESS.bookingUrl`, targeting `client-consultation-call`. Preserve this alignment with the configured booking; `site/consultDuration.test.ts` guards it. Supporting pages already use the shared navigation identity and palette.

About contains Eric's supplied biography and existing portrait; preserve them. Eric confirmed that the existing website results are legitimate real-client outcomes and that the agreement requires client anonymity. Preserve the current results claims and anonymity. No biography changes are requested. This change adds no new customer proof story; any later supplied signal-to-practice example must remain anonymous.

## Delivery

Follow `AGENTS.md`: isolated feature branch, appropriate validation, and a reviewable pull request. For local visual review run `npm --prefix web run dev` and open the affected route with `?demo=1`. Copy the existing production environment file before a preview build as described there; never print its contents. No production deployment or live database mutation is implied by presentation work.
