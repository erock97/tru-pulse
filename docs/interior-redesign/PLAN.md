# Interior redesign — plan

Reviewed against the brief and against its own "generic tells" list. One
real decision below needs Eric before anything gets built.

## The palette — decided

Confirmed with Eric: the app interior moves to the cool blue-violet
"spatial glass" palette, deliberately mirroring the Vision Pro material
language, per brief section 3. This is a conscious split from the
marketing site's warm amber-forest system, not an accident — the product
now reads as a cooler, quieter instrument next to a warmer front door.
The marketing site (truhq.co) is unaffected and keeps its current amber
system unless told otherwise.

This supersedes the "do not drift the palette" warning that lives in
`truHqDark.css` today — that comment protected the *previous* decision.
When the token file lands for real, that comment gets rewritten to
explain the new decision instead of contradicting it.

Target values (from the brief, sanity-checked against WCAG AA — final
hex to be confirmed against real screens, not just swatches):

- Canvas: `#0A0B0F`, faint blue-violet cast
- Surfaces: white at 4% / 7% / 11% opacity over canvas (resting / raised / floating)
- Glass fill: `rgba(28,30,38,0.55)`, `blur(24px) saturate(160%)`
- Text: `#F5F6F8` primary (never pure white), stepped down at 62% / 38%
- Accent: `#CFE3FF` — a light, not a color, used on ≤5% of any screen
- Status: positive `#7FD6A5`, warning `#F2C97D`, critical `#F08A8A` — desaturated, status-only, never chrome

## Type

Keep what's there: Fraunces (serif, headlines) + Hanken Grotesk (body).
This already reads as considered, not generic — the brief's own worry
("one family, Inter or Geist") is aimed at apps that currently use
default system fonts. This one doesn't.
Add: `font-variant-numeric: tabular-nums` everywhere a number sits next to
another number (already partly true in the roster table, make it a rule,
not an accident).

## Layout — the shell (ASCII, current vs. proposed)

Current: sidebar is flush to the viewport edge, flat fill, no separation
from the canvas behind it.

```
┌────────────────────────────────────────────┐
│ TRU HQ                    [ TRU HQ  7d 30d 90d 12mo  Search ⌘K ] │
│ Pulse                                                            │
│ Coach                          content                           │
│ Rep                                                               │
│ Team                                                              │
│                                                                    │
│ [ org card ]                                                      │
└────────────────────────────────────────────────────────────────┘
```

Proposed: sidebar inset 12px from the edge, floating on its own glass
surface with a lit top edge (same fix as the marketing cards), radius
bumped to match the panel scale. Command bar unchanged in position —
it's already right — but gets the same real elevation.

```
 ┌──────────┐  ┌──────────────────────────────────────────────┐
 │ TRU HQ   │  │      [ TRU HQ  7d 30d 90d 12mo  Search ⌘K ]   │
 │          │  │                                                │
 │ Pulse    │  │                content                         │
 │ Coach    │  │                                                │
 │ Rep      │  │                                                │
 │ Team     │  │                                                │
 │          │  └──────────────────────────────────────────────┘
 │ [org]    │
 └──────────┘
```

## Motion

The token file already has `--ease` and `--spring` defined and named —
they're just under-used. Plan: one orchestrated moment per screen
(dashboard first load = the numbers count up, not fade in), shared-element
transition from a roster row into the (currently broken) agent detail
page once that's fixed, everything else stays quick and undecorated —
120–260ms, no scroll-triggered reveals inside the app (that's a marketing
device, the product should feel instant, not cinematic).

## What ships in the token file (see tokens-proposal.css)

- New elevation tokens (`--elev-1/2/3`) — blur + a *lit* shadow, not a
  black one, same fix as the marketing cards.
- A real glass tier (`--glass-fill`, `--glass-edge`) for the sidebar,
  command bar, popovers, and sheets specifically — not for data tables,
  which stay solid for legibility, matching the brief's own rule.
- Nothing in the existing amber/green/text tokens changes. Nothing that
  already works gets touched.

## Self-check against the brief's "generic tells" list

- Identical cards with grey shadow — no, cards already differ by content
  weight and the new shadow is warm, not grey.
- Gradient buttons/text — no, one flat accent already.
- ALL-CAPS eyebrows — **present**, on the smallest label tier only. Your
  call: I'd leave it, it's consistent and not the thing that reads as
  generic here, but say the word and it's a one-file change.
- Fade-up-on-scroll everywhere — not present in the product (that's a
  marketing-site device, not used here).
- Emoji, illustrations, confetti — none found.
- Pure black, neon — no, already warm and desaturated.

## What I'm not touching without a separate go-ahead

- The `#/coach/<uuid>` deep-link bug — real, but it's a routing fix, not
  a design change, and shouldn't ride in the same PR as visual work.
- Tailwind — still undecided; the token system works fine as plain CSS
  custom properties either way, so it's not blocking this plan.
- Any icon library swap — needs its own pass first to see what's actually
  inconsistent before picking a replacement.
