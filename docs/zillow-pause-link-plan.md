# Plan: "Pause in Zillow" link in the agent drill pause control

**Goal:** In TRU Pulse, when a leader opens an agent's drill dropdown and toggles
**Pause this agent** on, show a link next to the Reason dropdown that jumps them
straight to Zillow's lead-routing page. The link is `https://premieragent.zillow.com/leads/routing/routing`
— a general URL that lands the *logged-in* team leader on their own routing screen,
where they can actually pause that agent inside Zillow. Pulse's toggle stays what it
already is: a leader's own tracking marker (who's paused / why), not a real pause.

**Key context (already grounded in the code):**
- The pause control lives in the `PauseControl` component — `web/src/pages/Dashboard.tsx`
  (~lines 1095–1124). The Reason `<select>` renders inside the `{checked && (...)}`
  block, right after `<span className="ps-pausectl-reasonlbl">Reason</span>`.
- **This exact link already exists elsewhere in the same file** — the Accountability
  panel, `Dashboard.tsx:1324`, renders:
  `<a className="ps-abtn sm" href="https://premieragent.zillow.com/leads/routing/routing" target="_blank" rel="noopener noreferrer" title="Open Zillow lead routing to pause this agent">Pause in Zillow ↗</a>`
  Reuse this verbatim for consistency (same URL, class, label, new-tab behavior, `rel`).
- Label recommendation: **"Pause in Zillow ↗"** — matches the existing pattern so the
  UI reads consistently. (You floated "Link to Zillow" — I'd stay with the in-repo
  wording unless you feel strongly.)

---

## Block 1: Add the Zillow link next to the Reason dropdown

**Model:** Sonnet
**Why:** Trivial, fully-specified UI addition that mirrors an existing anchor already
in the same file — clear scope, known approach, no judgment calls.
**Scope:**
- In `web/src/pages/Dashboard.tsx`, inside `PauseControl`'s `{checked && (...)}` block,
  add the Zillow anchor immediately after the Reason `<select>` (after line ~1113, and
  before the `{r === 'other' && (...)}` note input). Copy the exact anchor from
  `Dashboard.tsx:1324`:
  `<a className="ps-abtn sm" href="https://premieragent.zillow.com/leads/routing/routing" target="_blank" rel="noopener noreferrer" title="Open Zillow lead routing to pause this agent">Pause in Zillow ↗</a>`
- No new CSS needed — `ps-abtn sm` is already defined and used. If spacing looks tight
  next to the select, add a small left margin inline; don't invent new classes.
- No data-model, worker, or SQL changes — this is view-only. The Pulse pause toggle and
  reason code keep working exactly as they do now.
- Verify locally: open an agent drill, toggle **Pause this agent** on, confirm the link
  appears next to Reason and opens `.../leads/routing/routing` in a new tab.

---
🛑 STOP HERE — confirm the link renders and opens correctly before shipping.
---

## Deploy (after Block 1 is confirmed)

Standard TRU Pulse deploy — Direct-Upload the `tru-pulse-app` project via
`wrangler ... --use-system-ca` (per your deploy notes). No DB migration required.

---

**On an Opus review block:** deliberately omitted. This is a one-line, view-only change
that copies a pattern already living in the same file — there's nothing to audit for
correctness that a local visual check won't catch. Adding an Opus pass here would be
exactly the reflexive over-tagging to avoid.
