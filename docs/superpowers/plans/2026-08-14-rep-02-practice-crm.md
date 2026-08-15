# Rep Phase 2 — the screenshot practice CRM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner works a real-looking Follow Up Boss record inside a Rep module — built from the
actual screenshots — and the module refuses to advance until the record is right.

**Architecture:** A **skin** is JSON describing one product's screens: for each screen, one real
screenshot plus normalized rectangles for the parts the learner can click (`hotspots`), the parts they
actually type into (`fields`, real DOM controls positioned over the image), and the parts the scenario
paints over (`masks`). A **scenario** is JSON: a seed record, a goal, reveal text, hints — plus a
private `answer` half holding the checks, which never leaves the Worker. The learner's clicks and edits
become an **event log**; a pure reducer folds it into a final state; a pure checker scores that state.
Both live in `shared/` so they run identically in the browser (for the instant Next-button gate) and in
the Worker (for the score of record), and both are unit-testable under the existing node-env vitest.
The whole thing surfaces as **one new lesson card type**, `{ t: 'sim' }`, reusing the Next-button gate
that `drill` cards already have.

**Tech Stack:** Supabase/Postgres + private `rep-media` Storage, Cloudflare Worker (TypeScript),
React 18, vitest (node environment), Anthropic Haiku 4.5 for the rubric pass.

**Spec:** `docs/superpowers/specs/2026-08-14-rep-training-library-design.md` (§3.2–§3.4, §4.3–§4.5)

## Global Constraints

- **`answer` never reaches the browser.** `GET /rep/sim/:slug` selects `spec` only. There is a test
  whose entire job is to fail if a check definition, a rubric, or an expected value ever appears in
  that response. Same discipline as `rep_questions_public` (`db/hq_rep_agent.sql`).
- **Screenshot provenance is binding.** `~/Documents/Codex/2026-08-08/zillow-preferred-day-one-framework/work/production/screenshot-inventory.md`
  governs. Only images marked **OFFICIAL** or **DERIVED REDACTED** may enter a skin. **LIVE DEMO** and
  **RECAPTURE** images may not, until an approved current-team capture is supplied and redacted. **Never
  recreate an interface by hand.**
- **`skinId` stays a pure data field.** No component, check or scenario may hard-code "FUB". Swapping
  in a generic TRU-chrome skin must require changing one string.
- **Seven surfaces, then stop** (spec §4.5). Any FUB feature not exercised by the Day 1 script is out
  of scope, including anything that looks like a five-minute add.
- **Grade on required elements, never string equality.** The scenario pack's "exact note" is a
  facilitator answer key, not a thing to retype.
- Web tests are node-environment, `.test.ts` only. All sim logic lives in plain-TS modules under
  `shared/` and is tested there; React components carry no logic worth testing.
- Additive, idempotent SQL applied through the Supabase MCP connector. No client write policies.
- Commit per task. Fetch and merge `main` before every push.

---

### Task 1: Simulator schema

**Files:**
- Create: `db/hq_rep_sim.sql`

**Interfaces:**
- Consumes: `rep_learners` (Phase 1, Task 1).
- Produces: tables `rep_skins`, `rep_scenarios`, `rep_sim_attempts`; card kind `'sim'` allowed on
  `rep_modules.kind` (already permitted by the Phase 1 check constraint).

- [ ] **Step 1: Write the migration**

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — the practice CRM: skins, scenarios, attempts
-- ═══════════════════════════════════════════════════════════════════════════
-- Additive + idempotent. Writes are service-role-only (no client INSERT/UPDATE
-- policies) — the contract stated in db/hq_rep_authoring.sql.

-- A skin = one product's screens. `spec` holds { screens: { <name>: { image,
-- w, h, hotspots[], fields[], masks[] } } } with rects normalized 0–1.
-- `image` is an object key inside the private rep-media bucket, under the
-- reserved `_skins/<slug>/` prefix.
create table if not exists rep_skins (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references orgs(id) on delete cascade,   -- NULL = shared
  slug       text not null,
  title      text not null,
  spec       jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists rep_skins_global_slug_uk on rep_skins (slug) where org_id is null;
create unique index if not exists rep_skins_org_slug_uk    on rep_skins (org_id, slug) where org_id is not null;

-- A scenario = seed record + goal + hints (spec, PUBLIC) and the checks that
-- score it (answer, NEVER public — same split as rep_questions/rep_questions_public).
create table if not exists rep_scenarios (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references orgs(id) on delete cascade,
  skin_id    uuid not null references rep_skins(id) on delete restrict,
  slug       text not null,
  title      text not null,
  spec       jsonb not null default '{}'::jsonb,
  answer     jsonb not null default '{}'::jsonb,
  pass_pct   int  not null default 80,
  status     text not null default 'published',
  created_at timestamptz not null default now()
);
create unique index if not exists rep_scenarios_global_slug_uk on rep_scenarios (slug) where org_id is null;
create unique index if not exists rep_scenarios_org_slug_uk    on rep_scenarios (org_id, slug) where org_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rep_scenarios_status_check') then
    alter table rep_scenarios add constraint rep_scenarios_status_check
      check (status in ('draft','published','archived'));
  end if;
end $$;

create table if not exists rep_sim_attempts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  learner_id  uuid not null references rep_learners(id) on delete cascade,
  scenario_id uuid not null references rep_scenarios(id) on delete cascade,
  module_id   uuid references rep_modules(id) on delete set null,
  final_state jsonb,
  events      jsonb,
  results     jsonb,
  score       int,
  passed      boolean,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists rep_sim_attempts_learner_idx  on rep_sim_attempts (learner_id, started_at desc);
create index if not exists rep_sim_attempts_scenario_idx on rep_sim_attempts (scenario_id);
create index if not exists rep_sim_attempts_org_idx      on rep_sim_attempts (org_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table rep_skins        enable row level security;
alter table rep_scenarios    enable row level security;
alter table rep_sim_attempts enable row level security;

drop policy if exists rep_skins_read on rep_skins;
create policy rep_skins_read on rep_skins for select to anon, authenticated
  using (active and (org_id is null or is_org_member(org_id)));

-- DELIBERATELY NO client select policy on rep_scenarios. The browser NEVER reads
-- this table — `answer` lives in the same row as `spec`, and a policy that
-- exposed one would expose both to anyone who can craft a PostgREST query.
-- The Worker reads it with the service role and returns `spec` alone.
-- (Mirrors hq_rep_agent.sql dropping rep_questions_read for the same reason.)

drop policy if exists rep_sim_attempts_org_read on rep_sim_attempts;
create policy rep_sim_attempts_org_read on rep_sim_attempts for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_sim_attempts_self_read on rep_sim_attempts;
create policy rep_sim_attempts_self_read on rep_sim_attempts for select to authenticated
  using (learner_id in (select id from rep_learners
                         where user_id = auth.uid()
                            or agent_id in (select id from agents where auth_id = auth.uid())));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply through the Supabase MCP connector and verify**

```sql
select tablename, rowsecurity from pg_tables
 where tablename in ('rep_skins','rep_scenarios','rep_sim_attempts');
select count(*) as scenario_policies from pg_policies where tablename = 'rep_scenarios';
```

Expected: 3 tables, all `rowsecurity = true`, and **`scenario_policies = 0`** — that zero is the
answer-leak guarantee.

- [ ] **Step 3: Commit**

```bash
git add db/hq_rep_sim.sql
git commit -m "feat(rep): practice-CRM schema — skins, scenarios, attempts"
```

---

### Task 2: `shared/repSimState.ts` — the event reducer

The learner's session is an append-only list of events. Folding it over the seed gives the record's
final state. Pure, so the browser and the Worker can never disagree about what the learner did.

**Files:**
- Create: `shared/repSimState.ts`
- Test: `shared/repSimState.test.ts`

**Interfaces:**
- Produces:
  - `type SimEvent` — a discriminated union on `k`:
    `{k:'open',personId} | {k:'search',q} | {k:'goto',screen} | {k:'openActivity',personId} |
     {k:'setStage',personId,value} | {k:'saveStage',personId} | {k:'addNote',personId,body,at} |
     {k:'addTask',personId,title,assignee,dueAt} | {k:'logCall',personId,outcome} |
     {k:'triage',selected:string[]}`, each with `at: string` (ISO).
  - `type SimPerson = { id, name, source, inquiredAt, property, stage, stageSaved, activity, notes, tasks }`
  - `type SimState = { people: Record<string, SimPerson>; triage: string[] | null }`
  - `seedState(spec: ScenarioSpec): SimState`
  - `applyEvent(state: SimState, e: SimEvent): SimState` — immutable
  - `reduceEvents(spec: ScenarioSpec, events: SimEvent[]): SimState`
  - `firstEditIndex(events: SimEvent[]): number` — index of the first mutating event, or `-1`

- [ ] **Step 1: Write the failing test**

```ts
// shared/repSimState.test.ts
import { describe, it, expect } from 'vitest';
import { seedState, applyEvent, reduceEvents, firstEditIndex } from './repSimState.js';

const spec = {
  seed: { people: [{
    id: 'p1', name: 'Priya Shah', source: 'Zillow property inquiry',
    inquiredAt: '2026-08-11T19:26:00-07:00',
    property: { address: '406 Juniper Ln, Puyallup, WA', price: 575000 },
    stage: 'Appointment set',
    activity: [{ type: 'view', address: '406 Juniper Ln', count: 4 }],
    notes: [{ at: '2026-08-11T19:52:00-07:00', body: 'Talked. Interested. Follow up later.' }],
    tasks: [],
  }] },
};
const at = '2026-08-14T17:00:00Z';

describe('seedState', () => {
  it('indexes people by id', () => {
    expect(Object.keys(seedState(spec).people)).toEqual(['p1']);
  });
  it('starts with the seeded stage marked already-saved', () => {
    const s = seedState(spec);
    expect(s.people.p1.stage).toBe('Appointment set');
    expect(s.people.p1.stageSaved).toBe(true);
  });
  it('starts with no triage answer', () => {
    expect(seedState(spec).triage).toBeNull();
  });
});

describe('applyEvent', () => {
  it('setStage changes the stage but leaves it UNSAVED', () => {
    const s = applyEvent(seedState(spec), { k: 'setStage', personId: 'p1', value: 'Spoke with customer', at });
    expect(s.people.p1.stage).toBe('Spoke with customer');
    expect(s.people.p1.stageSaved).toBe(false);
  });
  it('saveStage is what commits it — this is the beat the real product bites people on', () => {
    let s = applyEvent(seedState(spec), { k: 'setStage', personId: 'p1', value: 'Spoke with customer', at });
    s = applyEvent(s, { k: 'saveStage', personId: 'p1', at });
    expect(s.people.p1.stageSaved).toBe(true);
  });
  it('addNote appends, keeping the seeded note', () => {
    const s = applyEvent(seedState(spec), { k: 'addNote', personId: 'p1', body: 'Better note', at });
    expect(s.people.p1.notes).toHaveLength(2);
    expect(s.people.p1.notes[1]).toMatchObject({ body: 'Better note', at });
  });
  it('addTask appends a task with its due timestamp', () => {
    const s = applyEvent(seedState(spec), {
      k: 'addTask', personId: 'p1', title: 'Send Priya Juniper Ln comparison',
      assignee: 'self', dueAt: '2026-08-13T10:00:00-07:00', at });
    expect(s.people.p1.tasks[0]).toMatchObject({ title: 'Send Priya Juniper Ln comparison', assignee: 'self' });
  });
  it('triage records the learner selection once', () => {
    const s = applyEvent(seedState(spec), { k: 'triage', selected: ['stage', 'note'], at });
    expect(s.triage).toEqual(['stage', 'note']);
  });
  it('does not mutate the input state', () => {
    const before = seedState(spec);
    applyEvent(before, { k: 'setStage', personId: 'p1', value: 'X', at });
    expect(before.people.p1.stage).toBe('Appointment set');
  });
  it('ignores an event for an unknown person instead of throwing', () => {
    const s = seedState(spec);
    expect(applyEvent(s, { k: 'setStage', personId: 'nope', value: 'X', at })).toEqual(s);
  });
});

describe('firstEditIndex', () => {
  it('is -1 when the learner has only looked around', () => {
    expect(firstEditIndex([
      { k: 'open', personId: 'p1', at }, { k: 'openActivity', personId: 'p1', at },
    ])).toBe(-1);
  });
  it('points at the first mutating event', () => {
    expect(firstEditIndex([
      { k: 'open', personId: 'p1', at },
      { k: 'triage', selected: ['stage'], at },
      { k: 'setStage', personId: 'p1', value: 'X', at },
    ])).toBe(2);
  });
  it('does not count triage as an edit — triage is the answer, not a change to the record', () => {
    expect(firstEditIndex([{ k: 'triage', selected: ['stage'], at }])).toBe(-1);
  });
});

describe('reduceEvents', () => {
  it('folds a whole session', () => {
    const s = reduceEvents(spec, [
      { k: 'open', personId: 'p1', at },
      { k: 'triage', selected: ['stage', 'note', 'task', 'activity'], at },
      { k: 'setStage', personId: 'p1', value: 'Spoke with customer', at },
      { k: 'saveStage', personId: 'p1', at },
      { k: 'addNote', personId: 'p1', body: 'Reached Priya…', at },
      { k: 'addTask', personId: 'p1', title: 'Send Priya Juniper Ln comparison',
        assignee: 'self', dueAt: '2026-08-13T10:00:00-07:00', at },
    ]);
    expect(s.people.p1.stage).toBe('Spoke with customer');
    expect(s.people.p1.stageSaved).toBe(true);
    expect(s.people.p1.notes).toHaveLength(2);
    expect(s.people.p1.tasks).toHaveLength(1);
    expect(s.triage).toEqual(['stage', 'note', 'task', 'activity']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run ../shared/repSimState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `shared/repSimState.ts` with the types above. Notes worth encoding:

- **Immutability by shallow clone per person.** `applyEvent` returns a new `SimState` with only the
  touched person replaced; everything else is shared by reference. Cheap, and it makes the
  "does not mutate the input" test meaningful.
- **`stageSaved` is a first-class field.** Selecting a stage and saving it are two events because they
  are two acts in the real product, and slide 29 ("save Maya's truthful stage") teaches the save. A
  check can therefore fail a learner who picked the right stage and walked away.
- **Unknown ids are ignored, not thrown.** A malformed event from a stale client must never 500 the
  grade route.
- **`firstEditIndex` treats `triage` as a read.** Triage is the learner's diagnosis, not a change to
  the record — a `beforeEdit` check needs it to sort that way.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run ../shared/repSimState.test.ts`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add shared/repSimState.ts shared/repSimState.test.ts
git commit -m "feat(rep): pure event reducer for the practice CRM"
```

---

### Task 3: `shared/repSimChecks.ts` — deterministic grading

**Files:**
- Create: `shared/repSimChecks.ts`
- Test: `shared/repSimChecks.test.ts`

**Interfaces:**
- Consumes: `SimState`, `SimEvent`, `firstEditIndex` (Task 2).
- Produces:
  - `type Check = EqualsCheck | TaskExistsCheck | NoteExistsCheck | MultiselectCheck | EventBeforeCheck | RubricCheck`
    (each `{ id, type, weight, fail }` plus its own fields)
  - `type CheckResult = { id: string; type: string; weight: number; earned: number; passed: boolean; note: string; deferred?: true }`
  - `runChecks(checks: Check[], state: SimState, events: SimEvent[]): CheckResult[]` — rubric checks
    come back `deferred: true, earned: 0`; the Worker fills them in.
  - `scoreOf(results: CheckResult[]): number` — 0–100, weight-proportional.

- [ ] **Step 1: Write the failing test**

```ts
// shared/repSimChecks.test.ts
import { describe, it, expect } from 'vitest';
import { runChecks, scoreOf } from './repSimChecks.js';
import { reduceEvents } from './repSimState.js';

const spec = { seed: { people: [{
  id: 'p1', name: 'Priya Shah', stage: 'Appointment set',
  activity: [{ type: 'view', address: '406 Juniper Ln', count: 4 }],
  notes: [{ at: 'x', body: 'Talked. Interested. Follow up later.' }], tasks: [],
}] } };
const at = '2026-08-14T17:00:00Z';

const CHECKS = [
  { id: 'triage', type: 'multiselect', weight: 10, beforeEdit: true,
    value: ['stage', 'note', 'task', 'activity'], fail: 'Four things are wrong.' },
  { id: 'stage', type: 'equals', weight: 25, path: 'people.p1.stage',
    value: 'Spoke with customer', requireSaved: true,
    fail: '"Appointment set" claims a meeting that was never booked.' },
  { id: 'task', type: 'taskExists', weight: 25, personId: 'p1',
    match: { titleContains: ['comparison'],
             dueBetween: ['2026-08-13T09:00:00-07:00', '2026-08-13T11:00:00-07:00'],
             assignee: 'self' },
    fail: 'You promised Thursday morning. Nothing here will remind you.' },
  { id: 'note', type: 'rubric', weight: 40, target: 'people.p1.notes.last',
    rubric: ['states what happened and when'], fail: 'The note is too thin to hand off.' },
] as const;

const good = [
  { k: 'open', personId: 'p1', at },
  { k: 'openActivity', personId: 'p1', at },
  { k: 'triage', selected: ['stage', 'note', 'task', 'activity'], at },
  { k: 'setStage', personId: 'p1', value: 'Spoke with customer', at },
  { k: 'saveStage', personId: 'p1', at },
  { k: 'addTask', personId: 'p1', title: 'Send Priya Juniper Ln comparison',
    assignee: 'self', dueAt: '2026-08-13T10:00:00-07:00', at },
  { k: 'addNote', personId: 'p1', body: 'Tue 8/11 7:41 PM — reached Priya…', at },
] as any[];

const run = (events: any[]) => runChecks(CHECKS as any, reduceEvents(spec as any, events), events);

describe('equals', () => {
  it('passes the right stage, saved', () => {
    expect(run(good).find((r) => r.id === 'stage')!.passed).toBe(true);
  });
  it('fails the right stage left UNSAVED when requireSaved', () => {
    const r = run(good.filter((e) => e.k !== 'saveStage'));
    expect(r.find((x) => x.id === 'stage')!.passed).toBe(false);
  });
  it('fails the wrong stage and returns the authored fail line', () => {
    const r = run(good.map((e) => e.k === 'setStage' ? { ...e, value: 'Met With' } : e));
    const stage = r.find((x) => x.id === 'stage')!;
    expect(stage.passed).toBe(false);
    expect(stage.note).toContain('never booked');
  });
});

describe('taskExists', () => {
  it('passes a matching task', () => {
    expect(run(good).find((r) => r.id === 'task')!.passed).toBe(true);
  });
  it('matches titleContains case-insensitively', () => {
    const r = run(good.map((e) => e.k === 'addTask' ? { ...e, title: 'Send COMPARISON to Priya' } : e));
    expect(r.find((x) => x.id === 'task')!.passed).toBe(true);
  });
  it('fails a task due outside the window', () => {
    const r = run(good.map((e) => e.k === 'addTask' ? { ...e, dueAt: '2026-08-13T16:00:00-07:00' } : e));
    expect(r.find((x) => x.id === 'task')!.passed).toBe(false);
  });
  it('fails when no task exists at all', () => {
    expect(run(good.filter((e) => e.k !== 'addTask')).find((r) => r.id === 'task')!.passed).toBe(false);
  });
});

describe('multiselect with beforeEdit', () => {
  it('passes an exact set answered before any edit', () => {
    expect(run(good).find((r) => r.id === 'triage')!.passed).toBe(true);
  });
  it('fails a partial set', () => {
    const r = run(good.map((e) => e.k === 'triage' ? { ...e, selected: ['stage', 'note'] } : e));
    expect(r.find((x) => x.id === 'triage')!.passed).toBe(false);
  });
  it('fails an over-selection — guessing everything is not diagnosis', () => {
    const r = run(good.map((e) => e.k === 'triage'
      ? { ...e, selected: ['stage', 'note', 'task', 'activity', 'source', 'owner'] } : e));
    expect(r.find((x) => x.id === 'triage')!.passed).toBe(false);
  });
  it('fails a correct set answered AFTER the record was edited', () => {
    const reordered = [
      { k: 'open', personId: 'p1', at },
      { k: 'setStage', personId: 'p1', value: 'Spoke with customer', at },
      { k: 'saveStage', personId: 'p1', at },
      { k: 'triage', selected: ['stage', 'note', 'task', 'activity'], at },
    ];
    const r = runChecks(CHECKS as any, reduceEvents(spec as any, reordered as any), reordered as any);
    expect(r.find((x) => x.id === 'triage')!.passed).toBe(false);
  });
  it('fails when triage was never answered', () => {
    expect(run(good.filter((e) => e.k !== 'triage')).find((r) => r.id === 'triage')!.passed).toBe(false);
  });
});

describe('rubric', () => {
  it('is deferred, never scored locally', () => {
    const r = run(good).find((x) => x.id === 'note')!;
    expect(r.deferred).toBe(true);
    expect(r.earned).toBe(0);
  });
});

describe('scoreOf', () => {
  it('is weight-proportional', () => {
    // triage 10 + stage 25 + task 25 pass, note 40 deferred → 60 / 100
    expect(scoreOf(run(good))).toBe(60);
  });
  it('is 0 when nothing passes', () => {
    expect(scoreOf(run([{ k: 'open', personId: 'p1', at }] as any))).toBe(0);
  });
  it('is 100 when every weight is earned', () => {
    const results = run(good).map((r) => ({ ...r, earned: r.weight, passed: true, deferred: undefined }));
    expect(scoreOf(results)).toBe(100);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run ../shared/repSimChecks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Design notes to encode:

- **`equals`** resolves `path` with a small dotted getter over `SimState`. `requireSaved: true` also
  asserts `stageSaved` on the addressed person. Comparison is trimmed and case-insensitive — a stage
  name is a picked value, not free text, so casing is never the thing being tested.
- **`taskExists`** scans the person's tasks: every `titleContains` term must appear (case-insensitive),
  `dueBetween` is an inclusive timestamp window compared as epoch ms so timezone offsets in the
  authored bounds are handled correctly, and `assignee` must match when specified.
- **`noteExists`** is the cheap sibling of `rubric` — asserts a note was added after the seed and is at
  least `minWords` long. Use it where a rubric would be overkill.
- **`multiselect`** compares as **sets, exactly**: missing an item fails, and so does adding one.
  Selecting everything must not pass, or triage teaches nothing. With `beforeEdit: true`, the `triage`
  event's index must be less than `firstEditIndex(events)` (or `firstEditIndex` must be `-1`).
- **`eventBefore`** asserts ordering generally — e.g. `openActivity` before `addNote`, which is how
  slide 21 ("Home Activity is a signal, not certainty") gets enforced rather than merely stated.
- **`rubric`** returns `{ deferred: true, earned: 0, note: 'Graded by your coach…' }`. The browser uses
  the same function for its instant gate, so the gate must treat a deferred check as *not yet passing*
  and route the learner to submit.
- **`scoreOf`** = `round(100 * sum(earned) / sum(weight))`, and returns `0` when total weight is 0.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run ../shared/repSimChecks.test.ts`
Expected: 17 passed.

- [ ] **Step 5: Commit**

```bash
git add shared/repSimChecks.ts shared/repSimChecks.test.ts
git commit -m "feat(rep): deterministic scenario checks for the practice CRM"
```

---

### Task 4: The FUB skin — assets and measurement

This is the task that makes it *"the real screenshots."*

**Files:**
- Create: `db/skins/fub-2026-08.json`
- Create: `tools/skin-measure.html` (a local measuring aid, not shipped)
- Create: `db/rep_skin_seed.mjs`

**Interfaces:**
- Produces: skin `fub-2026-08` with screens `people`, `profile`, `stage`, `note`, `task`, `activity`,
  and objects uploaded to `rep-media` under `_skins/fub-2026-08/`.

- [ ] **Step 1: Select the images against the inventory**

Source directory:
`~/Documents/Codex/2026-08-08/zillow-preferred-day-one-framework/work/production/`

| Screen | Image | Inventory ID | Status |
|---|---|---|---|
| `people` | `crops/list-full.png` (+ `crops/list-sidebar.png`, `crops/list-money-lists.png`) | IMG-003 / IMG-004 | OFFICIAL |
| `profile` | `crops/detail-full.png` (+ `crops/detail-details.png`) | IMG-007 | OFFICIAL |
| `activity` | `crops/detail-timeline.png` | IMG-008 | OFFICIAL |
| `note` | `crops/detail-note-composer.png` | IMG-016 | OFFICIAL |
| `task` | `screenshots/official-create-task-dialog.png` | IMG-017 | OFFICIAL |
| `stage` | `crops/stage-save-check.png` | IMG-015 | **RECAPTURE** |

**Stop on `stage`.** IMG-015 is marked RECAPTURE because the team's stage names and rules are
unresolved, and the inventory says explicitly: *do not teach a selected stage from this example.* The
stage screen is the one Day 1 leans on hardest (slides 27–29, and three of the four scenarios). Do one
of these before authoring any stage check:

1. Capture the current team's stage dropdown from an approved test account and redact it, **or**
2. Render the stage control as a `field` with **no background image** — a native `<select>` painted in
   TRU chrome, seeded from the scenario's own `stages[]` list. Everything else stays screenshot-true.

Option 2 is the recommendation: it unblocks Phase 2 today, it is honest (it never claims to be FUB's
screen), and it is the one control whose exact option list must come from the team anyway. Record the
choice in the skin JSON as `"screens.stage.source": "synthetic"` so it is obvious later.

- [ ] **Step 2: Upload the approved images**

```bash
# Never commit binaries into the repo — they live in the private rep-media bucket.
node db/rep_skin_seed.mjs <secrets.json> --upload-only
```

The uploader walks the table above, PUTs each file to `rep-media` at
`_skins/fub-2026-08/<name>.png` with the service role, and prints the object key it wrote. Files
outside the approved list are refused with the inventory status as the reason.

- [ ] **Step 3: Measure the rects**

Open `tools/skin-measure.html` in a browser and drop in one screenshot. It renders the image at natural
size, lets you drag rectangles, and prints `[x, y, w, h]` normalized to four decimals plus a suggested
id. Paste into the skin JSON. This is a five-minute-per-screen job and beats guessing pixel offsets.

- [ ] **Step 4: Write the skin JSON**

```jsonc
{
  "slug": "fub-2026-08",
  "title": "Follow Up Boss",
  "screens": {
    "people": {
      "image": "_skins/fub-2026-08/list-full.png",
      "w": 1600, "h": 900,
      "fields": [
        { "id": "search", "kind": "text", "rect": [0.3100, 0.0400, 0.3400, 0.0450],
          "placeholder": "Search name, phone, email", "event": "search" }
      ],
      "hotspots": [
        { "id": "list:newLeads", "rect": [0.0200, 0.2200, 0.1500, 0.0400], "filter": "newLeads" },
        { "id": "rows",          "rect": [0.2000, 0.2600, 0.7200, 0.3400], "paint": "peopleRows",
          "rowHeight": 0.048, "goto": "profile", "event": "open" }
      ],
      "masks": [ { "rect": [0.2000, 0.2600, 0.7200, 0.3400] } ]
    },
    "profile": {
      "image": "_skins/fub-2026-08/detail-full.png", "w": 1600, "h": 900,
      "masks": [
        { "rect": [0.2600, 0.1000, 0.3000, 0.0500], "paint": "personName" },
        { "rect": [0.2600, 0.1600, 0.3000, 0.0400], "paint": "personSource" }
      ],
      "hotspots": [
        { "id": "tab:activity", "rect": [0.6400, 0.2000, 0.1200, 0.0400], "goto": "activity", "event": "openActivity" },
        { "id": "btn:note",     "rect": [0.2600, 0.2600, 0.1100, 0.0400], "goto": "note" },
        { "id": "btn:task",     "rect": [0.3800, 0.2600, 0.1100, 0.0400], "goto": "task" },
        { "id": "btn:call",     "rect": [0.5000, 0.2600, 0.0900, 0.0400], "event": "logCall" }
      ],
      "fields": [
        { "id": "stage", "kind": "select", "rect": [0.2600, 0.2000, 0.1800, 0.0400],
          "optionsFrom": "scenario.stages", "event": "setStage", "source": "synthetic" },
        { "id": "stageSave", "kind": "button", "rect": [0.4500, 0.2000, 0.0700, 0.0400],
          "label": "Save", "event": "saveStage" }
      ]
    },
    "activity": { "image": "_skins/fub-2026-08/detail-timeline.png", "w": 1600, "h": 900,
      "masks": [ { "rect": [0.2600, 0.2200, 0.5000, 0.4000], "paint": "activityRows" } ],
      "hotspots": [ { "id": "back", "rect": [0.2400, 0.1000, 0.0600, 0.0400], "goto": "profile" } ] },
    "note": { "image": "_skins/fub-2026-08/detail-note-composer.png", "w": 1600, "h": 900,
      "fields": [
        { "id": "noteBody", "kind": "textarea", "rect": [0.2800, 0.3000, 0.4400, 0.2000],
          "placeholder": "What happened, and what happens next?" },
        { "id": "noteSave", "kind": "button", "rect": [0.6400, 0.5200, 0.0800, 0.0400],
          "label": "Save note", "event": "addNote", "from": { "body": "noteBody" }, "goto": "profile" }
      ] },
    "task": { "image": "_skins/fub-2026-08/official-create-task-dialog.png", "w": 1200, "h": 800,
      "fields": [
        { "id": "taskTitle",    "kind": "text",     "rect": [0.2200, 0.2600, 0.5600, 0.0500] },
        { "id": "taskAssignee", "kind": "select",   "rect": [0.2200, 0.3400, 0.2600, 0.0500],
          "options": [["self", "Me"], ["team", "Someone on the team"]] },
        { "id": "taskDue",      "kind": "datetime", "rect": [0.5200, 0.3400, 0.2600, 0.0500] },
        { "id": "taskCreate",   "kind": "button",   "rect": [0.6400, 0.6400, 0.1400, 0.0500],
          "label": "Create Task", "event": "addTask",
          "from": { "title": "taskTitle", "assignee": "taskAssignee", "dueAt": "taskDue" },
          "goto": "profile" }
      ] }
  }
}
```

- [ ] **Step 5: Seed it and verify the images resolve**

```bash
node db/rep_skin_seed.mjs <secrets.json>
```

Then, signed in, confirm `GET /rep/media/sign-download?path=_skins/fub-2026-08/detail-full.png`
returns a working URL. (That route already exists — `worker/src/index.ts:1013` — and already
authorizes both a learner agent and an org leader.)

- [ ] **Step 6: Commit**

```bash
git add db/skins/fub-2026-08.json db/rep_skin_seed.mjs tools/skin-measure.html
git commit -m "feat(rep): FUB skin built from the approved Day 1 screenshots"
```

---

### Task 5: `SimSurface` — the screenshot-composited React surface

**Files:**
- Create: `web/src/pages/sim/SimSurface.tsx`
- Create: `web/src/pages/sim/paint.tsx` (the `paint` renderers)
- Modify: `web/src/truHqDark.css` (append a `.sim-*` block)

**Interfaces:**
- Consumes: skin JSON (Task 4), `SimState` / `SimEvent` (Task 2), `signRepMediaDownload` (existing,
  `web/src/lib/api.ts:323`).
- Produces: `<SimSurface skin={Skin} scenario={ScenarioSpec} state={SimState} screen={string}
  onEvent={(e: SimEvent) => void} onGoto={(screen: string) => void} />`

- [ ] **Step 1: Build the geometry shell**

The whole component is one positioned box:

```tsx
<div className="sim-frame" style={{ aspectRatio: `${screen.w} / ${screen.h}` }}>
  <img className="sim-chrome" src={signedUrl} alt="" draggable={false} />
  {masks.map(m => <div className="sim-mask" style={pct(m.rect)}>{paint(m, state)}</div>)}
  {hotspots.map(h => <button className="sim-hot" style={pct(h.rect)} onClick={…} />)}
  {fields.map(f => <Field key={f.id} field={f} style={pct(f.rect)} … />)}
</div>
```

with `pct([x,y,w,h]) → { left: `${x*100}%`, top: `${y*100}%`, width: `${w*100}%`, height: `${h*100}%` }`.
Because every rect is normalized against the image's own box and the frame carries the screenshot's
`aspectRatio`, the surface scales to any width with no re-measurement.

- [ ] **Step 2: Style the fields to disappear into the screenshot**

Transparent background, no border, `font: inherit`, a `--accent`-colored focus ring, and a
`sim-hot:hover` outline so a learner can find what's clickable without the surface looking like a
form pasted on a picture. Masks are `background: var(--surface)` — solid, matching the screenshot's
own panel color, so painted scenario data reads as part of the screen.

- [ ] **Step 3: Implement the `paint` renderers**

`peopleRows`, `personName`, `personSource`, `activityRows`, `notesList`, `tasksList` — each takes
`(state, scenario)` and returns rows styled to match the screenshot's typography. This is the seam
where generic official screenshots become *Priya's* record.

- [ ] **Step 4: Emit events, never mutate**

Every interaction calls `onEvent` with a fully-formed `SimEvent` carrying `at: new Date().toISOString()`.
`SimSurface` holds no state of its own beyond in-progress field text; the parent owns the log. That is
what makes the browser's gate and the Worker's score agree.

- [ ] **Step 5: Verify against the real screenshot**

Run: `cd web && npm run dev`, open the Priya module, and check each screen at 1440px, 1024px and
768px wide. The controls must sit on their painted counterparts at every width. Fix rects in the skin
JSON, not in CSS.

- [ ] **Step 6: Typecheck, build, commit**

```bash
cd web && npm run typecheck && npm run build
git add web/src/pages/sim/ web/src/truHqDark.css
git commit -m "feat(rep): SimSurface composites live controls onto real screenshots"
```

---

### Task 6: The `sim` card and its gate

**Files:**
- Modify: `web/src/lib/api.ts:130-154` (`LessonCard` gains `scenarioId`, `goal`)
- Modify: `web/src/pages/AgentCourse.tsx:19-32` (`cardLabel`), `:533-575` (`Lesson` gate),
  `:624-771` (`Card` dispatch)
- Create: `web/src/pages/sim/SimCard.tsx`

**Interfaces:**
- Consumes: `SimSurface` (Task 5), `runChecks` / `scoreOf` (Task 3), `reduceEvents` (Task 2).
- Produces: card shape `{ t: 'sim', scenarioId: string, title?: string, goal?: string }`; the `Lesson`
  Next button stays disabled until that card reports `passed`.

- [ ] **Step 1: Extend the card type**

```ts
// web/src/lib/api.ts — LessonCard
scenarioId?: string;   // sim — the rep_scenarios slug this card runs
goal?: string;         // sim — the one-line objective shown above the surface
```

- [ ] **Step 2: Extend the gate**

`AgentCourse.tsx:538` today reads:

```ts
const isDrill = card?.t === 'drill';
const answered = !isDrill || picks[i] !== undefined;
```

Generalize it so a card can declare itself un-cleared, without teaching `Lesson` anything about sims:

```ts
// A card may GATE the Next button. `drill` gates on being answered; `sim` gates
// on its checks passing (SimCard reports up through onCleared). Everything else
// is clear on sight.
const [cleared, setCleared] = useState<Record<number, boolean>>({});
const gates = card?.t === 'drill' || card?.t === 'sim';
const answered = !gates || (card.t === 'drill' ? picks[i] !== undefined : !!cleared[i]);
```

and in the `Next`/`Take the quiz` buttons keep `disabled={!answered}`, changing only the hint label:
`{card?.t === 'sim' && !answered ? 'Fix the record to continue' : 'Next'}`.

- [ ] **Step 3: Add `cardLabel` and the `Card` branch**

```ts
if (c.t === 'sim') return '🖥 Work the record';
```
```tsx
if (card.t === 'sim') return <SimCard card={card} onCleared={onCleared} />;
```

- [ ] **Step 4: Build `SimCard`**

It owns: the event log, the current screen, a **Check my work** button, and the result panel.

- Fetch `GET /rep/sim/:scenarioId` (Task 7) for the skin + spec.
- On **Check my work**, run `runChecks` locally for an instant read, *then* `POST /rep/sim/grade`
  (Task 8) for the score of record — the server's answer always wins, and a `deferred` rubric check
  only resolves there.
- Show every failed check as its authored `fail` line, in the order authored. Never reveal an expected
  value; the `fail` line is the coaching.
- Unlimited retries, matching the quiz (`AgentCourse.tsx:881`, "unlimited retries"). Each attempt
  writes a `rep_sim_attempts` row, so the leader sees the shape of the struggle, not just the pass.
- Call `onCleared(true)` only when the server says `passed`.

- [ ] **Step 5: Verify the gate**

Run: `cd web && npm run dev`. Open a module whose card list contains a `sim`. Confirm: Next is dead on
arrival; fixing three of four checks leaves it dead with three green lines and one red; fixing the
fourth turns it live.

- [ ] **Step 6: Commit**

```bash
cd web && npm run typecheck && npm run build
git add web/src/pages/sim/SimCard.tsx web/src/pages/AgentCourse.tsx web/src/lib/api.ts
git commit -m "feat(rep): sim lesson card gates Next until the record is right"
```

---

### Task 7: `GET /rep/sim/:slug` — spec out, answers never

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/src/repSim.ts`
- Test: `worker/src/repSim.test.ts`

**Interfaces:**
- Consumes: `resolveLearner` (Phase 1, Task 3).
- Produces: `{ scenario: { id, slug, title, spec, pass_pct }, skin: { slug, title, spec } }`.

- [ ] **Step 1: Write the failing test — the leak test first**

```ts
it('never returns the answer half, at any depth', async () => {
  const text = await (await call('z-day1-repair-priya')).text();
  expect(text).not.toContain('checks');
  expect(text).not.toContain('rubric');
  expect(text).not.toContain('Spoke with customer');   // the expected stage value
  expect(text).not.toContain('answer');
});
it('returns the seed, goal, hints and the skin', async () => {
  const b = await (await call('z-day1-repair-priya')).json();
  expect(b.scenario.spec.seed.people[0].name).toBe('Priya Shah');
  expect(b.skin.spec.screens.profile.image).toContain('_skins/');
});
it('403s a caller who is not a learner in any org', async () => {
  expect((await callAs('at-stranger', 'z-day1-repair-priya')).status).toBe(403);
});
it('404s an unpublished scenario', async () => {
  expect((await call('some-draft')).status).toBe(404);
});
it('404s another org private scenario', async () => {
  expect((await callAs('at-acme', 'globex-only')).status).toBe(404);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repSim.test.ts`
Expected: FAIL — 404 from the router.

- [ ] **Step 3: Implement**

```ts
// worker/src/repSim.ts
import type { Db } from './db.js';

/** Load a published scenario the learner's org may see, WITHOUT its answer half. */
export async function loadScenarioForLearner(
  database: Db, slug: string, orgId: string,
): Promise<{ scenario: any; skin: any } | null> {
  // `select=` is the enforcement point: `answer` is never named, so PostgREST
  // never serializes it. Do not switch this to `select=*`.
  const rows = await database.select(
    'rep_scenarios',
    `slug=eq.${encodeURIComponent(slug)}&status=eq.published` +
    `&or=(org_id.is.null,org_id.eq.${orgId})` +
    `&select=id,slug,title,spec,pass_pct,skin_id`,
  );
  if (!rows.length) return null;
  const s = rows[0] as any;
  const skins = await database.select(
    'rep_skins', `id=eq.${s.skin_id}&active=is.true&select=slug,title,spec`);
  if (!skins.length) return null;
  const { skin_id: _drop, ...scenario } = s;
  return { scenario, skin: skins[0] };
}
```

Route:

```ts
const simMatch = url.pathname.match(/^\/rep\/sim\/([^/]+)$/);
if (simMatch && req.method === 'GET') {
  const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const learner = await resolveLearner(database, userId);
  if (!learner) return json({ error: 'not enrolled' }, 403);
  const found = await loadScenarioForLearner(database, simMatch[1], learner.org_id);
  if (!found) return json({ error: 'scenario not found' }, 404);
  return json(found);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd worker && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/repSim.ts worker/src/repSim.test.ts worker/src/index.ts
git commit -m "feat(rep): GET /rep/sim/:slug — spec to the browser, answers never"
```

---

### Task 8: `POST /rep/sim/grade` — the score of record

**Files:**
- Modify: `worker/src/repSim.ts`, `worker/src/index.ts`
- Test: `worker/src/repSimGrade.test.ts`

**Interfaces:**
- Consumes: `reduceEvents` (Task 2), `runChecks` / `scoreOf` (Task 3), `resolveLearner`.
- Produces: `POST /rep/sim/grade` with body `{ scenarioSlug, moduleId?, events: SimEvent[] }` →
  `{ score, passed, results: CheckResult[] }`, and one `rep_sim_attempts` row per call.

- [ ] **Step 1: Write the failing test**

```ts
it('grades from the EVENTS, ignoring any client-sent final state or score', async () => {
  const res = await grade({ events: goodEvents, finalState: { people: {} }, score: 100 });
  expect(await res.json()).toMatchObject({ score: 100, passed: true });
  // and with a forged finalState but empty events:
  const res2 = await grade({ events: [], finalState: perfectState, score: 100 });
  expect((await res2.json()).score).toBe(0);
});
it('persists an attempt row with the events and results', async () => {
  await grade({ events: goodEvents });
  expect(inserted.find((i) => i.table === 'rep_sim_attempts')?.row)
    .toMatchObject({ learner_id: 'L1', passed: true });
});
it('records a FAILED attempt too — the struggle is the coaching signal', async () => {
  await grade({ events: [] });
  expect(inserted.find((i) => i.table === 'rep_sim_attempts')?.row.passed).toBe(false);
});
it('rejects an events array that is not an array', async () => {
  expect((await grade({ events: 'nope' })).status).toBe(422);
});
it('caps the event log so a runaway client cannot blow the row up', async () => {
  const many = Array.from({ length: 5000 }, () => ({ k: 'open', personId: 'p1', at: 'x' }));
  expect((await grade({ events: many })).status).toBe(422);
});
it('403s a learner from another org than the scenario owner', async () => { /* … */ });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repSimGrade.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

```ts
if (url.pathname === '/rep/sim/grade' && req.method === 'POST') {
  const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const learner = await resolveLearner(database, userId);
  if (!learner) return json({ error: 'not enrolled' }, 403);

  const body = (await req.json().catch(() => null)) as any;
  const slug = String(body?.scenarioSlug ?? '').trim();
  const events = Array.isArray(body?.events) ? (body.events as SimEvent[]) : null;
  if (!slug || !events) return json({ error: 'scenarioSlug and events[] required' }, 422);
  if (events.length > 2000) return json({ error: 'event log too long' }, 422);

  // The full row THIS time — the Worker needs `answer`, which the learner route
  // deliberately never selects.
  const rows = await database.select(
    'rep_scenarios',
    `slug=eq.${encodeURIComponent(slug)}&status=eq.published` +
    `&or=(org_id.is.null,org_id.eq.${learner.org_id})&select=id,spec,answer,pass_pct`,
  );
  if (!rows.length) return json({ error: 'scenario not found' }, 404);
  const sc = rows[0] as any;

  // Grade from the EVENTS only. Anything the client computed is untrusted.
  const state = reduceEvents(sc.spec, events);
  let results = runChecks(sc.answer?.checks ?? [], state, events);
  results = await resolveRubricChecks(env, sc, state, results);   // Task 9

  const score = scoreOf(results);
  const passed = score >= Number(sc.pass_pct ?? 80);
  await database.insert('rep_sim_attempts', {
    org_id: learner.org_id, learner_id: learner.id, scenario_id: sc.id,
    module_id: body?.moduleId ?? null,
    final_state: state, events, results, score, passed,
    finished_at: new Date().toISOString(),
  });
  return json({ score, passed, results });
}
```

> Until Task 9 lands, stub `resolveRubricChecks` to return `results` unchanged. Any rubric check then
> stays `deferred: true, earned: 0` — a scenario carrying one cannot reach 100, which is correct and
> visible rather than silently wrong.

- [ ] **Step 4: Run the tests**

Run: `cd worker && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/repSim.ts worker/src/repSimGrade.test.ts worker/src/index.ts
git commit -m "feat(rep): POST /rep/sim/grade scores from the event log, server-side"
```

---

### Task 9: The rubric pass — grading the note

**Files:**
- Modify: `worker/src/repSim.ts`
- Test: `worker/src/repSimRubric.test.ts`

**Interfaces:**
- Consumes: the exact request shape in `worker/src/practice.ts:236` (`gradeTranscript`).
- Produces: `resolveRubricChecks(env, scenario, state, results): Promise<CheckResult[]>`

- [ ] **Step 1: Write the failing test**

```ts
it('awards partial credit per rubric element met', async () => {
  stubAnthropic({ elements: [
    { met: true, why: 'timestamp and outcome present' },
    { met: true, why: 'need captured' },
    { met: false, why: 'no time on the promised action' },
    { met: true, why: 'views framed as signal' }] , coach_note: '…' });
  const out = await resolveRubricChecks(env, scenario, state, results);
  const note = out.find((r) => r.id === 'note')!;
  expect(note.earned).toBe(30);   // 3 of 4 elements × weight 40
  expect(note.deferred).toBeUndefined();
});
it('passes the check only when every element is met', async () => { /* 4/4 → passed true */ });
it('degrades to a deterministic length floor when the API errors', async () => {
  stubAnthropic(new Error('503'));
  const note = (await resolveRubricChecks(env, scenario, state, results)).find((r) => r.id === 'note')!;
  expect(note.passed).toBe(false);
  expect(note.note).toContain('could not be graded');
});
it('never sends the answer key text to the model', async () => {
  await resolveRubricChecks(env, scenario, state, results);
  expect(sentPrompt).not.toContain('Spoke with customer');
});
it('sends the LEARNER note verbatim', async () => {
  await resolveRubricChecks(env, scenario, state, results);
  expect(sentPrompt).toContain(learnerNoteBody);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repSimRubric.test.ts`
Expected: FAIL — `resolveRubricChecks is not a function`.

- [ ] **Step 3: Implement**

Mirror `gradeTranscript` exactly — same model (`claude-haiku-4-5-20251001`), same
`system` + `cache_control: { type: 'ephemeral' }` shape, same "slice between the first `{` and the last
`}`" JSON extraction, same throw-on-non-200.

```ts
const RUBRIC_SYSTEM = `You grade a real-estate agent's CRM note against a list of required elements. You are strict but fair — a veteran team leader reading a colleague's record, not a grammar teacher. Judge only whether each element is PRESENT. Never reward length, and never penalize wording, formatting or tone. Output ONLY valid JSON.`;

function rubricPrompt(goal: string, elements: string[], text: string): string {
  return `A trainee was asked to: ${goal}

Required elements, in order:
${elements.map((e, i) => `${i + 1}. ${e}`).join('\n')}

For EACH element, decide whether the note below actually contains it. A paraphrase counts. A near-miss does not.

Return ONLY this JSON shape:
{"elements":[{"met":true|false,"why":"one short sentence"}],"coach_note":"2-3 sentences addressed to the trainee as 'you'"}

THE NOTE:
${text}`;
}
```

Scoring: `earned = round(weight * met / elements.length)`; `passed = met === elements.length`. On any
failure — non-200, unparseable JSON, wrong element count — fall back to
`{ passed: false, earned: 0, note: 'This note could not be graded automatically — your leader will review it.' }`
and **never** throw out of the grade route. A grading outage must not lose the learner's attempt.

- [ ] **Step 4: Run the tests**

Run: `cd worker && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/repSim.ts worker/src/repSimRubric.test.ts
git commit -m "feat(rep): rubric grading for scenario notes, with a safe fallback"
```

---

### Task 10: Seed the Priya scenario — the pivot gate

This is the twelve-minute exercise that proves or kills the whole approach.

**Files:**
- Create: `db/scenarios/z-day1-repair-priya.json`
- Create: `db/rep_scenario_seed.mjs`

**Interfaces:**
- Consumes: skin `fub-2026-08` (Task 4), the check types (Task 3).
- Produces: published scenario `z-day1-repair-priya`.

- [ ] **Step 1: Transcribe from the scenario pack**

Source: `~/Documents/Codex/2026-08-08/zillow-preferred-day-one-framework/work/production/day1-scenario-pack.md`,
section **SCN-REPAIR (Priya Shah)**. Every value below already exists there. **Transcribe; do not
invent.** The four planted flaws are: wrong stage, weak note, missing task, overlooked activity.

The `spec` half is exactly the document in spec §4.4, plus:

```jsonc
"stages": ["Lead", "Spoke with customer", "Appointment set", "Met With",
           "Showing Homes", "Under Contract", "Sales Closed"],
"goal": "Find and repair four risks before this lead is lost.",
"hints": {
  "stage":    "What did the contact actually produce — a conversation, or a booked time?",
  "note":     "Could a teammate pick this up cold and know who, what, and what next?",
  "task":     "You promised her something. Where does that promise live?",
  "activity": "Something the system already saw isn't written down anywhere."
}
```

The `answer` half is exactly the checks in spec §4.4 — `triage` (multiselect, beforeEdit, 10),
`stage` (equals + requireSaved, 25), `task` (taskExists, 25), `note` (rubric, 40) — plus one more that
enforces slide 21's lesson about signal versus proof:

```jsonc
{ "id": "readFirst", "type": "eventBefore", "weight": 0,
  "before": "openActivity", "after": "addNote",
  "fail": "You wrote the note before you looked at what she'd been doing." }
```

Weight `0` means it never blocks the pass but always shows in the results panel — a coaching line,
not a gate. Use that pattern for anything worth saying but not worth failing someone over.

`pass_pct: 80`. With note (40) + stage (25) + task (25) = 90, a learner who nails the record but
whiffs triage still passes; one who fixes only the stage and the task does not.

- [ ] **Step 2: Seed it**

```bash
node db/rep_scenario_seed.mjs <secrets.json> db/scenarios/z-day1-repair-priya.json
```

Idempotent upsert on `slug`. The seeder must **refuse** to write if `answer.checks` is empty or if any
check id is duplicated — the two authoring mistakes that produce a scenario nobody can fail.

- [ ] **Step 3: Attach it to a module**

Create module Z10 as a `source='custom'` module for the pilot org (or a shared one), whose cards are:
a `section` framing the audit, a `text` card giving the phone-call context, the `sim` card
(`{ t: 'sim', scenarioId: 'z-day1-repair-priya', goal: 'Find and repair four risks…' }`), and a
`callout` closing on the standard: *could another agent take this over?*

- [ ] **Step 4: Walk it end to end, twice**

1. As a **leader**, via Rep's preview — confirm the sim runs and Phase 1's leader-progress change
   records the pass.
2. As a **test agent** — confirm the gate, a failed attempt, the coaching lines, and the retry.

Then check the attempt rows:

```sql
select score, passed, jsonb_array_length(events) as evts, finished_at
  from rep_sim_attempts order by started_at desc limit 5;
```

- [ ] **Step 5: The pivot decision**

Answer three questions in writing before starting Phase 3:

1. Did a real learner finish in ≈12 minutes without help?
2. Did any check fail work that was actually correct? (One false failure is a stop-and-fix.)
3. Was authoring the JSON faster than building the same exercise as a slide?

If all three are yes, Phase 3's authoring hours are low risk. If not, fix it here — before eleven more
modules are written on top of it.

- [ ] **Step 6: Commit**

```bash
git add db/scenarios/z-day1-repair-priya.json db/rep_scenario_seed.mjs
git commit -m "feat(rep): the Priya repair scenario — Phase 2 pivot gate"
```

---

### Task 11: Leader visibility into sim attempts

**Files:**
- Modify: `worker/src/dataRoutes.ts` (extend `/data/rep/board` with `sim_attempts`)
- Modify: `web/src/pages/Rep.tsx:468-529` (`AgentDrill`)
- Modify: `web/src/lib/api.ts` (`RepData` gains `simAttempts`)

**Interfaces:**
- Consumes: `rep_sim_attempts` (Task 1), `/data/rep/board` (existing).
- Produces: on the roster drill-down, per scenario:
  `Repair the record · passed on attempt 3 · best 92%`, expandable to the failed check ids.

- [ ] **Step 1: Extend the board read**

Add one more parallel read to the existing five in `/data/rep/board`, as the user (RLS scopes it to the
org via `rep_sim_attempts_org_read`):

```ts
asUser('rep_sim_attempts',
  'select=learner_id,scenario_id,score,passed,results,started_at&order=started_at.desc&limit=500'),
```

- [ ] **Step 2: Render it**

In `AgentDrill`, beside the existing Live Sim tile, add one tile per scenario the learner has attempted,
in the same `rp-drill-mod` idiom with `passed` / `in_progress` classes. Expanded, list the failed check
`fail` lines from the most recent attempt — that is the leader's coaching script, generated for free.

- [ ] **Step 3: Typecheck, build, verify**

Run: `cd web && npm run typecheck && npm run build && npm run dev`
Expected: after a test agent fails then passes Priya, the leader sees both attempts.

- [ ] **Step 4: Commit and deploy**

```bash
git add worker/src/dataRoutes.ts web/src/pages/Rep.tsx web/src/lib/api.ts
git commit -m "feat(rep): leaders see scenario attempts and the exact checks that failed"
git fetch origin && git merge origin/main
cd worker && npx wrangler deploy
cd ../web && npm run build      # requires .env.production (gitignored)
```

Publish per `DEPLOY.md`, bump the service-worker cache if the shell changed, and verify the live
bundle actually carries the change rather than trusting the deploy's own success report.

---

## Self-review notes

- **Spec coverage:** §3.2 screenshot-backed surface → Tasks 4, 5. §3.3 the `sim` card and gate →
  Task 6. §3.4 two-pass grading → Tasks 3, 8, 9. §4.3 skin document → Task 4. §4.4 scenario document →
  Tasks 7, 10. §4.5 seven surfaces → Task 4's screen list, and nothing beyond it.
- **Naming is consistent:** `SimEvent` / `SimState` / `reduceEvents` / `firstEditIndex` (T2) are what
  T3, T5, T6 and T8 import; `Check` / `CheckResult` / `runChecks` / `scoreOf` (T3) are what T6, T8 and
  T9 import; `resolveRubricChecks` (T9) is stubbed in T8 and filled in in T9, with the stub's behavior
  stated so T8 is testable on its own.
- **One decision escalated rather than guessed:** the stage screen is inventory-status **RECAPTURE**
  (Task 4, Step 1). The recommendation is a synthetic TRU-chrome stage control, and the alternative —
  an approved current-team capture — is spelled out so Eric can overrule it in one sentence.
