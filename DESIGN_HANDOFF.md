# Design Handoff — TRU HQ (app.truhq.co)

Findings from the design lead pass, for the TRU Web Developer to implement. Ordered by priority. Each item lists the file, the problem, and the fix.

---

## Status (2026-07-02)

Items 1–3 are **fixed, but staged on an isolated branch (`ui-polish`), not yet live** — `App.tsx`/`Home.tsx`/`Rep.tsx` are actively being edited on this working tree by another session (Rep + Prospect wiring), so touching them directly here risked clobbering that in-progress work. The fix branch lives at `C:\Users\ericg\OneDrive\Desktop\TRU-Pulse-ui-polish` (git worktree, branch `ui-polish`), rebuilt against the current 4-product `PRODUCTS` list and verified with a local dev server. It needs a manual merge once the Home/Rep work on this tree settles — flag if you want that done now instead of waiting.

Item 4 is **fixed and live on this working tree** (`web/src/pages/Dashboard.tsx`, `web/src/styles.css`) — it didn't touch any actively-edited file, so it shipped directly.

---

## P0 — Broken layout

### 1. Home grid leaves an orphaned card with a gaping empty gap
**Status: ✅ Fixed — staged on `ui-polish`, pending merge.** Switched to `repeat(2,1fr)` (2×2), per your own top recommendation for a 4-product steady state. Verified: Pulse/Coach on row 1, Rep/Prospect on row 2, no orphan, no gap.

**File:** `web/src/styles.css:213`
```css
.hq-cards{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
```
There are 4 product cards (Pulse, Coach, Rep, Prospect) in a fixed 3-column grid. The 4th card (TRU Prospect) wraps to its own row and sits alone on the left, leaving a huge empty void to its right. This is the single clunkiest thing on the page — it reads like an unfinished template, not a shipped product.

**Fix (pick one):**
- Switch to `grid-template-columns:repeat(2,1fr)` for a clean 2x2 (best if we're staying at 4 products for a while — reads more deliberate/premium at this count).
- Or `grid-template-columns:repeat(auto-fit,minmax(260px,1fr))` if more products are coming soon and the grid needs to self-balance.
- Do not ship 3-column with an odd card count again — audit this any time `PRODUCTS` in `Home.tsx` changes length.

---

## P1 — Visual polish / "does this look like a real product" gaps

### 2. Zero visual identity beyond flat icon chips
**Status: ⚠️ Partially addressed — staged on `ui-polish`, pending merge.** Also gave the HQ hub the same dark `.shell`/`.side` sidebar Pulse uses (was a separate, plain light top-bar before — inconsistent shell across the suite) and replaced the flat text-only hero with a bold dark-gradient hero card (same recipe as Pulse's "Commission at risk"), plus a soft radial glow accent (same pattern as the login page's brand panel). That's the "one strong visual anchor" for the hub itself. Did **not** add per-card photography/illustration — that's a bigger asset-sourcing task, flagging as still open if you want real imagery per product.
**File:** `web/src/pages/Home.tsx:9-14`, `.hq-ico` in styles.css:218
All 4 product icons are thin-stroke line icons in a 44px rounded-square tinted chip. Functional, but it's the same pattern every AI-generated dashboard uses. There's no photography, no illustration, no texture anywhere on the hub page — just text and colored squares on cream. For a page whose whole job is "make the leader feel like they're stepping into something premium," this needs one strong visual anchor (a hero illustration, a subtle background texture/gradient behind the hero copy, or richer per-card art) instead of relying entirely on typography + flat chips.

### 3. "Act as a team" admin card visually disconnected from product cards
**Status: ✅ Fixed — staged on `ui-polish`, pending merge.** Now uses the same `.hq-card` base (radius/shadow/padding — identical box model to the product cards) plus a `.hq-card-admin` modifier: a soft gold-tinted background wash and a 4px solid gold left accent bar (same visual language as `.kpi .accent` elsewhere in the app), replacing the one-off inline `boxShadow`/`borderColor` override.
**File:** `web/src/pages/Home.tsx:117`
The admin card uses an amber-outlined white card with an inline `boxShadow` override, while the 4 product cards below use the standard `.hq-card` treatment. The two card styles sitting stacked on the same page don't feel like the same design system — the admin card looks like a warning/alert banner, not a peer content block. Give it the same visual grammar as the other cards (or intentionally re-skin it as a distinct "admin utility" component with its own consistent style used elsewhere in the app), not a one-off inline style.

### 4. Pulse dashboard's empty state is indistinguishable from "broken"
**Status: ✅ Fixed — live.** When `total === 0` for the selected window, Overview now renders a single dedicated empty state (icon chip, "No leads tracked yet" heading, plain-language explanation of how leads sync in, and a "Check your sources →" button that jumps to Settings) instead of a wall of flat zero-value KPI cards and an unguarded 0%-donut ring. Verified end-to-end including the button's navigation to Settings.
**Page:** TRU Pulse → Overview (`#/pulse`)
When a team has zero tracked data, every metric renders as a greyed-out "0" / "0%" / "—" and two major panels ("Where the leads come from", the donut chart) go nearly blank. There's no illustration, no "no leads tracked yet — here's how to add your first one" prompt, nothing that tells a new user this is expected rather than a loading/error state. First-run experience matters as much as steady-state — a client seeing this on day one will assume the product is broken.

---

## Notes for next pass
This is an initial sweep of the Home hub and Pulse Overview only. Coach, Rep, and Prospect screens have not been audited yet — will cover those next and append findings here rather than opening a new file. Flag anything you fix so it can be checked off instead of re-flagged.
