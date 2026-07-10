# Coaching Tab — 1:1 Improvements — Model Plan

**Orchestration:** This run is conducted by an **Opus orchestrator** session. Opus does
no block work itself — for each block it dispatches a subagent pinned to that block's
model (`sonnet` or `fable`) via the Agent tool's `model` override, reports the result at
the 🛑 gate, and waits for Eric to confirm before dispatching the next block. A fresh
Opus session can pick up this file and run it as written.

**Repo:** `C:\Users\ericg\Desktop\truhq\pulse` — Vite + React + Supabase monorepo. The
web app is in `pulse/web` (NOT `pulse/src`). All Coaching UI lives in
`web/src/pages/Coach.tsx`; the Supabase data layer is `web/src/lib/coachData.ts`; schema
is `db/hq_coach.sql`. Deploy = Direct-Upload `tru-pulse-app` via `wrangler --use-system-ca`.

**⚠️ Standing design constraint (applies to EVERY UI block):** Eric loves the current
Coach UI and wants nothing thrown in that looks unintentional or off-brand. Before adding
any UI, the subagent must **read the existing components in `Coach.tsx` and reuse their
patterns** — typography, spacing, card styling, chips, and the existing collapsible idiom
(`CommitGroup`, `Coach.tsx:1155-1203`). No new visual vocabulary. The `web-design` agent
and the TRU visual standard are available as reference if a subagent is unsure. Design
fidelity is checked again in the closing audit.

**What's already true (from a codebase pass):**
- The "Log this 1:1" form (`OneOnOneSheet`, `Coach.tsx:874-991`) keeps notes in ephemeral
  local `useState` (`Coach.tsx:883-889`) — lost whenever the component unmounts.
- Past 1:1s **are already saved** to Supabase `checkins` (`saveCheckin`, `coachData.ts:552`)
  and **already loaded** back via `loadCheckins` (`coachData.ts:534`) into `AgentDrill` —
  there is just **no UI that displays the history**.
- The goal fields already autosave-on-type (`GoalSheet`, `Coach.tsx:1023-1035`) — a good
  pattern to mirror.

---

## Block 1: Fix "notes vanish when I navigate away"

**Model:** Sonnet
**Dispatch:** Opus orchestrator → Sonnet subagent
**Why:** Root cause is known and the fix is a standard, well-understood pattern (draft
persistence) — scoped execution, not a reasoning problem.
**Scope:** In `OneOnOneSheet` (`Coach.tsx:874-991`), the "Log this 1:1" fields
(`met`, `win`, `focus`, `date` — `Coach.tsx:883-889`) live only in local `useState`, so
they're destroyed whenever the component unmounts. Two unmount paths must both be covered:
(1) drill navigation — `setOpenId(null)` / opening another agent (`Coach.tsx:297, 346`);
(2) tab navigation — `coachNav` mutating `window.location.hash` (`Coach.tsx:561-568`).
Fix: back the in-progress form with a **localStorage draft keyed by agent id**
(e.g. `pulse:1on1draft:{agentId}`). On mount, hydrate the fields from the draft if present;
on change, debounce-write the draft (mirror the debounce pattern already used by
`GoalSheet` at `Coach.tsx:1023-1035` for consistency); on **successful** `saveCheckin`,
clear that agent's draft. Add a small, on-brand "draft restored" affordance so the leader
knows their notes came back. Critical correctness checks: the draft must be keyed per
agent so notes never leak from one agent's 1:1 into another's, and it must clear on submit
so a logged 1:1 doesn't leave a stale draft behind. Scope is limited to the 1:1 log form —
the goal fields already persist.

---
🛑 STOP HERE — Opus reports this block's result and waits for Eric to confirm before
dispatching Block 2.
---

## Block 2: "Past 1:1s" history view in the agent drill-in

**Model:** Sonnet
**Dispatch:** Opus orchestrator → Sonnet subagent
**Why:** The data is already saved and already loaded — this is a pure, design-sensitive
UI build against an existing dataset with no new data layer. Scoped execution.
**Scope:** Add a collapsible **"Past 1:1s"** section inside `AgentDrill` (`Coach.tsx`).
The history is already in memory: `loadCheckins(agentId)` (`coachData.ts:534`) returns the
full record set newest-first and is loaded into the `checkins` array (`Coach.tsx:645, 656`)
— no new fetch or table needed; render what's there. Each row shows the date
(`created_at`), a "met" status chip (`met`: yes/partial/no), and a one-line preview of the
`win`/`focus`; clicking a row expands the full logged notes so a leader can reread exactly
what was discussed before the next 1:1. Reuse the existing collapsible idiom and visual
styling (`CommitGroup`, `Coach.tsx:1155-1203`) — this must look like a native part of the
current drill-in, not a bolt-on. Empty state ("No logged 1:1s yet") should match the app's
existing empty-state treatment. When Block 1's draft feature and a real save both exist,
confirm a newly-logged 1:1 appears at the top of this list (the `onLogged` prepend already
updates the array — `Coach.tsx:853`).

---
🛑 STOP HERE — Opus reports this block's result and waits for Eric to confirm before
dispatching Block 3.
---

> **Status:** Block 1 (draft fix) ✅ done + tested by Eric. Block 2 (Past 1:1s view) ✅
> done, Eric testing. **Plan expanded mid-run:** Eric wants the tiny "Log this 1:1" form
> replaced by a full **structured leadership 1:1** (commitments review + wins + next
> focuses + a guided leadership checklist), saved two-sided so it rolls into the agent's
> profile. That becomes Blocks 3–4 below and slots BEFORE the paste-in import (now Block 5),
> because the import should fill the new richer form. Eric's product decisions: (a) ONE
> standard TRU leadership checklist for v1, customizable later; (b) the agent sees their
> wins + commitments + next focuses, while the leader's checklist and private notes stay
> leader-only.

## Block 3: Structured leadership 1:1 — DESIGN

**Model:** Fable
**Dispatch:** Opus orchestrator → Fable subagent (design only — writes a design doc, NOT
production code)
**Why:** Genuine, cascading reasoning surface: a data model for a structured session
(carrying last 1:1's commitments forward, multiple wins/focuses, checklist completion), a
**two-sided agent/broker visibility model with RLS**, and integration with the existing
`checkins`/`commitments`/`goals` tables — get this wrong and it's rework or a permissions
leak. Also drafts the standard checklist content, which is judgment work.
**Scope:** Design how to replace the small `OneOnOneSheet` log form with a structured
leadership 1:1. Deliverable is a design doc saved to `pulse/COACH_1ON1_STRUCTURED_DESIGN.md`
plus the drafted checklist, covering: (1) DATA MODEL — extend `checkins` vs a new
`one_on_ones` table + child rows; how "review last 1:1's commitments" links to the prior
session's `commitments`; how wins / next focuses / checklist-completion / private notes are
stored; and the shared-vs-leader-only split. (2) TWO-SIDED VISIBILITY — confirm the
agent-facing surface exists (agent portal / `logged_by`/RLS in `hq_coach.sql`), and design
RLS so the agent sees ONLY their wins + commitments + next focuses while checklist + private
notes stay leader-only, with no cross-org/agent leakage. (3) THE STANDARD CHECKLIST —
draft the actual guided prompts, grounded in TRU's behavioral-leadership coaching (agents
have archetypes — Achiever / Independent / Striver — and coaching is wired to how each is
"wired"); seed set: reviewed last commitments? celebrated a specific win? asked what's
blocking? connected work to their goal? set next focus + commitments? (4) COMPATIBILITY —
how Block 1's draft persistence and the Block 5 paste-in import apply to the new form, and
how Block 2's Past 1:1s view renders the richer record. (5) BUILD BREAKDOWN — propose the
Sonnet build sub-blocks (e.g. schema/migration, leader-side structured form, agent-side
profile view). Present at the gate for Eric's approval before any building.

---
🛑 STOP HERE — Opus reports the design + drafted checklist and waits for Eric to approve the
data model, the visibility split, and the checklist before dispatching Block 4.
---

## Block 4: Structured leadership 1:1 — BUILD

**Model:** Sonnet (may be split into the sub-blocks Block 3 proposes, each its own 🛑 gate)
**Dispatch:** Opus orchestrator → Sonnet subagent(s)
**Why:** Once Block 3 fixes the data model, visibility rules, and checklist, building the
schema, the leader-side form, and the agent-side view is scoped execution.
**Scope:** Implement exactly the approved Block 3 design. Replace the `OneOnOneSheet` form
with the structured 1:1: commitments-review of the prior session, wins, next focuses, and
the guided leadership checklist; persist it via the approved schema; render the agent-side
recap (wins + commitments + next focuses only) on the agent's profile and the full record
on the broker side. Must preserve Block 1's draft persistence and appear in Block 2's Past
1:1s history. DESIGN FIDELITY is the standing constraint — reuse existing Coach components,
classes, chips, and both Dark/Warm themes; nothing bolted-on. Keep everything previewable
under `?demo=1` with seeded data so Eric can test locally. Typecheck + build clean; no
deploy, no commit.

---
🛑 STOP HERE — Opus reports each build sub-block and waits for Eric to confirm before
continuing.
---

## Block 5: Note import — paste-in + AI-extract (fills the structured 1:1)

**Model:** Sonnet
**Dispatch:** Opus orchestrator → Sonnet subagent
**Why:** Scoped execution — pasted text → extracted fields, now targeting the structured
form built in Block 4.
**Scope:** Add a paste-in import near the structured 1:1: the leader pastes their AI
notetaker's summary/transcript (any tool — Read AI, Otter, Fireflies, plain notes), Pulse
extracts the **wins** and **next focuses** and prefills those sections for the leader to
review/edit before saving. Nothing saved without leader confirmation. Extraction runs
server-side (reuse Pulse's existing AI-call pattern; API key never client-side). Flows
through Block 1's draft persistence. Match the design language. **Phase 2 (noted, NOT built
here):** a live Read AI connection that auto-pulls meetings — deferred follow-up.

---
🛑 STOP HERE — Opus reports this block's result and waits for Eric to confirm before
dispatching Block 6.
---

## Block 6: Audit / review pass

**Model:** Fable
**Dispatch:** Opus orchestrator → Fable subagent (fresh context — NOT a subagent that
wrote any of the code, so the review is adversarial rather than self-confirming)
**Why:** Auditing is reasoning. A final read-back over every build block before Eric relies
on this in front of his leaders and agents.
**Scope:** Independently verify: (1) draft fix prevents note loss across BOTH unmount paths,
no cross-agent leak, clears on save; (2) Past 1:1s renders real history, newest appears
immediately, design-faithful; (3) the structured 1:1 persists correctly, carries prior
commitments forward accurately, and — CRITICAL — the two-sided visibility holds: the agent
sees ONLY wins + commitments + next focuses, the leader's checklist + private notes are
never exposed to the agent, and there is no cross-org/agent leakage (verify RLS, not just
UI); (4) the paste-in import extracts sanely, never auto-writes without confirmation, keeps
keys server-side. Design-fidelity check across all of it (Eric's explicit priority). Opus
makes the final go/no-go off this audit.

---
🛑 STOP HERE — Opus reports the audit and makes the final go/no-go with Eric.
---
