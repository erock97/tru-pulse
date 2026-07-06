# TRU HQ — Interior Design System

**The governing visual system for `app.truhq.co`.** Every tab block inherits this. Apply
these patterns; do not reinvent them per-screen. Source of truth for tokens/classes is
`web/src/truHqDark.css` (scoped under `.tru-dark`); self-hosted type is `truHqFonts.css`.

> Supersedes the 2026-07-02 audit-findings version of this file (preserved in git). Those
> items described the old cream Home and are resolved by the dark redesign.

---

## 0. The governing principle — drama budget

The `truhq.co` landing feels premium because it spends its **entire** drama budget on one
thing: a cinematic hero (video, huge Playfair reveal, motion). That works because a
landing has one job — a first impression.

**An app interior cannot do this.** Dashboards, tables, dense KPIs and forms are where
work happens; hero drama every screen would be exhausting and would bury the data. So the
rule that governs every downstream decision:

> **Spend drama once per screen. Everything else is restraint.**
> Each surface gets **one** anchored cinematic moment — usually the hero card or the single
> most important metric. Everywhere else, the luxury is carried quietly by **material**
> (warm-obsidian depth, grain, hairline borders), **type** (Playfair for meaning, Hanken
> for data), and **gold used as an accent, never a fill**. Restraint *is* the premium
> signal on a functional surface. When in doubt, make it quieter, not louder.

Litmus test for any interior screen: if more than one element is competing to be the
"wow," cut back until exactly one wins.

---

## 1. Color tokens

All tokens live on `.tru-dark` (never `:root`, so they can't leak into the legacy light
`styles.css`). Warm obsidian base, warm off-white ink, single gold accent family.

| Token | Value | Role |
|---|---|---|
| `--base` | `#0C0A08` | App canvas — warm obsidian (matches landing `--bg`) |
| `--panel` | `#141009` | Sidebar, insets, quiet surfaces |
| `--card` | `#1B150D` | Standard card material |
| `--card-flat` | `#14110A` | Flatter card / nested surface |
| `--border` | `rgba(243,236,224,.14)` | Hairline — warm, never grey |
| `--border-soft` | `rgba(243,236,224,.07)` | Dividers, quiet edges |
| `--text` | `#F3ECE0` | Body ink (warm off-white, never pure `#fff`) |
| `--text-60` | `#A79C8D` | Secondary / captions |
| `--text-50` | `#8A7F70` | Muted labels |
| `--text-40` | `#6A6053` | Faintest — placeholders, disabled |
| `--text-strong` | `#F8F2E8` | Headlines |
| `--accent` | `#E9A23B` | **The** gold (matches landing `--gold`) |
| `--accent-hi` | `#F2C079` | Gold highlight / gradient top |
| `--accent-soft` | `rgba(233,162,59,.15)` | Gold wash — glows, chips, active states |
| `--accent-line` | `rgba(233,162,59,.30)` | Gold hairline |
| `--ember` | `#D2661C` | CTA shadow warmth (landing `--ember`) |
| `--sea` / `--sea-hi` / `--sea-soft` | `#4a7c6f` / `#6fbfa9` / `rgba(74,124,111,.16)` | Secondary "good/compliant" accent — use sparingly (Prospect compliance, positive deltas) |
| `--risk` (add if needed) | `#E08258` | Risk/warning — matches landing `--risk` |

**Gold discipline:** gold fills only the *one* primary CTA and small accents (dots,
rings, active pills, thin left-bars). Never gold-fill a whole card or a large area — that
reads cheap. On dense data, gold marks the *one* number that matters.

**Warm theme:** the `data-theme="warm"` toggle re-skins to a cream palette. It's a
secondary mode; design dark-first, verify warm doesn't break, don't optimize for it.

---

## 2. Type

Two families, self-hosted (`truHqFonts.css`), copied from the landing.

- **Playfair Display** (`--hq-serif`) — 700 / 800 / 800-italic. **Meaning & moments:**
  page titles, hero headlines, card names, big stat numbers, section headers. This is the
  cinematic voice. Auto-applied to `.tru-dark h1,h2,h3`.
- **Hanken Grotesk** (`--hq-font`) — 400 / 500 / 600. **Everything functional:** body,
  labels, table cells, form fields, captions, buttons, dense data. Applied to `h4` and
  all text by default.

**Scale** (fluid; clamp for responsiveness):

| Role | Family | Size | Weight | Notes |
|---|---|---|---|---|
| Page title (topbar h1) | Serif | `clamp(26px,3.4vw,37px)` | 700 | e.g. "Pulse — who's working what." |
| Hero headline | Serif | `clamp(30px,4.2vw,46px)` | 800 | one per screen |
| Section header (h3) | Serif | 20–26px | 700 | "Leads by source", "The certification journey" |
| Card/tile name (h4) | **Sans** | 17–20px | 600 | stays sans for legibility on tiles |
| Big stat number | Serif | 30–48px | 800 | the anchored metric; often `--stat-grad` |
| Body | Sans | 15–16px | 400–500 | `--text` / `--text-60` |
| Eyebrow / kicker | Sans | 13–14px | 600 | uppercase, `.04em` tracking, `--accent-hi` |
| Caption / label | Sans | 12–13px | 500 | `--text-50`, often uppercase for KPI labels |

**Rule:** a number the leader is meant to *feel* is serif; a number they *scan* (table
cell, list) is sans. Letter-spacing tightens on serif (`-0.02em`), stays neutral on sans.

---

## 3. Spacing, layout & page frame

- **Base unit 4px.** Common steps: 6, 8, 12, 14, 18, 24, 30, 44.
- **Shell grid:** `268px` sidebar + fluid main (`.tru-shell`).
- **Content max-width:** the main column breathes; cards in bento/grid, `gap: 18px`.
- **Card padding:** 24–26px standard tile; `clamp(28px,3.6vw,44px)` hero.
- **Radii:** `--r-card 14px`, `--r-card-lg 16px`, `--r-btn 10px`, pill `999px`, chip `28px`.
- **Section rhythm:** ~30px topbar → content; ~18px between cards; a curved wave divider
  (`.ps-divider`, gold-soft fill) separates major bands (already used on Home/Pulse/Rep).
- **Density scales with purpose:** launcher (Home) = generous, few large tiles;
  dashboard (Pulse) = tighter, many KPI tiles; both use the same tokens.

---

## 4. Surfaces & elevation

Depth comes from **material + light**, not heavy drop shadows (dark UIs don't shadow well).

- **Card** (`.hqcard`): `--card` fill, 1px `--border-soft`, radius `--r-card`. Flat at
  rest. Hover (`.hqcard-hover`): subtle lift + `--card-hover-shadow` (deep, low-opacity
  black) + border warms to `--accent-line`. Interactive tiles get `tileProps` (role/link,
  keyboard).
- **Hero card** (`.hh-hero`, and Pulse's commission-at-risk card): `--hero-grad`
  (radial warm-ember glow off one corner + obsidian linear), 1px `--hero-border`, plus an
  inner `.hh-hero-glow` layer. This is the **one dramatic surface per screen**.
- **Ambient glow** (`.hh-ambient`): a large, very soft multi-radial (`--accent-soft` +
  ember + `--sea-soft`) behind the canvas top. One per page, low opacity — atmosphere, not
  decoration.
- **Filmic grain**: global `.tru-dark::after`, fixed, 5% opacity SVG fractal-noise,
  `pointer-events:none`. The landing's signature texture; leave it on everywhere.
- **Stat gradient text** (`--stat-grad`): warm-white→gold vertical gradient on the big
  serif numbers. Reserve for anchored metrics.

---

## 5. Motion

Ease: `--ease: cubic-bezier(.22,1,.36,1)` (the landing's `--e`). Everything uses it.

- **Reveal-on-scroll** (`.reveal` + `useReveal`): elements fade/rise in as they enter
  (IntersectionObserver, `data-delay` staggers). Default for cards/sections.
- **Count-up** (`useCountUp`): big stat numbers animate from 0 on first view (cubic
  ease-out, ~1.6s). Only the anchored metrics — not every number.
- **Ring draw-in**: SVG score rings animate `stroke-dashoffset` (1.1s). Used for
  hustle/certification/worked-% donuts.
- **Hover physics**: primary CTA lifts `translateY(-2px)` with a deepening ember shadow;
  cards lift subtly. Fast (`.18s`), never bouncy on functional surfaces.
- **Reduced motion**: `prefers-reduced-motion: reduce` must short-circuit reveals/count-ups
  to final state, pause any video, keep grain (it's static). Non-negotiable for a11y.

**Discipline:** motion *reveals and rewards*, it doesn't loop or decorate. No infinite
animations except the tiny badge-dot twinkle. If motion doesn't help comprehension or
delight on first view, cut it.

---

## 6. Shell (every tab sits in this)

`HqShell` (`components/hqShell.tsx`) is the frame — do not fork it per tab.

- **Sidebar** (`.side`): `--panel`, sticky full-height. TRU logo (wordmark, gold "RU"),
  nav links with 20px stroke icons; active link = `.active` (gold-soft fill + gold text).
  "Soon" items disabled with a `.side-soon` chip. Foot: org avatar + name + role, sign-out,
  and the impersonation "Acting as / Exit" block for platform owners.
- **Topbar** (`.topbar`): serif page title (`h1`) + `--accent-hi` uppercase eyebrow
  (`.main-eyebrow`), a right-aligned context slot, and the Dark/Warm `ThemeToggle`.
  Transparent — sits on the canvas, bottom hairline only.
- Each page renders its own `HqShell` with `eyebrow` + `title` and pipes real open-callbacks
  through `nav` (hash routing untouched — **presentation only, never touch routing/data**).

---

## 7. Per-surface direction (drama budget applied)

| Surface | Route | Drama moment | Restraint zone |
|---|---|---|---|
| **Home** (launcher) | `/` | The hero anchor tile ("Your TRU HQ") + the bento composition itself | Product tiles: quiet, one mini-viz each (spark/ring/progress/shield) |
| **Pulse** (dashboard) | `/pulse` | The commission-at-risk hero card + the worked-% donut | KPI tiles, source bars, tables stay flat/scannable; gold marks only the risk number |
| **Rep** (certification) | `/rep` | The "Certify every agent" hero + certification ring | Module journey list, stat tiles, quiz rows: calm, numbered, legible |
| **Coach** | `/coach` | The agent/1:1 prep focal card | Roster + prep detail: editorial, restrained |
| **Prospect** | `/prospect` | One compliance/queue focal stat | Call-list rows are a **table** — maximum restraint, `--sea` for "cleared" only |
| **Course** (agent) | `/learn` | The lesson/module cover + progress ring | **Long-form reading**: lesson cards are editorial — serif for lesson prose is OK here, generous line-height, one idea per card. Quizzes: quiet, clear right/wrong states |
| **Auth** (Login/Onboarding/SetPassword) | — | This is the interior's *most landing-like* moment: one focused card floating on the ambient-glow + grain obsidian field, serif headline, the gold CTA. Spend drama on the background, keep the form itself dead simple. **Backdrop plan:** this is the ONE interior surface where a cinematic video backdrop belongs — first reuse the landing's existing obsidian assets (`hero-loop.mp4` / `TRU-reveal`), only reach for a generative tool (Higgsfield) if those can't deliver. Restyle only — never touch the Supabase auth/recovery/invite logic. |

Tables & forms (Prospect list, Pulse settings, onboarding) are the true test of restraint:
warm hairlines, `--panel` header row, `--text-60` labels, generous row height, focus rings
in `--accent`. No zebra stripes, no heavy borders, no gold fills.

---

## 8. Component-pattern reference

Use these existing patterns (classes/components in `truHqDark.css` + `components/hqUi.tsx`).
Each Sonnet tab block **applies**, never rebuilds.

- **Buttons** — `.hqbtn` base. `.hqbtn-primary` = gold gradient (`--accent-hi`→`--accent`),
  **dark ink** `#20140A`, inner-highlight + ember shadow, hover lift. `.hqbtn-ghost` =
  `--panel` fill + hairline, warms on hover. `.hqbtn-sm` for dense contexts. One primary
  per view.
- **Eyebrow pill** (`.hq-eyebrow` / `.main-eyebrow`) — gold dot + uppercase kicker.
- **Card** — `.hqcard` (+ `.hqcard-hover` for clickable). Hero variants get `.hh-hero` +
  glow layer.
- **Stat tile** — big serif number (optionally `--stat-grad` + `useCountUp`) over a
  sans uppercase label. Optional mini-viz corner accent.
- **Ring** (`<Ring pct label color>` in `hqUi.tsx`) — score/percentage donut, draws in,
  `--track-fill` track + gold arc.
- **Mini-viz** — gold sparkline (area+line gradient), tiny upward arc, slim progress bar
  (`.hh-progress`), compliance shield-pin (`--sea`). Keep them small and single-purpose.
- **Avatar** (`<Avatar name size tone>`) — initials on a warm gradient chip.
- **Pills** — filter/window pills (7d/MTD/90d…) and sub-tabs (Overview/Accountability/
  Sources/Settings): pill row, active = `--accent-soft` fill + gold text/line.
- **Chips** — source/tag chips: `--panel` fill, hairline, small sans bold.
- **Divider** — curved wave (`.ps-divider`, `--accent-soft` fill + `--accent-line`
  stroke) between major bands.
- **Empty state** — icon chip + serif heading + plain-language explanation + one
  `.hqbtn` next-step. Never a wall of zeros (see the resolved Pulse empty-state pattern).
- **Icons** — inline 1.8-stroke SVGs via `<Icon name>`; extend the switch, don't add a lib.

---

## 9. Guardrails (unchanged, restated)

- **Front-end only** — `web/src/**`. Never `worker/`, `db/`, RLS, or data-fetch logic.
- **Presentation only** — reskins keep every auth/routing/data call identical.
- **Preview on `?demo=1`** (Sample Realty). Never a production Supabase connection.
- **The `truhq.co` landing files are LIVE + READ-ONLY** — reference to copy from, never edit.
- Work on branch `redesign-cinematic`; the prior WIP is safe on `redesign-dark-wip-snapshot`.

---

## 10. Current state (as of this block)

Foundation **done** on `redesign-cinematic`: fonts, warm-obsidian palette, landing gold,
Playfair serif headings, CTA physics, grain — all on the shared token layer. **Home, Pulse,
Rep, Coach already render in the dark system** and inherit the foundation. Remaining
per-tab work is polish-to-bar + bringing any still-legacy surface (verify Prospect,
`/learn` course, auth screens) fully into this system, one gated block at a time.
