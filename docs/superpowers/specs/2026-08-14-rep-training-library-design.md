# TRU Rep → a training library — design spec

**Written** 2026-08-14. Supersedes `~/Documents/Codex/2026-08-13/tru-rep-training-library/PLAN.md`
(that document's strategy is carried forward; two of its calls are reversed below — §3.2 and §3.6).

**Owner:** Eric Matthews · **Repo:** `~/Desktop/truhq/pulse` · **Deploys to:** app.truhq.co (Rep tab)

---

## 1. The ask, stated plainly

Turn the Rep tab from a five-module course into a **library of training material** that any team Eric
consults with can use to onboard. Three things follow from that:

1. **Trainings Eric currently presents live must live in here as follow-up reference** — an agent who
   sat through Day 1 can come back and re-read it.
2. **Some trainings should stop being instructor-led entirely.** Day 1 (Zillow Preferred) is the first
   one: 135 minutes of slides and click-by-click narration that a self-paced module does better.
3. **Activities are built from the real screenshots** already produced for that training, as
   interactive surfaces — and **both leaders and agents** must satisfy real conditions (enter the right
   values, repair a broken contact) before the module lets them advance.

The quality bar is Eric's business benchmark: nothing ships that feels like compliance training.

---

## 2. What exists today

Rep is further along than it feels. It was built as a *course*; it now needs to be a *shelf*.

**Data** (Supabase, TRU-Pulse project — all writes go through the Cloudflare Worker with the service role):

| Table | What it holds |
|---|---|
| `rep_modules` | flat list ordered by `idx`; `cards jsonb` (typed lesson screens); `pass_pct`; `active`; authoring columns `source` / `status` / `author_id`; `org_id` NULL = shared TRU curriculum |
| `rep_questions` + `rep_questions_public` view | quiz questions with the correct answer withheld from the browser |
| `rep_progress` | one row per **agent × module**: `not_started \| in_progress \| passed`, score, attempts, leader sign-off stamps |
| `rep_practice` | voice roleplay attempts (Retell web call → LLM-graded against an ALMS rubric in `worker/src/practice.ts`) |
| `rep-media` Storage bucket | private; signed up/download through the Worker |

**Learner UI** — `web/src/pages/AgentCourse.tsx` (911 lines): module list → lesson (left rail of steps,
one card at a time) → quiz → result, plus the Live Sim. Card types implemented today:
`section, text, stat, stats, callout, script, dialogue, compare, steps, drill, video, media`.

> **The hook everything hangs on:** `Lesson` refuses to advance while the current card is a `drill`
> the learner hasn't answered — `AgentCourse.tsx:538` (`answered`) and `:571` (`disabled={!answered}`).
> A new interactive card type inherits that gate for free.

**Leader UI** — `web/src/pages/Rep.tsx` (1050 lines): certification gauge, journey rail, funnel,
searchable roster, per-agent drill-down, sign-off, module manager, card-by-card module editor with
media upload.

**Worker routes** — `/rep/invite`, `/rep/grade`, `/rep/modules`, `/rep/modules/:id/questions`,
`/rep/modules/:id/archive`, `/rep/uploads/sign`, `/rep/media/sign-download`, `/rep/practice/*`,
`/data/rep/board`, `/data/rep/sign-off`.

**Content** — `db/rep_curriculum.mjs` (v4) is the versioned source of truth: 5 modules (Welcome to
Preferred, Speed to Lead, ALMS, Working a Paid Lead, Follow-Up Discipline).

**The Day 1 material** lives outside the app in
`~/Documents/Codex/2026-08-08/zillow-preferred-day-one-framework/`:

- `work/production/day1-slide-script.md` — 940 lines, 36 slides, 10 sections, 135 minutes
- `work/production/day1-scenario-pack.md` — 340 lines; four fully specified FUB records
  (**Maya** guided, **Jordan** independent, **Priya** repair, **Elena** homework) with exact expected
  stage / note / task and answer keys
- `work/production/day1-homework-handout.md`
- `work/production/screenshot-inventory.md` — **46 provenance-tracked images**, 45 of them unmodified
  originals published on official Follow Up Boss help pages, 1 truthful redacted derivative
- `work/production/crops/` and `work/production/screenshots/` — the images themselves

**Honest read of the gap:** the writing is good. What's missing is (a) five modules is one program, not
a library; (b) every module proves mastery the same way — multiple choice — which is why it reads as
compliance; (c) there is no shelf, no track, no search, no assignment, no certificate; and (d) leaders
cannot take a module at all, because progress is keyed to `agents.id`.

---

## 3. Design decisions

### 3.1 Four proof types; every module picks one

A library becomes professional when the **proof matches the skill**.

| Skill | Proof | Today |
|---|---|---|
| Knowledge — standards, numbers, why speed wins | cards + quiz | ✅ exists |
| **Procedure inside software** — find the lead, set the stage, write the note, schedule the task | **do it in a screenshot-true practice CRM, auto-checked** | ❌ the build |
| Conversation — ALMS, objections, the live-connect | voice roleplay, rubric-graded | ✅ exists, underused |
| Judgment on a live record | real-account assignment + leader sign-off | ⚠️ sign-off exists, submission doesn't |

Rule: *anything that is "click here, then here" is never taught by a slide.* It is a task the learner
performs and the system verifies.

### 3.2 The practice surface is built **from the real screenshots** — screenshot-backed, not redrawn

**This reverses the 2026-08-13 plan**, which called for a redrawn neutral React FUB clone. Eric's call
is the real screenshots, and it is the better one for three reasons: the muscle memory transfers
exactly, the fidelity is free instead of being an ongoing pixel-chasing cost, and the 46-image
inventory with full provenance is already produced and QA'd.

**How it works — the composite model.** A *skin* is a JSON document describing one product's screens.
Each screen is one real screenshot plus a set of normalized rectangles:

- **`chrome`** — the screenshot itself, rendered as an `<img>` at natural aspect ratio. Immutable.
- **`hotspot` rects** — regions the learner can click. A click either navigates to another screen, or
  opens a **field group**, or is simply recorded as an event the checker can assert on.
- **`field` rects** — real, live HTML controls (`<select>`, `<textarea>`, `<input type="date">`)
  absolutely positioned over the screenshot at that rect, styled to disappear into it. These are what
  the learner actually types into, and what gets graded.
- **`mask` rects** — solid fills that blank out a region of the screenshot so seeded scenario data
  (Priya's name, her stage, her weak note) can be painted on top of a generic official screenshot.

So the picture is real; the parts the learner operates are live DOM. One `SimSurface` React component
renders any skin. New training = new JSON, not new code.

**Why not standalone HTML files per exercise** (Eric's first instinct, and the one thing to avoid):
it works for one demo and collapses at ten. Each file re-implements the shell, none can grade, none
record progress, and none can be edited by anyone but a coder. The skin + scenario JSON gets the same
"it's the real screen" feel with grading, progress, and authoring.

**The provenance rule stays.** `screenshot-inventory.md` is binding. Only `OFFICIAL` (published FUB /
Zillow documentation) and `DERIVED REDACTED` images may be baked into a skin. Anything marked
`LIVE DEMO` or `RECAPTURE` needs an approved current-team capture first, and any team capture must be
redacted before it enters the bucket. No screen is ever recreated by hand.

> **One flag, then I proceed.** Those images are Follow Up Boss's published product documentation.
> Using them inside Eric's own teams' training is ordinary; **selling** Rep to another brokerage with
> FUB's chrome baked in is not. The skin layer is the mitigation: `skinId` is a scenario field, and a
> generic TRU-chrome skin can replace the FUB skin without touching a scenario, a check, or a line of
> component code. Build FUB-skinned now; the exit exists the day it's needed.

### 3.3 One more card type, not a new module format

```ts
{ t: 'sim', scenarioId: 'z-day1-repair-priya', title: 'Repair the record',
  goal: 'Find and fix four risks before this lead is lost.' }
```

`Lesson` already blocks Next on an unanswered `drill`. A `sim` card uses the same gate: **Next stays
dead until the scenario's checks pass.** Module completion, progress, sign-off, the leader roster and
the authoring editor all keep working untouched.

### 3.4 Grading is two-pass and always server-side

1. **Deterministic checks** — pure TypeScript, instant, free. Stage equals X. A task exists whose title
   contains Y and whose due timestamp falls in window Z. A note exists. The activity panel was opened
   before the record was edited. These live in `shared/repSimChecks.ts` so they are unit-testable under
   the existing node-environment vitest config, and the **same module** runs in the Worker.
2. **Rubric checks** on free text (the note) — reuse the exact pattern in `worker/src/practice.ts:236`
   (`gradeTranscript`): strict-coach system prompt, JSON-only output, weighted breakdown, Haiku 4.5.
   Grade on **required elements**, never on string equality. The scenario pack's "exact note" is an
   answer key for the facilitator, not a thing to retype.

`rep_scenarios.answer` is never sent to the browser — the same discipline `rep_questions_public`
already enforces. The client gets `spec` (seed + goal + skin + hints); the Worker grades against
`answer` with the service role.

### 3.5 Leaders take the training too

Today `rep_progress.agent_id` references `agents(id)`. A team leader is a `memberships` row, not an
agent — so a leader **cannot complete a module at all**, only watch. Eric's ask ("bosses and agents
have to pass certain parameters") makes that a blocker, not a nicety.

The fix is a **learner spine**: `rep_learners` unifies both kinds.

```
rep_learners (id, org_id, kind 'agent'|'member', agent_id, user_id, name, email)
```

Exactly one of `agent_id` / `user_id` is set, enforced by a check constraint, with partial unique
indexes on each. Every agent gets a row by backfill; a member row is created lazily the first time a
leader opens a module. `rep_progress`, `rep_sim_attempts`, `rep_assignments` and `rep_certificates`
all key on `learner_id`. `rep_progress.agent_id` stays (nullable, dual-written) for one release so
the existing leader roster keeps rendering during the migration, then is dropped.

### 3.6 A library, not a course

**Also a reversal of emphasis from 2026-08-13:** the shelf is not a later phase, it is the first one,
because Day 1 alone adds eleven modules and the current flat `idx` list cannot hold them legibly.

- **Tracks** — Zillow Preferred Onboarding, TRU Fundamentals, Conversation Lab, Realtor.com MVIP.
- **Assignment** — a leader assigns a track to a learner (or a whole roster) with a due date.
- **Browse and search** — by track, by tag, by level, by duration.
- **Certificate** — issued on track completion; visible to the learner and on the leader roster.
- **Module metadata** — `kind`, `duration_min`, `level`, `tags[]`, `cover`, `version`.

---

## 4. Target architecture

### 4.1 Schema additions

All additive and idempotent, in the house style of `db/hq_rep_*.sql`.

```sql
-- Learner spine (3.5)
rep_learners      (id, org_id, kind, agent_id, user_id, name, email, created_at)

-- The shelf (3.6)
rep_tracks        (id, org_id, slug, title, subtitle, cover, order_idx, active, created_at)
rep_track_modules (track_id, module_id, idx, required)
rep_assignments   (id, org_id, learner_id, track_id, due_at, assigned_by, assigned_at, completed_at)
rep_certificates  (id, org_id, learner_id, track_id, issued_at, signed_off_by)

-- Module metadata (3.6)
alter rep_modules add: kind text default 'lesson', duration_min int,
                       level text, tags text[], cover text, version int default 1

-- The simulator (3.2, 3.4)
rep_skins         (id, org_id, slug, title, spec jsonb, active)
rep_scenarios     (id, org_id, skin_id, slug, title, spec jsonb, answer jsonb, pass_pct, status)
rep_sim_attempts  (id, org_id, learner_id, scenario_id, module_id,
                   final_state jsonb, events jsonb, results jsonb, score, passed,
                   started_at, finished_at)

-- Learner spine migration (3.5)
alter rep_progress add: learner_id uuid references rep_learners(id)
alter rep_progress alter agent_id drop not null
```

### 4.2 Worker routes

```
GET  /data/rep/library         tracks + modules + this learner's progress, assignments, certificates
GET  /rep/sim/:slug            skin + seed state + goal + hints  (never `answer`)
POST /rep/sim/grade            { scenarioId, moduleId, finalState, events } → per-check results + score
POST /rep/assignments          leader assigns a track to learners with a due date
GET  /data/rep/submissions     leader queue: assignment-kind modules awaiting sign-off
POST /rep/certificates/issue   issue on track completion (called by grade; idempotent)
POST /rep/skins                leader/admin: create/update a skin  (Phase 6)
POST /rep/scenarios            leader/admin: create/update a scenario  (Phase 6)
```

Every route follows the established shape: `verifySupabaseUser` → resolve learner or
`isOrgLeaderOrAdmin` → service-role `db()` calls → `json()`. `/data/*` routes keep calling Supabase
**as the user** (the tenancy invariant `worker/src/dataRoutes.test.ts` exists to protect).

### 4.3 The skin document

```jsonc
{
  "id": "fub-2026-08",
  "title": "Follow Up Boss",
  "screens": {
    "people": {
      "image": "_skins/fub-2026-08/list-full.png",
      "w": 1600, "h": 900,
      "hotspots": [
        { "id": "search",      "rect": [0.31, 0.04, 0.34, 0.045], "opens": "field:search" },
        { "id": "row:p1",      "rect": [0.20, 0.28, 0.72, 0.048], "goto": "profile" },
        { "id": "list:newleads","rect": [0.02, 0.22, 0.15, 0.04], "filter": "newLeads" }
      ],
      "fields": [
        { "id": "search", "kind": "text", "rect": [0.31, 0.04, 0.34, 0.045],
          "placeholder": "Search name, phone, email" }
      ],
      "masks": [ { "rect": [0.20, 0.26, 0.72, 0.34], "paint": "peopleRows" } ]
    },
    "profile":  { "image": "_skins/fub-2026-08/detail-full.png", "...": "..." },
    "stage":    { "image": "_skins/fub-2026-08/stage-save-check.png", "...": "..." },
    "note":     { "image": "_skins/fub-2026-08/detail-note-composer.png", "...": "..." },
    "task":     { "image": "_skins/fub-2026-08/official-create-task-dialog.png", "...": "..." },
    "activity": { "image": "_skins/fub-2026-08/detail-timeline.png", "...": "..." }
  }
}
```

Rects are `[x, y, w, h]` normalized 0–1 against the screenshot's own box, so the surface is responsive
without re-measuring. `paint` names a renderer that draws seeded scenario data into a masked region.

### 4.4 The scenario document

Everything below already exists in prose in `day1-scenario-pack.md`. **The conversion is
transcription, not invention.**

```jsonc
{
  "slug": "z-day1-repair-priya",
  "skinId": "fub-2026-08",
  "title": "Repair the record",
  "goal": "Find and repair four risks before this lead is lost.",
  "seed": {
    "people": [{
      "id": "p1", "name": "Priya Shah",
      "source": "Zillow property inquiry", "inquiredAt": "2026-08-11T19:26:00-07:00",
      "property": { "address": "406 Juniper Ln, Puyallup, WA", "price": 575000 },
      "stage": "Appointment set",
      "activity": [ { "type": "view", "address": "406 Juniper Ln", "count": 4 },
                    { "type": "save", "address": "422 Juniper Ln" },
                    { "type": "view", "address": "510 Pinecrest Ct" } ],
      "notes": [ { "at": "2026-08-11T19:52:00-07:00", "body": "Talked. Interested. Follow up later." } ],
      "tasks": []
    }]
  },
  "reveal": [{ "after": "open:p1", "body":
    "The call already happened. Tue 8/11, 7:41 PM — Priya is comparing Puyallup homes with her spouse, needs 3+ bedrooms, no date was agreed, and she asked for a 406 vs 422 comparison Thursday morning." }],
  "hints": { "stage": "What did the contact actually produce — a conversation, or a booked time?" },
  "pass": 80
}
```

…and the answer half, which never leaves the Worker:

```jsonc
{
  "checks": [
    { "id": "triage", "type": "multiselect", "beforeEdit": true, "weight": 10,
      "prompt": "Which risks does this record have?",
      "options": ["stage", "note", "task", "activity", "source", "owner"],
      "value": ["stage", "note", "task", "activity"],
      "fail": "Four things are wrong here, and one of them is what is *missing*." },
    { "id": "stage", "type": "equals", "path": "people.p1.stage", "value": "Spoke with customer",
      "weight": 25, "fail": "\"Appointment set\" claims a meeting that was never booked." },
    { "id": "task", "type": "taskExists", "weight": 25,
      "match": { "titleContains": ["comparison"],
                 "dueBetween": ["2026-08-13T09:00:00-07:00", "2026-08-13T11:00:00-07:00"],
                 "assignee": "self" },
      "fail": "You promised Thursday morning. Nothing in this record will remind you." },
    { "id": "note", "type": "rubric", "target": "people.p1.notes.last", "weight": 40,
      "rubric": [ "states what happened and when",
                  "captures the need: 3+ bedrooms, Puyallup, buying with a spouse",
                  "names the promised next action with a specific time",
                  "treats repeat views as a signal, never as proof of intent" ] }
  ]
}
```

### 4.5 The seven surfaces — and where to stop

Build only what Day 1 touches. Cloning FUB is the single biggest scope risk on this project.

1. **People** list with search (find by name *and* by phone — that's slide 15, "find Maya two ways")
2. **Smart Lists** rail (membership computed from seed filters, not hand-authored)
3. **Contact profile** — header with source/inquiry, the stage control, and a **save that must be
   confirmed**, because the real one bites people
4. **Activity panel** — views/saves, deliberately framed as signal, not proof
5. **Notes** — free text, timestamped
6. **Tasks** — title, assignee, date, time
7. **Contact bar** — call / text / Zillow-message controls that log an attempt (nothing is sent)

Seven surfaces, then stop.

---

## 5. Content plan

### 5.1 Tracks at launch

| Track | Modules | Source |
|---|---|---|
| **Zillow Preferred Onboarding** | 11 (Day 1) → ~30 (Days 1–4) | the Codex framework decks |
| **TRU Fundamentals** | 5, re-tagged and re-covered | current `db/rep_curriculum.mjs` v4 |
| **Conversation Lab** | 6–8 voice scenarios | existing Retell personas |
| **Realtor.com / MVIP** | later | Day 1 track, re-skinned |

### 5.2 Day 1, converted

135 instructor-led minutes → **~75 self-paced minutes + a 45-minute live debrief.**

| # | Module | From slides | Proof |
|---|---|---|---|
| Z1 | Why you're here, and the four days | 1–8 | quiz |
| Z2 | How this person reached you: Zillow → FUB | 9–10 | quiz |
| Z3 | The three numbers Zillow grades you on | 11–12 | quiz — **merge with the existing *Welcome to Preferred* module; do not ship it twice** |
| Z4 | Find the lead before you lose it | 13–17 | **sim** — find Maya two ways, open her, spot who needs attention |
| Z5 | Read the record before you act | 19–23 | **sim** + judgment drill: which claims does this record actually support? |
| Z6 | Three ways to reach the buyer | 24–26 | drill |
| Z7 | Tell the truth with the stage | 27–28 | **sim** — stage only, three records |
| Z8 | Work Maya end to end | 29–32 | **sim** — stage + note (rubric) + task |
| Z9 | Do it alone: Jordan | 33 | **sim**, no hints, scored |
| Z10 | Repair the record: Priya | 34 | **sim**, four planted flaws, triage before editing |
| Z11 | Could another agent take this over? | 35–36 | **assignment** — Elena on the real account, leader sign-off |

Slide 18 (the break) disappears. The live session stops being a lecture and becomes: review
submissions, run the voice roleplay live, answer what the modules surfaced.

### 5.3 House style — what makes it read as professional

Every module: **one objective**, 6–10 minutes, opens with a hook, ends with a proof step, and shows
"what good looks like" as a real artifact. Cover art per module. Duration and level on every card. A
progress ring that reflects real work. A certificate at track completion. **No module ships whose only
proof is four multiple-choice questions.**

---

## 6. Phasing

| Phase | Ships | Plan |
|---|---|---|
| **1 — The shelf + the learner spine** | tracks, assignments, search, browse, certificates, module metadata, leaders can take modules | `plans/2026-08-14-rep-01-library-shelf.md` |
| **2 — The screenshot practice CRM** | skins, scenarios, the `sim` card and its gate, deterministic grading, Priya (Z10) as the proof | `plans/2026-08-14-rep-02-practice-crm.md` |
| **3 — Day 1 becomes a track** | Z1–Z11 authored, Maya/Jordan/Elena scenarios, pilot on the next hire | `plans/2026-08-14-rep-03-day1-track.md` |
| **4 — Rubric grading + leader review** | LLM note grading, assignment submission queue, sign-off with evidence | later |
| **5 — Days 2–4, Conversation Lab, analytics** | mostly content; voice cards wired into modules | later |
| **6 — Scenario & skin authoring UI** | build a sim exercise without a developer | later |

Phases 1 and 2 are independent and can be built in parallel. **Phase 2's Priya scenario is the pivot
gate:** twelve minutes of learner time, every check type in one exercise. If it works, Phase 3's
content hours are low risk. If it doesn't, it dies before those hours are spent.

---

## 7. Risks

- **Cloning FUB too far.** Seven surfaces, then stop. This is the risk most likely to eat the project.
- **Brittle grading.** Over-specified checks fail correct work and destroy trust in one session.
  Deterministic checks *only* where there is exactly one right answer; everything human goes to the
  rubric with required-element scoring.
- **Answers leaking.** `spec` to the browser, `answer` never. Enforce it the way `rep_questions_public`
  already does, and assert it in a test.
- **Content debt.** The shell will outrun the writing. Phase 3 is authoring hours, not engineering.
- **Screenshot provenance.** `screenshot-inventory.md` is binding. `LIVE DEMO` and `RECAPTURE` images
  are not cleared for a skin. Team captures need redaction first.
- **Third-party resale.** See §3.2 — keep `skinId` a pure data field so a generic skin can swap in.
- **Deploy discipline.** `.env.production` is gitignored and a fresh checkout bakes a dead database URL
  into the bundle; the Worker deploys only from `main`; `main` moves under you when Codex lands commits
  on the laptop. Fetch and merge before every push.

---

## 8. Open decisions

These do not block Phase 1 or Phase 2. Answer them before Phase 3 authoring starts.

1. **Does the live Day 1 class survive?** Recommendation: yes, as a 45-minute debrief after the
   modules, not a 135-minute lecture.
2. **Does the Day 1 capstone stay on a real Follow Up Boss account with Eric's sign-off**, or does the
   simulator handle all of it? Recommendation: keep one real-account capstone — it is the only thing
   that proves they can do it where it counts.
3. **Internal only, or a product other brokerages buy?** If it's a product, §3.2's generic skin becomes
   Phase 3 work rather than optional.
4. **Who else can author?** Eric only, or team leads too? Changes how much Phase 6 matters.
5. **Is Eric on camera?** A two-minute video from him at the top of each track raises the ceiling on
   "professional" more than anything else on this list, and it's the one thing that can't be built for
   him.
