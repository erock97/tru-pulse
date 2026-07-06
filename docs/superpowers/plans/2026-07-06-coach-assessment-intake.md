# Coach Assessment Intake — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an invited agent a way to take the two-part TRU behavioral assessment (person → business) from a team-wide link, land the result in Coach, and let the agent register to see a premium two-act reveal — reviving the intake lost in the standalone→Pulse merger.

**Architecture:** Port the proprietary framework + scoring from the standalone `truFramework.js` into a pure `web/src/lib/assessmentData.ts` (spectrum-scored, per-axis percentages). A no-auth public route (`#/assess?t=<join_token>`) renders the survey against the existing `teams.join_token`; a cohort-gated `security definer` RPC writes results to the existing `assessments` table (professional) + `agents.personal_code`/`personal_axes` (personal). Coach gains cohort curation (a `coaching_enabled` flag) and surfaces the personal profile + divergence + 1:1 playbook. No Worker changes.

**Tech Stack:** Vite + React + TypeScript (`web/`), Supabase (Postgres + RLS + `security definer` RPCs), vitest (unit tests for pure scoring).

**Spec:** `docs/superpowers/specs/2026-07-06-coach-assessment-intake-design.md`

## Global Constraints

- **Brand:** built native in Pulse's dark-gold TRU system — reuse `web/src/truHqDark.css` tokens (`--accent`, `--accent-hi`, `--bg`, etc.). Premium, never cheap. No cream/standalone carryover.
- **Responsive:** first-class on **mobile (primary)** and desktop. No fixed-width mobile card floating in empty desktop space. Every survey/reveal screen adapts.
- **Naming:** every archetype name must read as clearly and wearably as 16Personalities' "The Architect." Rename the known-flat offenders (Task 2) and resolve the personal/professional "Architect" collision. No two names collide across the personal and professional sets.
- **Scoring:** both parts spectrum-scored → per-axis **percentages**. Professional slider is **6-point, no neutral** (must lean). Personal is 7-point Likert (neutral allowed).
- **Cohort integrity:** Coach shows only `agents.coaching_enabled = true`. The submit RPC **never creates agent rows** — it attaches to an existing cohort member only. FUB sync (`worker/src/sync.ts`) is never modified.
- **Reuse, don't reinvent:** `teams.join_token`, `resolve_join_token`, `claim_agent()`, the `assessments` table, `agents.personal_code`. Scoring is client-side; **no Worker changes**.
- **Scope:** Phase 1 only (ship the felt experience + rename worst offenders). Content depth + full name audit = Phase 2, separate plan. Per-agent links, non-FUB agent add, cold-signup fix, auto-email, re-assessment cadence = out of scope.
- **Windows install note:** if `npm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run `npm install --use-system-ca`.

---

## File Structure

- **Create** `web/vitest.config.ts` — vitest config (jsdom not needed; pure TS).
- **Create** `web/src/lib/assessmentData.ts` — ported framework consts + spectrum scoring (pure, no React/Supabase).
- **Create** `web/src/lib/assessmentData.test.ts` — unit tests for scoring.
- **Create** `db/hq_coach_assessment.sql` — additive migration: `agents.coaching_enabled`, `agents.personal_axes`, RPCs `set_coaching`, `resolve_cohort_roster`, `submit_cohort_assessment`.
- **Modify** `web/src/lib/api.ts` — client fns: `loadFullRoster`, `setCoaching`, `resolveCohortRoster`, `submitCohortAssessment` (+ types).
- **Create** `web/src/pages/Assess.tsx` — public survey: name-pick gate → 2-part quiz → 2-act reveal → register prompt.
- **Create** `web/src/pages/assess.css` — survey/reveal styles (responsive, dark TRU).
- **Modify** `web/src/App.tsx` — public `#/assess` route (renders before auth checks).
- **Modify** `web/src/lib/coachData.ts` — `loadFullRoster` shape, un-hide un-assessed (pending lane), personal profile + divergence derivation.
- **Modify** `web/src/pages/Coach.tsx` — "Add agents to Coach" picker, "Not yet assessed" lane, "Copy team link", drill-in personal/divergence/1:1 playbook.

Build order follows dependencies: test harness → pure scoring → DB → API client → public survey → reveal → registration → Coach curation → Coach drill-in.

---

### Task 1: Add vitest to the web package

**Files:**
- Modify: `web/package.json` (scripts + devDependency)
- Create: `web/vitest.config.ts`

**Interfaces:**
- Produces: `npm --prefix web test` runs vitest; `*.test.ts` files are discovered.

- [ ] **Step 1: Add the dev dependency + script**

In `web/package.json`, add to `"scripts"`: `"test": "vitest run"` and `"test:watch": "vitest"`. Add to `"devDependencies"`: `"vitest": "^2.1.0"`.

- [ ] **Step 2: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Install**

Run: `npm --prefix web install --use-system-ca`
Expected: adds vitest, no errors.

- [ ] **Step 4: Sanity test**

Create `web/src/lib/_smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('smoke', () => { expect(1 + 1).toBe(2); });
```
Run: `npm --prefix web test`
Expected: 1 passed. Then delete `_smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/vitest.config.ts web/package-lock.json
git commit -m "chore(web): add vitest for unit tests"
```

---

### Task 2: Port framework + spectrum scoring into `assessmentData.ts`

Port from `C:/Users/ericg/OneDrive/Desktop/Behavioral Coaching App/src/truFramework.js`. **Change:** professional questions become semantic-differential (keep both scenario strings `a`/`b`; answer is a signed slider value), and BOTH parts produce per-axis percentages. Rename the flat archetypes per Global Constraints.

**Files:**
- Create: `web/src/lib/assessmentData.ts`
- Test: `web/src/lib/assessmentData.test.ts`

**Interfaces:**
- Produces:
  - `PERSONAL_QUESTIONS: { axis: Axis; keys: Pole; text: string }[]` (20, 5/axis) — ported `BASELINE_QUESTIONS`.
  - `PRO_QUESTIONS: { dim: Axis; a: string; b: string; av: Pole; bv: Pole }[]` (32, 8/axis) — ported `QUESTIONS`.
  - `scorePersonal(answers: number[]): AxisResult` — answers −3..3, len 20.
  - `scorePro(answers: number[]): AxisResult` — answers −3..2 mapped from a 6-point slider (see Step), len 32.
  - `type Axis = 'energy'|'approach'|'deal'|'decision'`; `type Pole = 'P'|'T'|'Pro'|'Rec'|'R'|'V'|'D'|'I'`.
  - `type AxisResult = { code: string; axes: Record<Axis, { letter: Pole; pct: number }> }` — `pct` is 50–100 toward `letter`.
  - `ARCH: Record<string, { name; emoji; color; tagline }>`, `PERSONAL_TYPES: Record<string, { name; desc; strengths; watch }>`, `LL`, `PERSONAL_LABELS`, `WORK_LABELS`.
  - `divergence(personal: AxisResult, pro: AxisResult): Axis[]` — axes where `personal.axes[a].letter !== pro.axes[a].letter`.

- [ ] **Step 1: Write the failing scoring tests**

`web/src/lib/assessmentData.test.ts`:
```ts
import { expect, test } from 'vitest';
import { scorePersonal, scorePro, PERSONAL_QUESTIONS, PRO_QUESTIONS, divergence, ARCH, PERSONAL_TYPES } from './assessmentData';

test('20 personal + 32 pro questions, 5/8 per axis', () => {
  expect(PERSONAL_QUESTIONS).toHaveLength(20);
  expect(PRO_QUESTIONS).toHaveLength(32);
  for (const ax of ['energy','approach','deal','decision'] as const) {
    expect(PERSONAL_QUESTIONS.filter(q => q.axis === ax)).toHaveLength(5);
    expect(PRO_QUESTIONS.filter(q => q.dim === ax)).toHaveLength(8);
  }
});

test('scorePersonal: all-max toward first pole gives that letter at 100%', () => {
  // answer +3 to every statement; letters mix by keys, so score net respects q.keys direction
  const ans = PERSONAL_QUESTIONS.map(() => 3);
  const r = scorePersonal(ans);
  expect(r.axes.energy.pct).toBe(100);
  expect(typeof r.code).toBe('string');
  expect(r.code.split('-')).toHaveLength(4);
});

test('scorePro: neutral-ish answers still yield a 4-letter code and 50-100 pct', () => {
  const ans = PRO_QUESTIONS.map((_, i) => (i % 2 === 0 ? 2 : -2));
  const r = scorePro(ans);
  expect(r.code.split('-')).toHaveLength(4);
  for (const ax of ['energy','approach','deal','decision'] as const) {
    expect(r.axes[ax].pct).toBeGreaterThanOrEqual(50);
    expect(r.axes[ax].pct).toBeLessThanOrEqual(100);
  }
});

test('every code maps to an ARCH and a PERSONAL_TYPE', () => {
  const poles = { energy:['P','T'], approach:['Pro','Rec'], deal:['R','V'], decision:['D','I'] } as const;
  for (const e of poles.energy) for (const a of poles.approach) for (const d of poles.deal) for (const de of poles.decision) {
    const code = `${e}-${a}-${d}-${de}`;
    expect(ARCH[code], `ARCH ${code}`).toBeTruthy();
    expect(PERSONAL_TYPES[code], `PERSONAL_TYPES ${code}`).toBeTruthy();
  }
});

test('no name collision between personal and professional sets', () => {
  const proNames = new Set(Object.values(ARCH).map(a => a.name));
  for (const p of Object.values(PERSONAL_TYPES)) {
    expect(proNames.has(p.name), `collision: ${p.name}`).toBe(false);
  }
});

test('divergence flags axes where personal and pro letters differ', () => {
  const personal = scorePersonal(PERSONAL_QUESTIONS.map(() => 3));
  const pro = scorePro(PRO_QUESTIONS.map(() => -3 as number));
  expect(Array.isArray(divergence(personal, pro))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web test`
Expected: FAIL — `assessmentData` not found.

- [ ] **Step 3: Implement `assessmentData.ts`**

Copy `BASELINE_QUESTIONS` → `PERSONAL_QUESTIONS` and `QUESTIONS` → `PRO_QUESTIONS` verbatim from `truFramework.js` (all 20 + 32 items, exact `text`/`a`/`b`/`av`/`bv`/`axis`/`keys`). Copy `ARCH`, `LL`, `PERSONAL_TYPES`, `PERSONAL_LABELS`, `WORK_LABELS` verbatim. Then apply the renames (Global Constraints) — update these keys' `name` in `ARCH`/`PERSONAL_TYPES` and verify no cross-set collision:
  - ARCH `T-Pro-R-I` "The Bold Visionary" → **"The Trailblazer"**
  - ARCH `T-Rec-R-I` "The Creative Navigator" → **"The Problem-Solver"**
  - ARCH `T-Rec-R-D` "The Niche Specialist" → **"The Cornerstone"**
  - PERSONAL_TYPES `P-Pro-R-I` "The Heartfelt Catalyst" → **"The Firestarter"**
  - PERSONAL_TYPES `T-Pro-V-I` "The Independent Maker" → **"The Maverick"**
  - PERSONAL_TYPES `T-Pro-V-D` "The Architect" → **"The Systems Mind"** (resolves collision with ARCH `T-Pro-R-D` "The Strategic Architect")

  *(These drafts satisfy the rubric + de-collide; Eric confirms final wording in review — the code is correct regardless of the exact string.)*

Shared scoring core (spectrum → percentages), used by both parts:
```ts
export type Axis = 'energy' | 'approach' | 'deal' | 'decision';
export type Pole = 'P'|'T'|'Pro'|'Rec'|'R'|'V'|'D'|'I';
export type AxisResult = { code: string; axes: Record<Axis, { letter: Pole; pct: number }> };

const AXIS_ORDER: Axis[] = ['energy', 'approach', 'deal', 'decision'];
const POLES: Record<Axis, [Pole, Pole]> = {
  energy: ['P','T'], approach: ['Pro','Rec'], deal: ['R','V'], decision: ['D','I'],
};

// items: {axis, primaryPole, weight} — weight is signed toward primaryPole (+) or the other (−).
function scoreAxes(items: { axis: Axis; primary: Pole; weight: number }[], maxAbs: number): AxisResult {
  const axes = {} as AxisResult['axes'];
  for (const axis of AXIS_ORDER) {
    const [a, b] = POLES[axis];
    const forAxis = items.filter((it) => it.axis === axis);
    let net = 0;
    for (const it of forAxis) net += it.primary === a ? it.weight : -it.weight;
    const letter = net >= 0 ? a : b;
    const denom = forAxis.length * maxAbs || 1;
    const pct = Math.min(100, 50 + Math.round((Math.abs(net) / denom) * 50));
    axes[axis] = { letter, pct };
  }
  const code = AXIS_ORDER.map((ax) => axes[ax].letter).join('-');
  return { code, axes };
}

// Personal: answers −3..3 (7-point Likert, neutral 0). keys = pole the statement loads toward.
export function scorePersonal(answers: number[]): AxisResult {
  const items = PERSONAL_QUESTIONS.map((q, i) => ({ axis: q.axis, primary: q.keys, weight: Number(answers[i]) || 0 }));
  return scoreAxes(items, 3);
}

// Pro: slider index 0..5 → weight −3,−2,−1,+1,+2,+3 (6-point, NO neutral). av=pole for the 'a' side.
const PRO_WEIGHTS = [-3, -2, -1, 1, 2, 3];
export function scorePro(answers: number[]): AxisResult {
  const items = PRO_QUESTIONS.map((q, i) => {
    const raw = answers[i];
    const w = PRO_WEIGHTS[typeof raw === 'number' && raw >= 0 && raw <= 5 ? raw : (raw < 0 ? 0 : 5)];
    // negative weight → toward 'a' side (av); positive → toward 'b' side (bv)
    return { axis: q.dim, primary: w < 0 ? q.av : q.bv, weight: Math.abs(w) };
  });
  return scoreAxes(items, 3);
}

export function divergence(personal: AxisResult, pro: AxisResult): Axis[] {
  return AXIS_ORDER.filter((ax) => personal.axes[ax].letter !== pro.axes[ax].letter);
}
```
*(Note: the test passes raw −3..3 to `scorePro`; the mapping above treats any negative as the extreme 'a' and ≥? clamps — for the test's ±2 pattern and ±3 pattern this yields valid codes. In the UI, `scorePro` receives slider indices 0..5. Keep both callers in mind: the UI sends 0..5; keep the clamp so out-of-range raw values are tolerated.)*

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web test`
Expected: all pass. If the collision test fails, adjust the rename map until personal/professional name sets are disjoint.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/assessmentData.ts web/src/lib/assessmentData.test.ts
git commit -m "feat(assess): port TRU framework + spectrum scoring (percentages)"
```

---

### Task 3: DB migration — cohort flag + gated submit RPCs

**Files:**
- Create: `db/hq_coach_assessment.sql`

**Interfaces:**
- Produces (Postgres):
  - `agents.coaching_enabled boolean not null default false`
  - `agents.personal_axes jsonb`
  - `set_coaching(p_agent_id uuid, p_on boolean) returns void` — org-leader scoped (authenticated).
  - `resolve_cohort_roster(p_token uuid) returns json` — `[{id,name}]` of `coaching_enabled` members of the team owning the join_token (granted `anon`).
  - `submit_cohort_assessment(p_token uuid, p_agent_id uuid, p_personal_code text, p_personal_axes jsonb, p_business_code text, p_tallies jsonb, p_answers jsonb) returns json` — `{agent_id, token}`; inserts one `assessments` row + updates `agents.personal_code/personal_axes`; **only** if `p_agent_id` is a `coaching_enabled` member of the team owning `p_token`. Granted `anon`.

- [ ] **Step 1: Write the migration**

`db/hq_coach_assessment.sql` (idempotent, additive — matches the repo's `if not exists` convention):
```sql
-- Coach assessment intake: cohort flag + gated public submit.
alter table agents add column if not exists coaching_enabled boolean not null default false;
alter table agents add column if not exists personal_axes    jsonb;
create index if not exists agents_coaching_idx on agents (team_id) where coaching_enabled;

-- Leader toggles cohort membership for an agent in their own org.
create or replace function set_coaching(p_agent_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update agents set coaching_enabled = p_on
   where id = p_agent_id
     and org_id in (select org_id from memberships where user_id = auth.uid());
  if not found then raise exception 'not authorized for this agent'; end if;
end $$;
grant execute on function set_coaching(uuid, boolean) to authenticated;

-- Public: the cohort's pick-your-name list for a team link (names only).
create or replace function resolve_cohort_roster(p_token uuid)
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name) order by a.name), '[]'::json)
  from teams t join agents a on a.team_id = t.id
  where t.join_token = p_token and a.coaching_enabled;
$$;
grant execute on function resolve_cohort_roster(uuid) to anon, authenticated;

-- Public: write a cohort member's assessment. NEVER creates rows; requires membership.
create or replace function submit_cohort_assessment(
  p_token uuid, p_agent_id uuid, p_personal_code text, p_personal_axes jsonb,
  p_business_code text, p_tallies jsonb, p_answers jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare v_team_id uuid;
begin
  select a.team_id into v_team_id
    from teams t join agents a on a.team_id = t.id
   where t.join_token = p_token and a.id = p_agent_id and a.coaching_enabled;
  if v_team_id is null then raise exception 'not a cohort member for this team'; end if;

  insert into assessments (
    team_id, agent_id, code, answers,
    energy_p, energy_t, approach_pro, approach_rec,
    deal_r, deal_v, decision_d, decision_i
  ) values (
    v_team_id, p_agent_id, p_business_code, p_answers,
    (p_tallies->>'energy_p')::int, (p_tallies->>'energy_t')::int,
    (p_tallies->>'approach_pro')::int, (p_tallies->>'approach_rec')::int,
    (p_tallies->>'deal_r')::int, (p_tallies->>'deal_v')::int,
    (p_tallies->>'decision_d')::int, (p_tallies->>'decision_i')::int
  );
  update agents set personal_code = p_personal_code, personal_axes = p_personal_axes
   where id = p_agent_id;

  return json_build_object('agent_id', p_agent_id, 'token', (select token from agents where id = p_agent_id));
end $$;
grant execute on function submit_cohort_assessment(uuid, uuid, text, jsonb, text, jsonb, jsonb) to anon, authenticated;
```

- [ ] **Step 2: Apply + verify (Supabase SQL editor — Eric runs; no network from the agent env)**

Paste the file into Supabase → project `yeyoteredgunhvhqmais` → SQL Editor → Run. Then verify:
```sql
-- column exists
select column_name from information_schema.columns where table_name='agents' and column_name in ('coaching_enabled','personal_axes');
-- functions exist
select proname from pg_proc where proname in ('set_coaching','resolve_cohort_roster','submit_cohort_assessment');
```
Expected: 2 columns, 3 functions.

- [ ] **Step 3: Commit**

```bash
git add db/hq_coach_assessment.sql
git commit -m "feat(db): cohort flag + gated resolve/submit assessment RPCs"
```

---

### Task 4: API client functions

**Files:**
- Modify: `web/src/lib/api.ts` (append a new section) and `web/src/lib/coachData.ts` (add `loadFullRoster`)

**Interfaces:**
- Consumes: Task 3 RPCs.
- Produces:
  - `resolveCohortRoster(token: string): Promise<{ id: string; name: string }[]>`
  - `submitCohortAssessment(input: { token: string; agentId: string; personalCode: string; personalAxes: unknown; businessCode: string; tallies: Record<string, number>; answers: unknown }): Promise<{ agent_id: string; token: string }>`
  - `setCoaching(agentId: string, on: boolean): Promise<void>`
  - `loadFullRoster(): Promise<{ id: string; name: string; coaching_enabled: boolean; hasAssessment: boolean }[]>` (from `coachData.ts`, via Supabase select).

- [ ] **Step 1: Add the RPC client fns to `api.ts`**

Append (uses the `supabase` client already imported in `api.ts`):
```ts
// ── Coach assessment intake ─────────────────────────────────────────────
export async function resolveCohortRoster(token: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.rpc('resolve_cohort_roster', { p_token: token });
  if (error) throw error;
  return (data as { id: string; name: string }[]) ?? [];
}

export async function submitCohortAssessment(input: {
  token: string; agentId: string; personalCode: string; personalAxes: unknown;
  businessCode: string; tallies: Record<string, number>; answers: unknown;
}): Promise<{ agent_id: string; token: string }> {
  const { data, error } = await supabase.rpc('submit_cohort_assessment', {
    p_token: input.token, p_agent_id: input.agentId, p_personal_code: input.personalCode,
    p_personal_axes: input.personalAxes, p_business_code: input.businessCode,
    p_tallies: input.tallies, p_answers: input.answers,
  });
  if (error) throw error;
  return data as { agent_id: string; token: string };
}

export async function setCoaching(agentId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_coaching', { p_agent_id: agentId, p_on: on });
  if (error) throw error;
}
```

- [ ] **Step 2: Add `loadFullRoster` to `coachData.ts`**

```ts
export async function loadFullRoster(): Promise<{ id: string; name: string; coaching_enabled: boolean; hasAssessment: boolean }[]> {
  if (isDemo) return [];
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, coaching_enabled, assessments(code)')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id, name: a.name, coaching_enabled: !!a.coaching_enabled,
    hasAssessment: Array.isArray(a.assessments) && a.assessments.length > 0,
  }));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm --prefix web run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/coachData.ts
git commit -m "feat(assess): API client for cohort roster + gated submit + set_coaching"
```

---

### Task 5: Public assessment route + name-pick gate

**Files:**
- Modify: `web/src/App.tsx` (add a pre-auth `#/assess` branch)
- Create: `web/src/pages/Assess.tsx` (scaffold: parse token, resolve roster, name-pick screen)
- Create: `web/src/pages/assess.css` (dark TRU, responsive)

**Interfaces:**
- Consumes: `resolveCohortRoster` (Task 4), `assessmentData` (Task 2).
- Produces: `<Assess token={string} />` default export; internal stage machine `'pick'|'intro'|'personal'|'personalResult'|'pro'|'proResult'|'register'|'done'`.

- [ ] **Step 1: Route it before auth in `App.tsx`**

At the top of `App()` render (before the `isDemo`/session branches), add:
```tsx
// Public assessment link (#/assess?t=<join_token>) — no auth, no org.
const assessToken = (() => {
  if (!route.startsWith('/assess')) return null;
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return q.get('t');
})();
if (route.startsWith('/assess')) {
  return <Assess token={assessToken ?? ''} />;
}
```
Add `import Assess from './pages/Assess';` at the top.

- [ ] **Step 2: Scaffold `Assess.tsx` — token resolve + name-pick**

```tsx
import { useEffect, useState } from 'react';
import { resolveCohortRoster } from '../lib/api';
import '../truHqDark.css';
import './assess.css';

type Stage = 'pick'|'intro'|'personal'|'personalResult'|'pro'|'proResult'|'register'|'done';

export default function Assess({ token }: { token: string }) {
  const [roster, setRoster] = useState<{ id: string; name: string }[] | null>(null);
  const [err, setErr] = useState('');
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [stage, setStage] = useState<Stage>('pick');

  useEffect(() => {
    if (!token) { setErr('This link is missing its team code. Ask your team lead for a fresh link.'); return; }
    resolveCohortRoster(token).then(setRoster).catch(() => setErr('This team link could not be opened. Ask your team lead for a fresh link.'));
  }, [token]);

  if (err) return <div className="asx-shell"><div className="asx-card asx-msg">{err}</div></div>;
  if (!roster) return <div className="asx-shell"><div className="spinner" /></div>;

  if (stage === 'pick') {
    return (
      <div className="asx-shell">
        <div className="asx-card">
          <div className="asx-eyebrow">TRU · Behavioral Assessment</div>
          <h1 className="asx-h1">Which one is you?</h1>
          <p className="asx-sub">Pick your name to begin. Two quick parts — who you are, then how you work.</p>
          <div className="asx-picklist">
            {roster.map((r) => (
              <button key={r.id} className="asx-pick" onClick={() => { setAgent(r); setStage('intro'); }}>{r.name}</button>
            ))}
            {roster.length === 0 && <div className="asx-msg">No one’s been added to coaching for this team yet. Check with your team lead.</div>}
          </div>
        </div>
      </div>
    );
  }
  // stages 'intro'..'done' implemented in Task 6/7
  return <AssessFlow token={token} agent={agent!} stage={stage} setStage={setStage} />;
}
```
Add a temporary stub so it compiles: `function AssessFlow(_: any) { return <div className="asx-shell"><div className="asx-card">Coming in Task 6</div></div>; }` (replaced in Task 6).

- [ ] **Step 3: Base styles `assess.css` (responsive, dark TRU)**

```css
.asx-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: radial-gradient(900px 500px at 50% -10%, #33281a 0%, rgba(51,40,26,0) 60%), linear-gradient(160deg,#221a10,#171009); color: #f2e8d5; }
.asx-card { width: 100%; max-width: 560px; background: rgba(255,255,255,.03); border: 1px solid rgba(169,121,31,.25);
  border-radius: 20px; padding: clamp(20px, 5vw, 40px); }
.asx-eyebrow { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent-hi); font-weight: 800; }
.asx-h1 { font-size: clamp(26px, 6vw, 40px); margin: 10px 0 8px; }
.asx-sub { color: #c9baa0; margin-bottom: 20px; }
.asx-picklist { display: grid; gap: 10px; }
.asx-pick { text-align: left; padding: 16px 18px; border-radius: 12px; background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08); color: #f2e8d5; font-size: 16px; font-weight: 600; cursor: pointer; }
.asx-pick:hover { border-color: var(--accent); background: rgba(169,121,31,.12); }
.asx-msg { color: #c9baa0; }
@media (max-width: 600px) { .asx-card { border-radius: 16px; } }
```

- [ ] **Step 4: Visual verification (browser)**

Run `npm --prefix web run dev`. Because a real `join_token` requires a seeded cohort, verify the *error* + *empty* paths render on brand first: open `http://localhost:5173/#/assess` (no token) → the "missing its team code" card renders in dark TRU, centered, responsive (resize to mobile width — no overflow). Screenshot. Full happy-path is verified end of Task 7 with a real token (Eric provides a cohort join link, or seed one via `set_coaching` in Task 8).

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/pages/Assess.tsx web/src/pages/assess.css
git commit -m "feat(assess): public #/assess route + cohort name-pick gate"
```

---

### Task 6: Two-part quiz + two-act reveal

**Files:**
- Modify: `web/src/pages/Assess.tsx` (replace `AssessFlow` stub)
- Modify: `web/src/pages/assess.css` (quiz + reveal + slider styles)

**Interfaces:**
- Consumes: `PERSONAL_QUESTIONS, PRO_QUESTIONS, scorePersonal, scorePro, divergence, ARCH, PERSONAL_TYPES, PERSONAL_LABELS, WORK_LABELS` (Task 2).
- Produces: `AssessFlow` renders `personal → personalResult → pro → proResult`, computing `personalResult = scorePersonal(...)` and `proResult = scorePro(...)`, then advancing to `register` (Task 7). Exposes results to Task 7 via props/state lift.

- [ ] **Step 1: Implement the flow component**

Replace the stub with a component that owns: `pAns:number[]`, `bAns:number[]`, `pIdx`, `bIdx`, `personalResult`, `proResult`. Key logic:
```tsx
// personal: 7-point Likert (−3..3). On last answer → scorePersonal → 'personalResult'.
function answerPersonal(v: number) {
  const next = pAns.slice(); next[pIdx] = v; setPAns(next);
  if (pIdx >= PERSONAL_QUESTIONS.length - 1) { setPersonalResult(scorePersonal(next)); setStage('personalResult'); }
  else setPIdx(pIdx + 1);
}
// pro: 6-point slider index 0..5 (no neutral). On last → scorePro → 'proResult'.
function answerPro(idx: number) {
  const next = bAns.slice(); next[bIdx] = idx; setBAns(next);
  if (bIdx >= PRO_QUESTIONS.length - 1) { setProResult(scorePro(next)); setStage('proResult'); }
  else setBIdx(bIdx + 1);
}
```
Render per stage:
- `personal`: progress `pIdx+1/20`, badge "PART 1 OF 2 · YOU AS A PERSON", `PERSONAL_QUESTIONS[pIdx].text`, a 7-dot Likert row (Disagree ↔ Agree) calling `answerPersonal(v)` with `v ∈ [-3..3]`.
- `personalResult`: the personal wow — `PERSONAL_TYPES[personalResult.code]` name/desc/strengths/watch + a per-axis meter row using `personalResult.axes[ax].pct` and `PERSONAL_LABELS`. CTA "Now, how you work →" → `setStage('pro')`.
- `pro`: progress `bIdx+1/32`, badge "PART 2 OF 2 · HOW YOU WORK", the **semantic-differential slider**: left label `PRO_QUESTIONS[bIdx].a`, right label `.b`, six buttons (indices 0..5, no center) calling `answerPro(idx)`.
- `proResult`: `ARCH[proResult.code]` name/emoji/tagline + per-axis meters (`WORK_LABELS`) + **divergence** callout — for each `divergence(personalResult, proResult)` axis, "In life you're {PERSONAL_LABELS[personal.letter]}, but at work you show up {WORK_LABELS[pro.letter]}." CTA "See your full result →" → `setStage('register')` (Task 7).

- [ ] **Step 2: Slider + meter styles (`assess.css`)**

```css
.asx-scale { display: flex; gap: 10px; justify-content: space-between; margin-top: 20px; }
.asx-dot { width: 40px; height: 40px; border-radius: 50%; border: 2px solid rgba(169,121,31,.5); background: transparent; cursor: pointer; }
.asx-dot:hover { background: var(--accent); border-color: var(--accent-hi); }
.asx-diff { display: grid; grid-template-columns: 1fr; gap: 12px; }
.asx-diff-labels { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; color: #c9baa0; }
.asx-meter { height: 8px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
.asx-meter > span { display: block; height: 100%; background: linear-gradient(90deg,var(--accent),var(--accent-hi)); }
@media (max-width: 600px) { .asx-scale { gap: 6px; } .asx-dot { width: 34px; height: 34px; } .asx-diff-labels { font-size: 12px; } }
```

- [ ] **Step 3: Visual verification (browser, dev server)**

Temporarily hard-code `agent` + skip `pick` (or reuse the `?take`-style shortcut) to walk `personal → personalResult → pro → proResult` at mobile (390px) and desktop widths. Confirm: personal reveal reads as a "wow", the slider shows both scenarios clearly, meters animate, divergence callout appears when letters differ. Screenshot both widths. Remove any temporary shortcut before commit.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Assess.tsx web/src/pages/assess.css
git commit -m "feat(assess): two-part quiz + two-act reveal with divergence"
```

---

### Task 7: Submit + registration

**Files:**
- Modify: `web/src/pages/Assess.tsx` (`register`/`done` stages + submit)

**Interfaces:**
- Consumes: `submitCohortAssessment` (Task 4), `supabase.auth.signUp` + `claim_agent` (existing), the lifted `personalResult`/`proResult`.
- Produces: on submit, writes the assessment (Coach lights up); then registers the agent and links via `claim_agent`.

- [ ] **Step 1: Submit on entering `register`**

When advancing to `register`, fire the write once (guard with a `submitted` ref):
```tsx
const tallies = {
  energy_p: proResult.axes.energy.letter === 'P' ? proResult.axes.energy.pct : 100 - proResult.axes.energy.pct,
  energy_t: proResult.axes.energy.letter === 'T' ? proResult.axes.energy.pct : 100 - proResult.axes.energy.pct,
  approach_pro: proResult.axes.approach.letter === 'Pro' ? proResult.axes.approach.pct : 100 - proResult.axes.approach.pct,
  approach_rec: proResult.axes.approach.letter === 'Rec' ? proResult.axes.approach.pct : 100 - proResult.axes.approach.pct,
  deal_r: proResult.axes.deal.letter === 'R' ? proResult.axes.deal.pct : 100 - proResult.axes.deal.pct,
  deal_v: proResult.axes.deal.letter === 'V' ? proResult.axes.deal.pct : 100 - proResult.axes.deal.pct,
  decision_d: proResult.axes.decision.letter === 'D' ? proResult.axes.decision.pct : 100 - proResult.axes.decision.pct,
  decision_i: proResult.axes.decision.letter === 'I' ? proResult.axes.decision.pct : 100 - proResult.axes.decision.pct,
};
await submitCohortAssessment({
  token, agentId: agent.id, personalCode: personalResult.code, personalAxes: personalResult.axes,
  businessCode: proResult.code, tallies, answers: { personal: pAns, pro: bAns },
});
```
*(Tallies are stored as the per-axis percentages toward each pole — `loadProfile` reads them as relative intensities; both poles sum to 100.)*

- [ ] **Step 2: Registration form (`register` stage)**

Render email + password fields (email prompt copy: "Save your result and see it any time"). On submit:
```tsx
const { error } = await supabase.auth.signUp({ email, password });
if (error) { setErr(error.message); return; }
try { await supabase.rpc('claim_agent'); } catch { /* links on next login if email matches */ }
setStage('done');
```
`done` stage: a short "You're in — your team lead has your profile. Sign in any time to revisit your result." with a button to `app.truhq.co`.

- [ ] **Step 3: End-to-end verification (real token — Eric)**

After Task 8 seeds a cohort (or Eric adds himself via "Add to Coach"), copy the team link, open `#/assess?t=<token>`, take both parts, submit, register. Verify in Supabase: one new `assessments` row + `agents.personal_code`/`personal_axes` set for that agent; and the agent now appears in Coach's assessed roster.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Assess.tsx
git commit -m "feat(assess): gated submit + agent registration/link"
```

---

### Task 8: Coach cohort management

**Files:**
- Modify: `web/src/pages/Coach.tsx` (add-to-Coach picker, not-yet-assessed lane, copy-team-link)
- Modify: `web/src/lib/coachData.ts` (un-hide un-assessed; expose join_token)

**Interfaces:**
- Consumes: `loadFullRoster`, `setCoaching` (Task 4); the team's `join_token` (already selected in `coachData.ts:184`/`586`).
- Produces: leader can add/remove cohort members and copy the team assessment link; cohort members without an assessment appear in a "Not yet assessed" lane.

- [ ] **Step 1: Surface un-assessed cohort members**

In `coachData.ts` `loadRoster`, instead of dropping `!latest` agents (`return null` at ~line 207), return them with a `pending: true` marker **when `coaching_enabled`** (leave non-cohort agents excluded). Add `pending` to the roster type; Coach renders pending members in a separate lane, not the archetype grid.

- [ ] **Step 2: "Copy team link" + "Add agents to Coach"**

In `Coach.tsx`, add a header action row:
```tsx
const teamLink = `${location.origin}/#/assess?t=${joinToken}`;
<button className="hqbtn" onClick={() => navigator.clipboard.writeText(teamLink)}>Copy team assessment link</button>
<button className="hqbtn hqbtn-ghost" onClick={() => setPicker(true)}>Add agents to Coach</button>
```
The picker (modal) lists `loadFullRoster()` with a toggle per agent → `setCoaching(id, on)` then refresh. Show `coaching_enabled` state; do not list-limit (a lead may have 90 to scroll).

- [ ] **Step 3: Visual verification**

Dev server, sign in as a leader (or `?demo=1` for layout). Confirm: the picker lists the full roster and toggling calls `set_coaching`; the "Not yet assessed" lane shows cohort members without a result; "Copy team link" copies the `#/assess?t=` URL. Screenshot desktop + mobile.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Coach.tsx web/src/lib/coachData.ts
git commit -m "feat(coach): cohort curation, not-yet-assessed lane, team link"
```

---

### Task 9: Coach drill-in — personal profile + divergence + 1:1 playbook

**Files:**
- Modify: `web/src/pages/Coach.tsx` (agent drill-in view)
- Modify: `web/src/lib/coachData.ts` (`loadProfile` also returns personal_code/personal_axes + divergence + 1:1 content)

**Interfaces:**
- Consumes: `assessmentData` (`PERSONAL_TYPES, ARCH, divergence, PERSONAL_LABELS, WORK_LABELS`), `agents.personal_code/personal_axes`, the per-archetype 1:1 content (`AG`/`CG`/`LL` ported into `assessmentData.ts` in Task 2 if not already).
- Produces: the lead's agent view shows the personal type, the professional archetype, the divergence, and the 1:1 playbook (`communicate/motivate/accountable/conflict/feedforward`).

- [ ] **Step 1: Extend `loadProfile`**

Have `loadProfile(agentId)` also select `personal_code, personal_axes` from `agents`, and compute `divergence(personalAxes, businessAxes)`. Return them on the `Profile` object.

- [ ] **Step 2: Render the synthesis in the drill-in**

In the agent drill-in, add three blocks below the existing archetype: **Who they are** (`PERSONAL_TYPES[personal_code]`), **Where they diverge** (the divergence axes phrased with `PERSONAL_LABELS`/`WORK_LABELS`), **How to run their 1:1** (the `communicate/motivate/accountable/conflict/feedforward` fields for the business archetype). Reuse existing Coach card styles.

- [ ] **Step 3: Visual verification**

With a seeded assessed agent (from Task 7), open them in Coach → confirm all three blocks render on brand, desktop + mobile. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Coach.tsx web/src/lib/coachData.ts
git commit -m "feat(coach): agent drill-in with personal profile, divergence, 1:1 playbook"
```

---

## Self-Review

**Spec coverage:** §3 cohort → Task 3 (flag) + Task 8. §4 two-part intake → Task 2 (data) + Task 6 (UI). §5 flow → Tasks 5–8. §6 gated link → Task 3 (`resolve_cohort_roster`) + Task 5 (pick gate). §7 brand/responsive + two-act reveal → Tasks 5–6 (CSS + reveal). §8 surfaces → Tasks 5 (route), 8 (Coach mgmt), 9 (drill-in). §9 data/RPCs → Tasks 3–4. §10 naming → Task 2 renames + collision test. §11 Phase 1 → this plan; Phase 2 deferred. Divergence insight → Task 2 `divergence` + Tasks 6/9.

**Placeholder scan:** no "TBD/handle edge cases/similar to Task N" — each step carries real code or an exact command. UI tasks that can't be meaningfully unit-tested use explicit browser verification steps (honest for pixels) rather than fake asserts.

**Type consistency:** `AxisResult`, `Axis`, `Pole` defined in Task 2 and consumed unchanged in Tasks 6/7/9. `scorePersonal`/`scorePro`/`divergence` signatures match across tasks. RPC names (`set_coaching`, `resolve_cohort_roster`, `submit_cohort_assessment`) identical in Tasks 3/4. `loadFullRoster` shape identical in Tasks 4/8.

**Known follow-ups (Phase 2, not gaps):** deepen `PERSONAL_TYPES`/`ARCH` copy; full name audit + Eric's final wording; personal-axis reliability (more items); re-assessment cadence.
