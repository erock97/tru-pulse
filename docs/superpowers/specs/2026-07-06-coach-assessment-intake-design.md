# Coach Assessment Intake — Design Spec

**Date:** 2026-07-06
**Status:** Draft for review
**Owner:** Eric
**Repo:** `truhq/pulse` (branch: `redesign-cinematic` / `main`)

---

## 1. Problem

When the standalone Coach app was merged into TRU Pulse as a native tab, the **agent-facing assessment intake was lost.** Pulse's Coach tab can *read* and *display* behavioral profiles from the `assessments` table, but nothing in the app can *create* one — no screen lets an agent take the test, and the only writer (the legacy `enroll_agent` RPC) is unwired. Result: Coach only shows profiles that already existed in the shared DB from the old site; **every newly invited agent can never be profiled.** Since behavioral profiling + 1:1 tracking is one of TRU's core pillars, this is a load-bearing gap.

## 2. Intent — what "good" means

The bar is the *16Personalities "this is me to a T"* reaction. Two audiences, two jobs:

- **Agent → felt-seen wow.** The reveal should make an agent feel accurately, almost uncannily described.
- **Team lead → diagnostic clarity.** The lead should ingest the profile and reach *"…oh, that's why that didn't work"* — plus a concrete plan for running an effective 1:1 with *this* individual.

TRU's differentiator over 16Personalities: **two profiles, not one.** 16P nails the *personal* read and treats the *professional* as an afterthought. TRU profiles **the person, then the business** — same four axes viewed through two lenses — and surfaces the **divergence** ("Heart-led in life, but runs the business Data-first"). That divergence is the coaching insight 16P cannot produce.

## 3. Two populations (core principle)

Pulse and Coach have deliberately different populations:

- **Pulse = everyone the Follow Up Boss API pulls** (e.g. all 90 agents) — full accountability/visibility. Unchanged by this work.
- **Coach = a small, lead-curated cohort** (e.g. the 8–10 agents on company-paid up-front leads) — the people the lead actually invests in with profiling + 1:1s.

**Mechanism:** one new boolean column `agents.coaching_enabled` (default `false`). Coach filters to `coaching_enabled = true`; Pulse ignores it. FUB re-sync never touches it (it is not a FUB field, and `sync.ts` patches existing rows field-by-field, so assessments, logins, and this flag all survive re-pulls — verified).

## 4. The two-part assessment

Both instruments already exist in the standalone app's `truFramework.js` and are ported (not re-authored). Same four axes, two lenses:

| Axis | Personal pole labels | Professional pole labels |
|---|---|---|
| Energy (P/T) | Outgoing / Reserved | People / Heads-down |
| Approach (Pro/Rec) | Initiator / Responder | Proactive / Attraction |
| Deal (R/V) | Deep bonds / Wide circle | Relationships / Volume |
| Decision (D/I) | Head-led / Heart-led | Data / Instinct |

- **Personal baseline** — `BASELINE_QUESTIONS`: 20 Likert statements (5/axis, mixed direction), context-free personality. `scoreBaseline` → `personal_code` + per-axis percentages → `PERSONAL_TYPES` (16 personal identities).
- **Professional** — `QUESTIONS`: 32 forced-choice (a/b, 8/axis), real-estate-contextualized. `scoreAssessment` → `code` + 8 tallies → `ARCH` (16 professional archetypes) + `LL` coaching lens + `AG`/`CG` guidance.

**Order: person first, then business.** The agent takes the personal baseline, then the professional set.

## 5. End-to-end flow

```
FUB sync → all agents land in Pulse (dormant for Coach)
   │
Lead opens Coach → "Add agents to Coach" picker (full roster) → selects the 8–10
   │   (coaching_enabled = true; they appear in Coach's "Not yet assessed" lane)
   │
Lead clicks "Copy team assessment link" → shares ONE link with the cohort
   │
Agent opens link (NO login) → picks their name from the cohort → takes the two-part test
   │
Submit → score (client-side) → write personal_code + business code/tallies to their agent row
   │      └─► appears in Coach immediately (lead has the profile even if the agent stops here)
   │
Agent prompted to register (email pre-filled) → login links to their row via claim_agent
   │
Agent sees their two-act wow reveal → Rep course now available
```

**Add-to-Coach and send-link are two steps** (add the cohort now; send the link when ready).

## 6. The team-wide gated link

- **One link per team**, built on the existing `teams.join_token` (auto-generated, already populated).
- Agent opens it → **picks their name from the cohort** (`resolve_cohort_roster` returns only `coaching_enabled` members' names). That name-pick is the gate: non-cohort agents aren't listed and cannot land in Coach.
- No login required to take the assessment; no per-agent link chasing.
- **Trade-off accepted:** self-identification is slightly less airtight than a per-agent token, but it is a self-assessment (low stakes) and the lead can clear + resend a mismatched profile. Per-agent links are explicitly out of scope for v1.

## 7. Results experience

**Agent — two-act wow reveal** (this is where the wow is won or lost; the existing dark HQ design system is the canvas):
1. **Act 1 — Personal:** lead with the personal type (the felt-seen hit) — name, identity description, strengths, per-axis meters.
2. **Act 2 — Professional:** the professional archetype — how they show up in the business.
3. **Divergence:** "here's where you show up differently at work" — the axes where personal ≠ professional letter.

**Lead — Coach synthesis + 1:1 playbook:** personal type + professional archetype + the divergence + the actionable 1:1 material already in the framework per archetype (`communicate` / `motivate` / `accountable` / `conflict` / `feedforward`) + the `LL` coaching lens (signal / unlock).

## 8. Surfaces & components

- **Coach tab (gains write actions; today read-only):**
  - "Add agents to Coach" picker sourced from the full Pulse/FUB roster.
  - "Not yet assessed" lane — cohort members without an assessment (today dropped by `coachData.ts:207`).
  - "Copy team assessment link" button.
  - Existing archetype roster + agent drill-in extended with the personal profile + divergence + 1:1 playbook.
- **New public assessment route** (`#/assess?t=<join_token>`, no auth): name-pick → personal baseline → professional set → submit.
- **Registration + agent results view:** post-assessment register prompt (email pre-filled from the identified cohort row so `claim_agent` links cleanly), then the two-act reveal. After registering, the agent lands in their home with results + the Rep course.

## 9. Data & backend

**Reuse (already in the DB / codebase):**
- `teams.join_token`, `resolve_join_token` (granted `anon`)
- `agents.token`, `agents.auth_id`, `agents.personal_code`, `claim_agent()`
- `assessments` table + `coachData.ts` `loadProfile` / `loadRoster`
- `truFramework.js` → ported to `coachData.ts` / a new `assessmentData.ts`: `QUESTIONS`, `scoreAssessment`, `BASELINE_QUESTIONS`, `scoreBaseline`, `ARCH`, `PERSONAL_TYPES`, `LL`, `AG`, `CG`, labels

**New:**
- Column `agents.coaching_enabled boolean default false` (+ index).
- RPC `submit_cohort_assessment(join_token, agent_id, personal_code, personal_axes, business_code, tallies, answers)` — a security-definer adaptation of `enroll_agent` that **requires the agent to be a `coaching_enabled` member of the team owning `join_token`, and never creates new rows** (attaches only to the existing curated agent).
- RPC `resolve_cohort_roster(join_token)` → cohort member names for the pick-your-name step.
- RPC / action to set `coaching_enabled` (the "Add to Coach" toggle), org-leader scoped.

**Scoring:** ported client-side (Approach A); the RPC stores results in the shape `loadProfile` already expects. No worker changes required.

## 10. Content & naming standard

Archetype names must **read clearly and map to the personality on sight** — no vague virtue-stacks ("The Inspired Motivator"). Rubric every name must pass:
1. A recognizable, picture-able identity — not stacked adjectives.
2. Maps to the four-letter trait combo immediately.
3. Distinct from all 15 siblings **and** from the other set (personal vs professional must not blur).
4. Flattering but honest.

**Known offenders to fix:** *Bold Visionary, Heartfelt Catalyst, Creative Navigator, Independent Maker* (and soften *Relentless Achiever / Energized Hunter*). **Known collision to resolve:** personal "The Architect" (T-Pro-V-D) vs professional "The Strategic Architect" (T-Pro-R-D). Names are Eric's IP; drafts are proposed, Eric approves final.

## 11. Phasing (Approach C)

- **Phase 1 — ship the felt experience:** full plumbing (cohort flag, link, RPCs, registration), the two-part intake, the two-act reveal on **existing** content, and rename the handful of vague offenders + resolve the Architect collision so nothing reads generic at launch.
- **Phase 2 — deepen the wow:** expand `PERSONAL_TYPES` (and audit `ARCH`) toward 16P-level richness — more facets, longer, more specific — informed by which types feel thin once real; complete the name/copy audit to the §10 rubric.

## 12. Out of scope (deliberate)

- Per-agent assessment links (team-wide gated only for v1).
- Adding a **non-FUB** agent by name/email, and fixing the cold self-signup misroute → separate follow-up spec.
- Auto-emailing links (lead shares the one link themselves; no email infra wired yet).
- A periodic re-assessment cadence (the initial two-part profile only; re-takes later).

## 13. Risks & open questions

- **Personal-axis reliability:** 5 Likert items/axis is thin vs 16P's ~15; near-balanced axes may tip on one answer and read generic. Mitigation candidates (Phase 2): more items, or a discriminating format. Flag, don't block Phase 1.
- **Wow depth:** the existing per-type content is lighter than 16P's immersive results; Phase 1 leans on reveal craft + the divergence, Phase 2 deepens copy.
- **Registration email match:** `claim_agent` links by email; if an agent registers with a different email than FUB has, linking fails. Mitigation: pre-fill the email from the identified cohort row.
