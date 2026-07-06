# Pre-launch audit — interior redesign (Block 9)

Branch: `redesign-cinematic`. Baseline (production): `main` @ `a336aa3`.
Scope shipping: Home, Pulse, Coach, Rep + trainings, agent course. Prospect **pulled**;
Studio unlaunched.

## VERDICT: 🟢 GO — as an independent Cloudflare Pages build (workarounds applied).

Original finding was 🔴 NO-GO for a *naive full merge+deploy* (it would ride backend
changes + a destructive migration along with the pixels). **Resolved** — see
`SHIP_RUNBOOK.md`:
- **Deploys are independent** (Pages / wrangler / manual SQL) — nothing rides along; the
  frontend ships alone.
- **The destructive migration is now non-destructive** (`db/hq_stage_log.sql` → `create if
  not exists`; the `drop … cascade` was removed).
- **Coach is now previewable** (demo roster) — the last consistency gap is closed.

The visual redesign is clean, presentation-only, and internally consistent. The worker and
the (now safe) migration remain separate, deliberate steps — de-risked, not blockers.

--- original findings below (retained for the record) ---

The **visual redesign itself is clean and presentation-only.** The (now-resolved) blocker
was that the branch is not a clean front-end-only delta from production — it inherits a
pre-existing feature WIP that carried backend changes and a then-destructive DB migration.

---

## Part 1 — Data protection

### ✅ 1.1 My redesign work (Blocks 2–5) is verifiably presentation-only
`git diff 438e951..worktree` (my work) touches only `web/src/**` + docs. A grep of every
`.tsx`/`.ts` I changed for `supabase|fetch(|.rpc(|auth.|.from(|service_role|access_token`
returns **nothing**. My changes are: CSS, self-hosted fonts, class names, static copy, one
static external link (Zillow routing), and a ring size. **Zero data/auth/fetch/RLS.**

### ✅ 1.2 Tenant isolation not weakened
The redesign touches no RLS, no org-scoping, no data-fetching. (The one migration present
even implements correct org-scoped RLS — `is_org_member(org_id)`.)

### 🔴 1.3 The branch carries non-presentational changes from the inherited WIP
Because `redesign-cinematic` forked from the WIP snapshot (`438e951`), the full delta
`main..worktree` includes changes that are **not** part of the redesign:
- **`worker/src/`** — 5 files, ~266 lines (sync, index, prospect, db logic).
- **`db/hq_stage_log.sql`** — a **destructive migration**: `drop table if exists
  person_stage_log cascade; create table …`. Running it **drops & recreates** the table.
  (Author intends it repopulated by sync; still data-destructive and must not run by accident.)
- **`web/src/lib/api.ts`** — 48 lines of data-layer changes (coupled to Coach/FUB features).

### 🔴 1.4 Shipping the branch wholesale fails the cutover requirement
A merge-to-`main` + full deploy would ride a **backend deploy** and a **`drop table
cascade` migration** along with the visual work — exactly the "migration / data change
riding along" the requirement forbids.

### ⚠️ 1.5 Entanglement — a clean frontend-only subset may not be separable
The redesign frontend sits *on top of* a coupled feature WIP (dark redesign + Coach +
stage-log + worker sync). The shipping features likely depend on the new worker endpoints
and table, so "ship only the visual layer" is probably not cleanly possible.

---

## Part 2 — Cross-tab consistency (vs DESIGN_HANDOFF.md)

### ✅ 2.1 Home, Pulse (all 4 sub-tabs), Rep, trainings — one coherent system
Warm-obsidian palette, Playfair-for-meaning / Hanken-for-data, gold-as-accent (never
fill), consistent shell, drama-budget respected (one hero moment per surface). The
trainings were migrated off the legacy `.ac-` styles onto the system this block.

### ✅ 2.2 Shell chrome consistent everywhere
Sidebar, gold active accent-bar, topbar eyebrow + serif title, theme toggle — identical
frame on every tab.

### ⚠️ 2.3 Coach content is UNVERIFIED
Coach has no `isDemo` path — under `?demo=1` it errors ("Couldn't load coaching data").
Its shell + error card are on-system, but the **roster/coaching content can't be audited
in the safe preview.** Needs verification in a real-data staging env before launch.

### ⚠️ 2.4 Auth screens not yet on the system
Login/Onboarding/SetPassword are deferred (the auth block). If launch includes the
logged-out entry, there's a visual seam: landing → old-styled auth → new interior.

---

## Path to GO
1. **Decide the deploy unit.** The redesign can't cleanly ship without the coupled WIP —
   so treat this as shipping the whole in-progress feature branch, and therefore:
2. **Review + test the `worker/` changes** independently (out of scope for this design audit).
3. **Run `db/hq_stage_log.sql` deliberately** — take a backup first; confirm `person_stage_log`
   holds nothing irreplaceable (author says sync-reconstructable — verify against prod).
4. **Verify tenant isolation** on any new worker endpoints the shipping features call.
5. **Verify Coach in a real-data staging env** (can't be checked in demo).
6. **Decide on auth** — ship old-styled, or do the auth block first (recommend the latter for
   a seamless landing→app handoff; reuse landing video per DESIGN_HANDOFF §7).
7. **Confirm the deploy mechanism** — is prod Cloudflare Pages building `web/` only, with the
   worker (wrangler) and migrations run separately? Ensure nothing unintended auto-runs.
8. **Commit Block 5** (currently uncommitted on the branch).

Once 2–7 are owned, the **visual layer is safe to ship** — it is clean, presentation-only,
and internally consistent.
