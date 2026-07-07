# TRU Pulse — Metric Definitions (Section 1: Conversion & Total Leads)

**Status:** Block 1 of `pulse-accuracy-section1-plan.md`. This is the single source of truth every later block (read layer, UI, capture, backfill, audit) builds against. Last updated 2026-07-07.

**Scope:** per-team accuracy of **total lead count**, **offer / under-contract / closed counts**, and **conversion**. All numbers are **org- and team-scoped** (RLS `is_org_member(org_id)`); never cross-team.

---

## 1. Tracked leads (the universe)

A lead is in-scope iff its FUB `source` maps to a tracked paid-source family (`sourceFamily()` in `shared/flags.ts` — Zillow, Realtor.com, Realtor.com MVIP, Homes.com, Facebook, Google, Referrals). Untracked sources are excluded everywhere.

---

## 2. Total lead count (the denominator) — windowed by CREATED date

`totalLeads(team, window)` = count of tracked leads whose **FUB created date** (`leads.fub_created`) falls in the selected window.

- Baseline field: `fub_created` (FUB's "Date created"). This is Eric's baseline — "pull from there."
- Windows: `7 / 14 / MTD / 90 / 180 / 365` (12mo tab added this section).

**Item A — missing `fub_created`: RULED (exclude, denominator-only).** A lead with no created date is **excluded from windowed totals** (can't be placed in a window; near-zero real impact, makes "total in window" literally true). Replaces the current `Dashboard.tsx:118-120` behavior of showing dateless leads in every window.

> **⚠️ CRITICAL SCOPE — this exclusion is DENOMINATOR-ONLY (Eric, 2026-07-07).** The created-date window (and the dateless exclusion) gate **§2 total leads ONLY**. They **never** gate the §3 numerators. A lead **created outside the window — even outside all windows, or with no created date at all — that reaches Under Contract/Closed today STILL COUNTS** in today's offer/UC/closed numbers, because the numerator is driven purely by achievement date (`person_stage_log.changed_at`). Concretely: a lead created 18 months ago that goes UC today is **not** in the 12mo total-leads denominator, **but is** in today's closings. This asymmetry is the entire point of tracking two dates — do not "helpfully" filter the numerator by created date.

**Open item B — does the source filter change the denominator?** Settings lets a leader enable only the sources they pay for (`enabledSources`).
→ **Proposed:** the source filter **does** change the denominator (total = enabled tracked sources in window). Rationale: a leader who only pays for Zillow + Facebook wants "my leads," not phantom sources. The all-source view is the default when no filter is set. *Confirm.*

---

## 3. Offer / Under Contract / Closed (the numerators) — windowed by ACHIEVEMENT date

Sourced from **`person_stage_log`** (the dated carry-forward table), **not** the lead's current stage. One permanent dated hit per (lead, stage) the first time it's reached; never removed if a deal later falls through.

- **Windowed by `changed_at`** (when the achievement happened), **fully independent of when the lead was created** — the lead's created date (or its absence) is irrelevant here. A lead created before the window, outside all windows, or with no created date at all counts the moment its achievement lands in the window. *(Ruled by Eric: 90–120 day close cycle means a created-cohort numerator would read ~0% on recent windows.)*
- **Carry-forward / offer-or-beyond rule (critical):**
  - **Offers reached** = distinct leads with any hit of class **offer OR uc OR closed**. A lead that jumped **straight to Under Contract** (skipping offer) still counts — it must **never** show a 0% / 1:0 offer rate.
  - **Closings** = distinct leads with any hit of class **uc OR closed** (Eric's rule: UC == Closed).
- **Seed rows excluded:** hits with `date_source='seed'` are dateless (pre-history) and are **excluded from windowed numerators**. See §5.

---

### 3a. Offer rate — stable `1 : N`, NOT a windowed % (RULED 2026-07-07)

The **team-headline** offer figure is a **stable all-time `1 : N`** ("1 in N leads reaches an offer"), computed the same way as conversion (§4) — NOT the windowed `offersReached ÷ totalLeads` %, which mixes an achievement-windowed numerator with a created-windowed denominator and whipsaws on short windows (the same flaw §4 fixes for conversion). Offer numerator stays offer-or-beyond (a direct-to-UC lead counts). The raw **`offersReached` count remains windowed** and continues to move with the tab everywhere it's shown — only the headline *rate* goes stable.

### 3b. Agent-level windowed tracking + trend arrows (RULED 2026-07-07)

Stable ratios are the team headline; **the agent level is the trend surface.** Per agent, show the **windowed counts** — `offersReached` and `underContractOrClosed` for the selected window (from `computeWindowedMetrics().byAgent`) — which re-window on every tab change. Additionally show a **▲/▼ delta vs the prior equal-length period** (e.g. this 30d vs the previous 30d; for MTD, vs the prior calendar month's equivalent day range) so upward/downward trends read at a glance. This is core to Section 1 (Eric: "super important to track upward and downward trends on the agent level"). **Rule of thumb: RATIOS are stable/all-time; COUNTS are always windowed** — at both team and agent level.

## 4. Conversion — a stable `1 : N` closings-to-leads RATIO

Displayed as **`1 : N`** (e.g. `1 : 20`, `1 : 50`), **not a percentage** — it reads the way brokers think.

- `N = round( leadBase / closings )`, i.e. "one closing per N leads."
- Computed on a **stable baseline**, NOT the selected window, so the ratio doesn't whipsaw with monthly intake volume (heavy-intake months would otherwise make conversion look worse even as closings rise).
- Reuses the existing `perClosing` value (`Dashboard.tsx:268`, rendered `1 : N` at line 466); repoint its closings at `person_stage_log`.
- The windowed raw counts (§2, §3) still move with the tab; only this ratio holds steady.
- **Source filter scopes the baseline too (RULED 2026-07-07):** when a leader has enabled only certain sources, the all-time `1:N` conversion narrows to those sources — "my conversion" reflects only the sources I pay for, consistent with ruling B. Block 3 passes `enabledSources` into `computeAllTimeConversion`.

**Open item C — the baseline:**
- **(rec) All-time:** all tracked leads ever ÷ all closings ever. Most stable; the team's true long-run conversion. Simple, never noisy.
- **Trailing 12 months:** tracks a team that's actively improving, drops stale old data — but needs the §5 backfill to be trustworthy and moves a little.
→ **Proposed: all-time** for launch (maximally stable, no backfill dependency); revisit trailing-12mo in a later section once history is dated. *Confirm.*

---

## 5. Historical accuracy & the seed caveat

On a team's first sync, older leads' offer/UC hits are recorded **dateless** (`date_source='seed'`) because FUB exposes no stage history — we can't know *when* they were reached. Closings with a real `dealCloseDate` get the true date; everything else pre-log is seed.

Consequence: **windowed numerators under-report history** before live capture began — a 90d/180d/365d offer or closing count only includes hits we caught live (or dated from deal close dates). Block 5 backfills real dates where a source exists (deal dates, one-time Tableau/export import → `date_source='tableau'`); the rest stay honestly dateless.

**Section 1 stance (proposed):** ship with the all-time `1:N` conversion (which *can* use dateless seed closings for its baseline, since it's not windowed) and windowed counts that are honest-but-partial for pre-log history, with a visible "history filling in" note per team until Block 5 lands. *Confirm, or hold Section 1 for the backfill.*

---

## Rulings locked (2026-07-07) — ALL CONFIRMED
1. Numerator windows by **achievement date** (`changed_at`); denominator by **created** date.
2. Carry-forward: offer numerator counts **offer-or-beyond**; a direct-to-UC lead is credited (never 0%).
3. Conversion shown as a stable **`1 : N`** ratio, not a %.
4. **12-month** tab added to the window set.
5. **A** — dateless leads **excluded from windowed totals**, but the exclusion / created-date window is **denominator-only**; a lead outside the window (or dateless) that achieves today still counts in the numerator.
6. **B** — source filter **changes the denominator** (total = enabled tracked sources in window).
7. **C** — conversion baseline = **all-time**.
8. **Seed** — **ship Section 1** with the documented partial-history caveat; Block 5 backfills history later.

Block 1 complete. All definitions are locked; Blocks 2–6 build against this doc.
