# Interior audit — app.truhq.co

Screenshotted live at app.truhq.co, signed in as Scott Moore Group (admin
acting-as). Screens covered: Pulse (dashboard + roster table), Coach
(cohort + weekly brief), Rep (certification), Team (roster admin), the
command bar (⌘K).

## What's already good — keep it

This is not a green-field app. It already has a real design system, not
generic defaults:

- A scoped token system (`.tru-dark` in `truHqDark.css`) — one accent
  color (amber), one radius scale, one easing curve, applied consistently.
  The comments in the file explicitly warn against drifting the palette.
- A command bar (⌘K) already exists and already does what the brief asks
  for: jump to a module, jump to a person, fuzzy search. This is the one
  "signature interaction" the brief wants built — it's built.
- A light theme already exists (`data-theme="warm"`), token-driven, not a
  separate stylesheet.
- Real editorial voice in the copy ("The floor turns one lead in 47," "21
  came from Follow Up Boss") — nothing here reads as placeholder or
  AI-generated text.
- Data tables use tabular numbers, a colored left edge for status instead
  of decorative badges, and real density. This is closer to Linear's table
  language than to a generic SaaS grid already.

## What's actually wrong

1. **Resting cards have no shadow at all.** `--card-shadow: none` — the
   stat tiles on Pulse and Coach sit completely flat until hover, so they
   don't read as surfaces, just as a slightly different fill color. This
   is the identical bug I just fixed on the marketing site (a shadow
   that's dark-on-dark and unreadable) but here it's not even attempting a
   shadow at rest, only on hover. This is the single highest-impact,
   lowest-risk fix — same shape as the marketing fix, same fix.
2. **A real routing bug.** Opening an agent from the command bar
   (`#/coach/<uuid>`) changes the URL but keeps rendering the cohort list,
   not the agent's detail page. That's not a design issue, it's a broken
   deep link — flagging it separately, not folding it into this redesign.
3. **ALL-CAPS labels everywhere** ("LEADS PER CONTRACT", "WORKED," "IN
   YOUR COHORT"). The brief's tell-list calls this generic. I'd push back
   partway: it's consistent and used only for the smallest label tier, not
   headings — it doesn't read as a template. Worth a decision, not an
   automatic fix (see plan).
4. **No icon system checked yet.** Sidebar icons render but I didn't
   audit every module for mixed icon weights — worth a real pass before
   any icon-library swap.
5. **Sticky-header collision on Pulse's roster table.** Scrolling the
   table pins a stray hover-row label on top of the command bar. Minor,
   real, worth fixing alongside the shadow work.

## One correction to the code's own comments

`truHqDark.css` says Dashboard/Rep/Prospect are "not-yet-reskinned" and
still depend on the older `styles.css` token set. That's stale — checked
directly: Dashboard, Rep, Coach, TeamAdmin, and AgentHq all already wrap
themselves in `.tru-dark`. The whole interior is already on one token
system. That simplifies the migration to the new palette (see PLAN.md) —
there's one wrapper class to introduce, not two systems to reconcile.

## What stays / what goes

| Area | Verdict |
|---|---|
| Amber-on-forest palette, one accent, token system | **Keep** — already disciplined, already the brand |
| Command bar | **Keep and extend** — already the right shape |
| Fraunces/serif headlines + Hanken Grotesk body | **Keep** — already distinct from generic sans-everywhere SaaS |
| Card/panel elevation | **Fix** — add real, visible depth (see PLAN.md) |
| ALL-CAPS micro-labels | **Eric's call** — flagged in plan |
| Coach agent deep-link | **Bug, not design** — separate fix |
