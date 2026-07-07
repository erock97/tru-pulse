# TRU Pulse Accuracy — Section 1: Conversion Rates & Total Lead Count (per team)

**Goal (Eric's framing):** Make **conversion rate** and **total lead count** accurate *per team*, using **"Date created" as the baseline** for the lead denominator, and drive **Offer Rate / Under Contract / Closed** off the dated **`person_stage_log`** so an achievement **carries with the agent** (even a direct jump to Under Contract must never show a 0% offer rate) and **stays accurate to the date filters**.

**Repo:** `C:\Users\ericg\Desktop\truhq\pulse` · deploy = `git push origin main` (Cloudflare Pages rebuilds whole app) + `cd worker && npx wrangler deploy` + manual `db/*.sql` in Supabase SQL editor (project `yeyoteredgunhvhqmais`).

**Key files:**
- `web/src/pages/Dashboard.tsx` — all metric math lives here today (lines ~111–274).
- `worker/src/sync.ts` — `syncTeam` pulls people/deals, accrues `person_stage_log` (lines ~112–140).
- `db/hq_stage_log.sql` — the dated carry-forward table (offer/uc/closed hits, `changed_at`, `date_source`).
- `shared/flags.ts` — `stageClass`, `isOfferPlus`, `isClosing` (UC == Closed per Eric's rule).
- `worker/src/index.ts` — router; `/webhook/fub` (live re-sync), `/admin/probe-events` (stage-log diagnostics).

> One block at a time. Work the block, then **STOP** and let Eric confirm the numbers are right before spending tokens on the next.

---

## Block 1: Lock the definitions & resolve the windowing decision

**Model:** Opus
**Why:** Before any code, three choices decide whether every downstream number is "right" — and two are genuine judgment calls only Eric can rule on, not defaults. Getting this wrong means re-running every later block.
**Scope:** Produce a one-page `docs/accuracy-definitions.md` that pins, per team:
- **Denominator (total leads):** leads whose **FUB created date** falls in the selected window AND whose `source_family` is a tracked paid source. Decide the two quirks in `Dashboard.tsx:118-120`: (a) should leads with a **missing `fub_created`** still appear in every window, or be excluded from windowed counts? (b) should the **source filter** change the denominator, or should "total leads" always be all tracked sources with the filter only affecting the breakdown?
- **Numerator windowing — RULED BY ERIC (locked):** a closing/offer counts because the **achievement happened** (`person_stage_log.changed_at`) in the window, **NOT** because the lead was created in it. Rationale: avg time-to-close is 90–120 days and agents take 10+ new connections/month, so a created-cohort numerator would make every recent window read ~0% (recent leads physically can't have closed). Denominator (total leads) stays windowed by **created** date.
- **Conversion display — RULED BY ERIC (locked):** conversion is shown as a **closings-to-leads RATIO `1 : N`** (e.g. `1 : 20`, `1 : 50`), NOT a percentage — it resonates with brokers. Computed on a **stable baseline** (all-time, or trailing 12mo — pick one in this block; leaning all-time for stability) so it doesn't whipsaw with monthly intake volume. This is the existing `perClosing` value (`Dashboard.tsx:268`, rendered `1 : N` at line 466) — elevate it to *the* headline conversion metric, repoint its closings at the carry-forward `person_stage_log`, and confirm its denominator/baseline. The windowed raw counts (total leads, offers, UC/closed) still move with the selected tab; only the `1:N` ratio holds steady. **Decide here:** baseline = all-time vs trailing 12mo.
- **Carry-forward rule:** Offer Rate numerator = count of leads with **any** `person_stage_log` hit of class **offer OR uc OR closed** (offer-or-beyond) — so a direct-to-UC lead is credited and never reads 0%. Closings = hits of class **uc OR closed**. Write this down as the single source of truth both the read layer and UI will use.
- **Seed/historical stance:** state plainly that pre-log history is dateless (`date_source='seed'`) and therefore under-reports windowed history until Block 5 backfills it; confirm whether Section 1 ships with that caveat or waits on the backfill.

Deliverable is decisions only (no code) — it becomes the contract the Sonnet blocks build against.

> **Already ruled (2026-07-07):** (1) numerator windows by **achievement date** (`changed_at`), denominator by **created** date; (2) conversion shown as a stable **`1 : N` closings-to-leads ratio**, not a %; (3) add a **12-month tab**. Block 1 now only needs to close the smaller items: missing-`fub_created` handling, source-filter effect on the denominator, the conversion baseline (all-time vs trailing 12mo), and the seed caveat.

---
🛑 STOP HERE — Eric confirms the remaining items (missing-date handling, conversion baseline, seed caveat) before continuing to Block 2.
---

## Block 2: Server read layer — per-team metrics off `leads` + `person_stage_log`

**Model:** Sonnet
**Why:** Clear, scoped implementation once Block 1 fixes the definitions — join two known tables into a windowed per-team payload. Known approach, no open design questions.
**Scope:** Add a metrics read path (new endpoint in `worker/src/index.ts`, e.g. `GET /metrics?team=&win=`, or extend the existing dashboard load) that returns, **per team**, computed to the Block 1 definitions:
- `totalLeads` (created-date windowed, tracked sources),
- `offerReached` (distinct `fub_person_id` with an offer-or-beyond hit, windowed per the ruling),
- `underContractOrClosed` count,
- `leadsPerClosing` → the **`1 : N` conversion ratio** on the stable baseline chosen in Block 1 (closings from `person_stage_log`),
- the same rollups **broken out by agent** (join `person_stage_log.agent_user_id` / `agent_name`).
Use `person_stage_log` for offer/UC/closed (dated, carry-forward), `leads.fub_created` for the denominator. Exclude `date_source='seed'` rows from windowed numerators (they're dateless) per Block 1. Keep it additive and RLS-safe (org-scoped, mirror existing endpoints).

---
🛑 STOP HERE — verify the endpoint returns correct per-team + per-agent numbers against a known team (spot-check Offer Rate, closings, total) before wiring the UI.
---

## Block 3: Wire Dashboard to the log-backed, windowed numbers

**Model:** Sonnet
**Why:** Mechanical swap of a known set of computed values in one file — replace current-stage snapshots with the Block 2 results. Scoped and low-ambiguity.
**Scope:** In `web/src/pages/Dashboard.tsx`, replace the current-stage / all-time metric math with the Block 2 values:
- `offerRate` (lines 262–264) → offer-or-beyond from the log, so direct-to-UC never shows 0%.
- `closingsCount` / `closingsByAgent` (lines 265–273) → from the log, **windowed by `changed_at`** for the count cards.
- `perClosing` (line 268, rendered `1 : N` at 466) → the **headline conversion ratio** on the stable baseline (all-time or trailing 12mo per Block 1); closings sourced from the log. This is the number brokers read.
- `convOf` / `convPct` per-source (147–151, 200–202) → express per-source conversion as the same `1 : N` ratio on the stable baseline, not a whipsawing %.
- Ensure the date-window selector (`WINDOWS`, line 29) drives all of these together so nothing reads all-time by accident.
- **Add a 12-month lookback tab** (Eric, 2026-07-07): extend `Win` (line 28) with `'365'` and add `['365', '12mo']` to `WINDOWS` (line 29), alongside the existing 7d/14d/MTD/90d/6mo. Given the 90–120 day close cycle, 12 months is the most useful window for a real conversion read — the metrics from Block 2 must accept and correctly window it (both the created-date denominator and the `changed_at` numerator). Confirm `winDays` math (line 132) handles `'365'`.
Keep the `?demo=1` preview working. Typecheck + `npm run build` green.

---
🛑 STOP HERE — Eric eyeballs the live dashboard numbers per team and confirms conversion + total + offer rate read correctly and move with the date filter.
---

## Block 4: Harden going-forward capture (webhook + sync)

**Model:** Sonnet
**Why:** Verification-and-patch against a known mechanism — confirm the existing webhook/sync accrues dated hits correctly, fix any gap. Bounded scope.
**Scope:** Ensure the "going forward" path stays accurate:
- Confirm `peopleStageUpdated` (and create/update) is registered (`FUB_WEBHOOK_EVENTS`, `fub.ts:140`) and that `/webhook/fub` (`index.ts:230`) re-syncs the affected people so a stage change accrues its `person_stage_log` hit promptly.
- Verify a **direct jump to Under Contract** accrues a `uc` hit dated `live` (not seed) and is therefore counted as offer-or-beyond by the Block 2 read — the carry-forward guarantee, end-to-end.
- Confirm the hit is stamped to the correct agent (`agent_user_id`) and dated `changed_at` at detection so it lands in the right window.
- Add a lightweight assertion/log (or extend `/admin/probe-events`) so Eric can see live hits landing.

---
🛑 STOP HERE — confirm a real (or simulated) stage change lands a correctly-dated, correctly-attributed hit before backfilling history.
---

## Block 5: Backfill historical dates so windows aren't under-reported

**Model:** Sonnet
**Why:** Data migration with a known target shape — replace dateless `seed` hits with best-available real dates. Scoped, no architectural decisions (those were made in Block 1).
**Scope:** Improve historical accuracy for windows that predate live capture:
- Closings already take `dealCloseDate` when present (`sync.ts:121`); extend best-available dating to offer/UC where a source exists (deal `projected_close`/`createdAt`, or a one-time Tableau/export import → `date_source='tableau'`, already an allowed value in `hq_stage_log.sql:29`).
- Where no real date exists, keep it `seed`/dateless and ensure it's excluded from windowed numerators (so history is honest, not inflated).
- Document in `docs/accuracy-definitions.md` exactly which historical windows are trustworthy vs. seed-limited, per team.

---
🛑 STOP HERE — Eric confirms historical windows now read sensibly (or accepts the documented seed caveat) before the final audit.
---

## Block 6: Audit pass — correctness before Eric relies on the numbers

**Model:** Opus
**Why:** This is the auditor role — read back across Blocks 2–5 and check the whole chain (definition → read layer → UI → capture → backfill) actually holds together and produces numbers a broker can trust. Not doing the work, checking it.
**Scope:** End-to-end review:
- Re-derive Offer Rate / conversion / total by hand for one real team and reconcile against what the dashboard shows.
- Confirm the carry-forward invariant holds in every path (direct-to-UC, stage-by-stage, deal-fell-through-then-reverted).
- Confirm denominator vs numerator windowing matches Block 1's ruling everywhere (no lingering all-time reads).
- Check per-team isolation (no cross-team bleed via RLS) and per-agent attribution.
- Produce a short pass/fail report with any residual discrepancies and whether Section 1 is safe to rely on.

---
🛑 END OF SECTION 1 — hand the audit report to Eric; Section 2 begins only after this passes.
---
