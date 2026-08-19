# Agent Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an invited agent a real arrival — one front door, a mandatory assessment, then a Home / Coach / Rep app that tells them what to do today.

**Architecture:** The agent branch of `App.tsx` currently renders `AgentCourse` and nothing else. This plan puts a shell with three tabs in front of it, adds an auth-based agent-home RPC to replace the dead token-based one, gates everything behind the assessment, and closes the two extra entrances (self-serve signup at the end of the public assessment, and the legacy anon `/public/*` agent portal). All agent reads/writes go through SECURITY DEFINER RPCs keyed on `auth.uid()` — never raw table access, never a bearer token in a URL.

**Tech Stack:** React 18 + Vite (`web/`), Cloudflare Worker + TypeScript (`worker/`), Supabase Postgres with RLS (`db/*.sql`), vitest in both packages.

**Spec:** `docs/superpowers/specs/2026-08-18-agent-experience-design.md`

## Global Constraints

- **Branch:** work on `rep-training-library-wip`. Do not push to `main` without Eric's say-so.
- **Migrations:** apply through the Supabase MCP connector (`apply_migration`), never a CLI. Every `db/*.sql` file must be idempotent and re-runnable — follow the `create table if not exists` / `drop policy if exists` style already used throughout `db/`.
- **`checkin_leader` is dark to agents, forever.** Never select from it in any agent-facing code path or SECURITY DEFINER function. This is stated as a permanent contract at `db/hq_coach_1on1_structured.sql:52-56`.
- **The browser holds no database key.** All writes go through the Worker with the service role, or through a granted RPC. Never add a `VITE_SUPABASE_*` variable.
- **Any email sender must be `@truhq.co`** — Resend allows no other domain.
- **Builds need `web/.env.production`** (gitignored). A fresh checkout without it bakes a dead database URL into the bundle.
- **Tests:** `cd worker && npm test` and `cd web && npm test` (vitest). Typecheck with `npm run typecheck` in each.
- **Test style:** extract logic into a pure module and test that with a fake `Db` (see `worker/src/repLearner.test.ts`). Do not add a React testing framework — none exists here, and UI is verified by walking it.

---

## File Structure

**New:**
- `db/hq_agent_experience.sql` — auth-based agent RPCs, the `agent_done` column, `claim_agent` hardening, and the revokes that close the extra doors.
- `worker/src/agentHome.ts` — pure: assemble the agent home payload from a `Db`.
- `worker/src/agentHome.test.ts`
- `worker/src/agentRoutes.ts` — `/agent/*` authed routes (home, commitment toggle, assessment submit).
- `web/src/lib/agentStage.ts` — pure: which stage an agent is in (welcome / assessment / app).
- `web/src/lib/agentStage.test.ts`
- `web/src/lib/agentPace.ts` — pure: pacing math over commitments.
- `web/src/lib/agentPace.test.ts`
- `web/src/pages/AgentShell.tsx` — the tabbed shell (Home / Coach / Rep) + sign out.
- `web/src/pages/AgentHome.tsx` — commitments, pacing, what's next.
- `web/src/pages/AgentCoach.tsx` — assessment result + 1:1 recap.
- `web/src/pages/AgentWelcome.tsx` — the one-time walkthrough.

**Modified:**
- `web/src/App.tsx:154-158` — the agent branch renders `AgentShell`, not `AgentCourse`.
- `web/src/pages/AgentCourse.tsx` — keeps the shelf/lesson/quiz; loses its own header and its `MyOneOnOnes` block (both move up into the shell and the Coach tab).
- `web/src/pages/Assess.tsx` — gains an in-account mode; loses `RegisterFlow`'s `signUp`.
- `web/src/lib/api.ts` — new `/agent/*` calls; `actAsAgent` alongside the existing `actAs`.
- `worker/src/index.ts` — mount `handleAgentRoutes`.
- `worker/src/publicRoutes.ts` — remove the dead legacy actions.
- `web/src/pages/Home.tsx` or `Rep.tsx` — the admin "view as agent" picker (Task 1 determines which).

## Spec requirements with no task, because they already hold

Do not "implement" these. Verify them once while walking the app, and if one turns out not to hold, raise it rather than absorbing it silently into a neighbouring task.

- **§3.2 — password-only signup.** `SetPassword` already asks for nothing but a password, and `App.tsx:141-149` already routes an invite token to it. There is nothing to add; the requirement is to *not* add a profile form.
- **§3.7 — decks read in-app, no downloads.** `LessonCard` already supports `t:'slide'` with `deck`/`slide`, rendered by `SlideDeck.tsx`, and no download path exists. The requirement is to keep it that way.
- **§3.7 — homework quizzes deferred.** `gradeQuiz()` and `rep_questions_public` stay exactly as they are. No new quiz work in this plan.

---

### Task 1: View as agent

Eric has never seen the agent view. Nothing later in this plan can be judged until he can. The Worker side already works — `/auth/act-as` resolves any email and only requires the caller to be in `admins` — so this task is a picker and a guard.

**Files:**
- Modify: `web/src/lib/api.ts` (add `actAsAgent`)
- Modify: `worker/src/authRoutes.ts:359-417` (refuse agents with no auth user)
- Modify: `web/src/pages/Rep.tsx` (a "View as agent" control on each roster row)
- Test: `worker/src/authRoutes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `actAsAgent(email: string): Promise<void>` in `web/src/lib/api.ts` — same shape as the existing `actAs(email)`.

- [x] **Step 1: Write the failing test**

In `worker/src/authRoutes.test.ts`, alongside the existing act-as describe block:

```ts
it('refuses to act as someone who has never accepted their invite', async () => {
  const sid = await signedInAdmin();          // existing helper in this file
  const res = await post('/auth/act-as', { email: 'never-logged-in@team.com' },
    { cookie: `${COOKIE_NAME}=${sid}` });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/has not set up their account/i);
});
```

Wire the fake so `generate_link` reports the user did not previously exist. If the existing fake has no such switch, add one keyed on the email above.

- [x] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/authRoutes.test.ts -t "never accepted"`
Expected: FAIL — currently returns 200 and silently creates an auth user.

- [x] **Step 3: Implement the guard**

In `worker/src/authRoutes.ts`, before the `generate_link` call in `/auth/act-as`, look the user up and refuse if absent:

```ts
const userRes = await fetch(
  `${rest}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
  { headers: serviceHeaders },
);
const found = userRes.ok
  ? ((await userRes.json()) as { users?: Array<{ email?: string }> }).users ?? []
  : [];
if (!found.some((u) => (u.email ?? '').toLowerCase() === email)) {
  return json({ error: 'That person has not set up their account yet.' }, 409, cors);
}
```

This matters beyond tidiness: without it, viewing as an un-invited agent creates their auth user as a side effect, and `claim_agent` would then bind their row to a session nobody asked for.

- [x] **Step 4: Run the test and the suite** — 288 passed

Run: `cd worker && npm test`
Expected: PASS, no regressions.

- [x] **Step 5: Add the client call** — NOT ADDED. `adminActAs(email)` (api.ts:829) already does exactly this and already surfaces the Worker's 409 text, so a second function would have been a duplicate. The picker calls it directly.

In `web/src/lib/api.ts`, next to the existing `actAs` import and wrapper:

```ts
/** Admin: enter an agent's session to see exactly what they see. Exit via adminReturn(). */
export async function actAsAgent(email: string): Promise<void> {
  await actAs(email);
  window.location.href = '/';
}
```

- [x] **Step 6: Add the picker** — `ViewAsCell` in Rep.tsx, gated on `adminLeaders() !== null` (the same admins table `/auth/act-as` checks), disabled when the agent has no auth account.

In `web/src/pages/Rep.tsx`, on each roster row, render a `View as` button when the viewer is a platform admin (the same condition already used to show admin-only controls in that file). Wire it to `actAsAgent(agent.email)`. Disable it with the tooltip "Hasn't set up their account yet" when the agent has no `auth_id`.

Leads do not get this control — admins only, per spec §3.9.

- [ ] **Step 7: Verify by hand — NEEDS ERIC, after deploy**

Sign in as Eric, open Rep, click View as on an agent who has accepted their invite. Confirm you land in the agent view and that the existing "Exit" control returns you. Write down what you see — that observation is the baseline everything below is measured against.

- [x] **Step 8: Commit**

```bash
git add worker/src/authRoutes.ts worker/src/authRoutes.test.ts web/src/lib/api.ts web/src/pages/Rep.tsx
git commit -m "feat(agent): view as agent, and refuse to act as an unaccepted invite"
```

---

### Task 2: The agent home RPC

The only agent-home function in the database today is `get_agent_home(p_token)` — anon-granted, keyed on a UUID in a URL, reading the legacy `commitments` table that the structured 1:1 work replaced. Nothing in this app calls it. This task writes its replacement: keyed on `auth.uid()`, reading `checkin_items`.

**Files:**
- Create: `db/hq_agent_experience.sql`
- Create: `worker/src/agentHome.ts`, `worker/src/agentHome.test.ts`
- Create: `worker/src/agentRoutes.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `Db` from `worker/src/db.js`.
- Produces:
  - RPC `agent_home()` returning `{ agent, assessment, commitments, latest_checkin }`
  - RPC `agent_set_commitment_done(p_item_id uuid, p_done boolean)`
  - `GET /agent/home` and `POST /agent/commitment` in `worker/src/agentRoutes.ts`
  - `export interface AgentHome { agent: { id: string; name: string }; assessment: { code: string; personal_code: string | null; taken_at: string } | null; commitments: AgentCommitment[]; latest_checkin: string | null }`
  - `export interface AgentCommitment { id: string; body: string; agent_done: boolean; status: 'done' | 'partial' | 'missed' | null; created_at: string }`

- [x] **Step 1: Write the migration**

Create `db/hq_agent_experience.sql`:

```sql
-- Agent experience — auth-keyed agent home, self-report on commitments.
-- Idempotent. Depends on schema.sql, hq_coach.sql, hq_coach_1on1_structured.sql,
-- hq_rep_agent.sql. NEVER reads checkin_leader (see hq_coach_1on1_structured.sql:52).

-- The agent's own self-report, kept distinct from checkin_items.status, which is
-- the LEADER's review verdict at the next 1:1. One must never overwrite the other.
alter table checkin_items add column if not exists agent_done boolean not null default false;

-- Onboarding state. `gated` is set true only when a FIRST invite is minted from
-- the cutover forward (Task 8), so every row that exists today stays false and no
-- one already using the product is ever sent through the new gate.
alter table agents add column if not exists welcome_seen_at timestamptz;
alter table agents add column if not exists gated           boolean not null default false;

create or replace function agent_home()
returns json language sql security definer set search_path = public as $$
  with me as (select id, name from agents where auth_id = auth.uid() limit 1)
  select json_build_object(
    'agent', (select row_to_json(me) from me),
    'welcome_seen_at', (select a.welcome_seen_at from agents a where a.id = (select id from me)),
    'gated',           (select a.gated           from agents a where a.id = (select id from me)),
    'assessment', (
      select json_build_object('code', s.code, 'personal_code', a.personal_code,
                               'taken_at', s.taken_at)
        from assessments s join agents a on a.id = s.agent_id
       where a.id = (select id from me)
       order by s.taken_at desc limit 1),
    'commitments', (
      select coalesce(json_agg(json_build_object(
               'id', i.id, 'body', i.body, 'agent_done', i.agent_done,
               'status', i.status, 'created_at', i.created_at)
             order by i.position, i.created_at), '[]'::json)
        from checkin_items i
       where i.agent_id = (select id from me)
         and i.kind = 'commitment'
         and i.status is null),
    'latest_checkin', (
      select max(k.created_at) from checkins k where k.agent_id = (select id from me))
  );
$$;
grant execute on function agent_home() to authenticated;

create or replace function agent_set_commitment_done(p_item_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update checkin_items i set agent_done = p_done
   where i.id = p_item_id
     and i.kind = 'commitment'
     and i.agent_id = (select id from agents where auth_id = auth.uid());
  if not found then raise exception 'not your commitment'; end if;
end $$;
grant execute on function agent_set_commitment_done(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
```

Open commitments only (`status is null`): once the lead has reviewed one at the next 1:1, it belongs to history, not to today.

- [x] **Step 2: Apply it** — applied to TRU-Pulse (yeyoteredgunhvhqmais). NOTE: Postgres grants EXECUTE to PUBLIC by default and `anon` inherits it, so a `grant ... to authenticated` alone left all four functions anon-callable. Explicit `revoke ... from public, anon` added and verified.

Apply through the Supabase MCP connector against the TRU-Pulse project, then verify by calling `agent_home()` as an agent's session and confirming it returns their row and no one else's.

- [x] **Step 3: Write the failing test for the Worker layer**

Create `worker/src/agentHome.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shapeAgentHome } from './agentHome.js';

describe('shapeAgentHome', () => {
  it('reports that this agent has met with their lead', () => {
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: { code: 'PR-DI', personal_code: 'CALM', taken_at: '2026-08-01T00:00:00Z' },
      welcome_seen_at: null, gated: true,
      commitments: [
        { id: 'c1', body: 'Hold 4 appointments', agent_done: true,  status: null, created_at: '2026-08-10T00:00:00Z' },
        { id: 'c2', body: 'Two agreements signed', agent_done: false, status: null, created_at: '2026-08-10T00:00:00Z' },
      ],
      latest_checkin: '2026-08-10T00:00:00Z',
    });
    expect(out.commitments).toHaveLength(2);
    expect(out.hasEverMet).toBe(true);
  });

  it('survives an agent with no 1:1 yet', () => {
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: null, welcome_seen_at: null, gated: true,
      commitments: [], latest_checkin: null,
    });
    expect(out.commitments).toEqual([]);
    expect(out.hasEverMet).toBe(false);
  });

  it('tolerates a null commitments array rather than throwing at the browser', () => {
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: null, welcome_seen_at: null, gated: false,
      commitments: null as never, latest_checkin: null,
    });
    expect(out.commitments).toEqual([]);
  });
});
```

- [x] **Step 4: Run it and watch it fail**

Run: `cd worker && npx vitest run src/agentHome.test.ts`
Expected: FAIL — `Cannot find module './agentHome.js'`.

- [x] **Step 5: Implement**

Create `worker/src/agentHome.ts`:

```ts
export interface AgentCommitment {
  id: string; body: string; agent_done: boolean;
  status: 'done' | 'partial' | 'missed' | null; created_at: string;
}
export interface AgentHomeRow {
  agent: { id: string; name: string } | null;
  assessment: { code: string; personal_code: string | null; taken_at: string } | null;
  /** Both added by Task 6; include them from the start so the shape never changes. */
  welcome_seen_at: string | null;
  gated: boolean;
  commitments: AgentCommitment[];
  latest_checkin: string | null;
}
export interface AgentHome extends AgentHomeRow {
  hasEverMet: boolean;
}

/** Normalise the RPC's json into something the browser can render without guarding
 *  every field. Pacing arithmetic is deliberately NOT here — it lives in one place,
 *  `web/src/lib/agentPace.ts`, so there is never a second answer to the same sum. */
export function shapeAgentHome(row: AgentHomeRow): AgentHome {
  return {
    ...row,
    commitments: row.commitments ?? [],
    hasEverMet: row.latest_checkin != null,
  };
}
```

- [x] **Step 6: Run the test**

Run: `cd worker && npx vitest run src/agentHome.test.ts`
Expected: PASS.

- [x] **Step 7: Mount the routes** — also added `/agent/welcome-seen` and `/agent/assessment` here rather than in Tasks 6-7, since they are the same file and the same shape.

Create `worker/src/agentRoutes.ts` following the shape of `worker/src/dataRoutes.ts` — same origin check, same `db.rpc` helper:

```ts
import type { Env } from './env.js';
import type { Db } from './db.js';
import { shapeAgentHome, type AgentHomeRow } from './agentHome.js';

export async function handleAgentRoutes(
  req: Request, _env: Env, url: URL, db: Db, cors: Record<string, string>, originOk: boolean,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/agent/')) return null;
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });
  if (!originOk) return json({ error: 'origin not allowed' }, 403);

  if (url.pathname === '/agent/home' && req.method === 'GET') {
    const { ok, data } = await db.rpc<AgentHomeRow>('agent_home', {});
    if (!ok || !data?.agent) return json({ error: 'not an agent' }, 403);
    return json(shapeAgentHome(data));
  }

  if (url.pathname === '/agent/commitment' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { id?: string; done?: boolean } | null;
    if (!b?.id) return json({ error: 'id required' }, 422);
    const { ok } = await db.rpc('agent_set_commitment_done',
      { p_item_id: b.id, p_done: !!b.done });
    return ok ? json({ ok: true }) : json({ error: 'could not save that' }, 400);
  }

  return json({ error: 'not found' }, 404);
}
```

Mount it in `worker/src/index.ts` next to the existing route handlers, using that file's established ordering and its per-request `db` construction.

- [x] **Step 8: Typecheck, test, commit** — 291 pass. One PRE-EXISTING typecheck error (`getSetCookie`, authRoutes.test.ts:303) confirmed present on a clean tree; not introduced here, left alone.

```bash
cd worker && npm run typecheck && npm test
git add db/hq_agent_experience.sql worker/src/agentHome.ts worker/src/agentHome.test.ts worker/src/agentRoutes.ts worker/src/index.ts
git commit -m "feat(agent): auth-keyed agent home rpc and routes"
```

---

### Task 3: The agent shell

Turn the single-screen agent app into three tabs. This task only moves furniture — Home and Coach render placeholders that Tasks 4 and 5 fill.

**Files:**
- Create: `web/src/pages/AgentShell.tsx`
- Modify: `web/src/App.tsx:154-158`
- Modify: `web/src/pages/AgentCourse.tsx` (drop its own `<header className="ac-top">` and its `MyOneOnOnes` render — keep the component exported, Task 5 uses it)
- Modify: `web/src/lib/api.ts` (add `agentHome()`)

**Interfaces:**
- Consumes: `AgentIdentity` from `web/src/lib/api.ts`; `shapeAgentHome`'s output shape over the wire.
- Produces:
  - `agentHome(): Promise<AgentHome>` and `setCommitmentDone(id: string, done: boolean): Promise<void>` in `web/src/lib/api.ts`
  - `<AgentShell agent={agent} />`, the only thing `App.tsx` renders for an agent.

- [x] **Step 1: Add the client calls** — plus `markWelcomeSeen` and `submitMyAssessment`, since their routes already exist.

In `web/src/lib/api.ts`, mirroring the existing `workerFetch` helpers and re-exporting the `AgentHome` / `AgentCommitment` types so pages import them from one place:

```ts
export async function agentHome(): Promise<AgentHome> {
  const res = await workerFetch('/agent/home');
  if (!res.ok) throw new Error('Could not load your home.');
  return (await res.json()) as AgentHome;
}

export async function setCommitmentDone(id: string, done: boolean): Promise<void> {
  const res = await workerFetch('/agent/commitment', {
    method: 'POST', body: JSON.stringify({ id, done }),
  });
  if (!res.ok) throw new Error('That didn’t save — try again.');
}
```

- [x] **Step 2: Build the shell** — added an `onImmersive` callback: a lesson/quiz/sim takes the whole screen (that is how the course was built), so the shell hides its chrome while one is open rather than framing it.

Create `web/src/pages/AgentShell.tsx`. One header (TruLogo + sign out, lifted verbatim from `AgentCourse.tsx`'s `ac-top`), a three-tab nav, and the tab body. Tab state is local `useState`, not a hash route — an agent has one job at a time and deep links into their own tabs buy nothing.

```tsx
type Tab = 'home' | 'coach' | 'rep';

export default function AgentShell({ agent }: { agent: AgentIdentity }) {
  const [tab, setTab] = useState<Tab>('home');
  const [home, setHome] = useState<AgentHome | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { agentHome().then(setHome).catch(() => setErr('Could not load your home.')); }, []);

  return (
    <div className="ag">
      <header className="ac-top">
        <TruLogo size={26} wordSize={19} sub="TRU" />
        <button className="link small" onClick={() => signOutClean()}>Sign out</button>
      </header>
      <nav className="ag-tabs">
        {(['home', 'coach', 'rep'] as Tab[]).map((t) => (
          <button key={t} className={`ag-tab${tab === t ? ' is-on' : ''}`} onClick={() => setTab(t)}>
            {t === 'home' ? 'Home' : t === 'coach' ? 'Coach' : 'Training'}
          </button>
        ))}
      </nav>
      {err && <div className="ag-err">{err}</div>}
      {tab === 'home' && <AgentHomeView agent={agent} home={home} onChange={setHome} />}
      {tab === 'coach' && <AgentCoach agent={agent} home={home} />}
      {tab === 'rep'  && <AgentCourse agent={agent} />}
    </div>
  );
}
```

For this task, `AgentHomeView` and `AgentCoach` may be one-line placeholders in their own files.

- [x] **Step 3: Point App.tsx at it**

In `web/src/App.tsx`, replace `if (agent) return <AgentCourse agent={agent} />;` with `if (agent) return <AgentShell agent={agent} />;`. Leave the demo route at `App.tsx:136` on `AgentCourse` so the demo keeps working unchanged.

- [x] **Step 4: Style the tabs** — `.ag-tabs` / `.ag-tab` in styles.css, gold on the active tab, existing tokens only.

Add `.ag-tabs` / `.ag-tab` to the stylesheet `AgentCourse` already uses, matching the warm-gold-on-near-black treatment used elsewhere. Follow the existing token names rather than inventing colors.

- [ ] **Step 5: Verify by hand — NEEDS ERIC, after deploy**

`cd web && npm run dev`, sign in as an agent (or use View as agent from Task 1). All three tabs render, Training still works end to end — shelf, lesson, quiz, result.

- [x] **Step 6: Typecheck and commit** — typecheck clean, 113 web tests pass, production build succeeds.

```bash
cd web && npm run typecheck && npm test
git add web/src/pages/AgentShell.tsx web/src/pages/AgentHome.tsx web/src/pages/AgentCoach.tsx web/src/App.tsx web/src/pages/AgentCourse.tsx web/src/lib/api.ts
git commit -m "feat(agent): three-tab shell around the course"
```

---

### Task 4: Home — what to do today

**Files:**
- Create: `web/src/lib/agentPace.ts`, `web/src/lib/agentPace.test.ts`
- Modify: `web/src/pages/AgentHome.tsx`

**Interfaces:**
- Consumes: `AgentHome`, `AgentCommitment`, `setCommitmentDone` (Task 3); `CourseModule` + `loadCourse` (existing).
- Produces: `pace(commitments: AgentCommitment[]): { done: number; total: number; pct: number; state: 'none' | 'behind' | 'onTrack' | 'complete' }`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/agentPace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pace } from './agentPace';

const c = (id: string, done: boolean) =>
  ({ id, body: 'x', agent_done: done, status: null, created_at: '2026-08-10T00:00:00Z' });

describe('pace', () => {
  it('is "none" when the lead has never set a commitment', () => {
    expect(pace([])).toEqual({ done: 0, total: 0, pct: 0, state: 'none' });
  });

  it('is "complete" when every commitment is self-reported done', () => {
    expect(pace([c('1', true), c('2', true)]).state).toBe('complete');
  });

  it('is "behind" below half', () => {
    expect(pace([c('1', true), c('2', false), c('3', false)]).state).toBe('behind');
  });

  it('is "onTrack" at or above half but not finished', () => {
    expect(pace([c('1', true), c('2', false)]).state).toBe('onTrack');
  });

  it('rounds the percentage rather than trailing decimals into the UI', () => {
    expect(pace([c('1', true), c('2', false), c('3', false)]).pct).toBe(33);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/lib/agentPace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/lib/agentPace.ts`:

```ts
import type { AgentCommitment } from './api';

export type PaceState = 'none' | 'behind' | 'onTrack' | 'complete';

/** Pacing is measured against what the agent committed to, not against FUB.
 *  Deals key on agent NAME (db/hq_deals.sql:18), so joining outcomes to a
 *  person is a name match — too fragile to put under a number an agent reads
 *  every morning. Revisit only when deals carry an agent id. */
export function pace(commitments: AgentCommitment[]): {
  done: number; total: number; pct: number; state: PaceState;
} {
  const total = commitments.length;
  const done = commitments.filter((c) => c.agent_done).length;
  if (total === 0) return { done: 0, total: 0, pct: 0, state: 'none' };
  const pct = Math.round((done / total) * 100);
  const state: PaceState = done === total ? 'complete' : pct >= 50 ? 'onTrack' : 'behind';
  return { done, total, pct, state };
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && npx vitest run src/lib/agentPace.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Build the screen**

In `web/src/pages/AgentHome.tsx`, render three blocks in this order:

1. **Your commitments** — each `AgentCommitment` as a checkbox row. Toggling calls `setCommitmentDone(id, next)` optimistically and rolls back on rejection.
2. **How you're pacing** — `pace(...)`'s `done / total` and a bar at `pct`, labelled by `state`.
3. **What's next** — the first two modules from `loadCourse(agent.id)` whose `status !== 'passed'`, each a button that switches the shell to the Training tab and opens that module. Thread an `onOpenModule` callback down from `AgentShell`.

Empty state when `state === 'none'`, and say the true thing rather than a cheerful nothing:

> "You don't have any commitments yet. These come from your one-on-one with your team lead — they'll show up here after your next one."

- [ ] **Step 6: Verify by hand**

As an agent with open commitments: tick one, reload, confirm it stayed. As an agent with none: confirm the empty state reads correctly and nothing is broken. Confirm ticking your own commitment does not alter what the lead sees under their own review status.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/agentPace.ts web/src/lib/agentPace.test.ts web/src/pages/AgentHome.tsx web/src/pages/AgentShell.tsx
git commit -m "feat(agent): home — commitments, pacing, what's next"
```

---

### Task 5: Coach — their side of the coaching

**Files:**
- Modify: `web/src/pages/AgentCoach.tsx`
- Modify: `web/src/pages/AgentCourse.tsx` (export `MyOneOnOnes` so the Coach tab can render it)

**Interfaces:**
- Consumes: `AgentHome.assessment` (Task 2); `loadMyOneOnOnes` and `MyOneOnOnes` (existing, `web/src/lib/coachData.ts:998` and `AgentCourse.tsx:236`); the profile copy in `web/src/lib/assessmentData.ts`.
- Produces: nothing downstream.

- [ ] **Step 1: Confirm the promise is currently kept**

`Assess.tsx:360` tells people "Sign in any time to revisit your result." Before writing anything, check whether any current screen actually shows a stored result to the agent who took it. Search `web/src/` for a render path off `assessments`. Write the answer into the task notes: if nothing shows it, this task is building that surface for the first time, not reusing one.

- [ ] **Step 2: Render the result**

In `AgentCoach.tsx`, when `home.assessment` exists, render:
- the personal and professional codes as their full names, resolved through the existing lookups in `web/src/lib/assessmentData.ts` — do not hand-write a second copy of that mapping;
- what the profile means, how they're best coached, and their blind spots, from the same source the leader-side reveal uses;
- the date taken.

When `home.assessment` is null (only possible for a pre-existing agent, since Task 6 gates new ones), show a short prompt to take it with a button into the assessment.

- [x] **Step 3: Move the 1:1 recap in** — done early in Task 3: leaving the loader behind in AgentCourse would have been dead state, which the typecheck refuses.

Export `MyOneOnOnes` from `AgentCourse.tsx`, render it under the result in `AgentCoach.tsx`, and delete its render from `AgentCourse`. Keep `loadMyOneOnOnes`'s existing failure behaviour — a failure there must never blank the tab.

- [ ] **Step 4: Prove the private note stays private**

Open a leader account, write a private note and tick checklist items on an agent's 1:1. Then View as that agent and confirm: the note is nowhere in the UI, and nowhere in the network responses either. Check the actual response bodies in devtools, not just the rendered page.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/AgentCoach.tsx web/src/pages/AgentCourse.tsx
git commit -m "feat(agent): coach tab — assessment result and 1:1 recap"
```

---

### Task 6: The assessment gate

**Files:**
- Modify: `db/hq_agent_experience.sql` (add `submit_my_assessment`)
- Modify: `worker/src/agentRoutes.ts` (add `POST /agent/assessment`)
- Modify: `web/src/pages/Assess.tsx` (in-account mode)
- Create: `web/src/lib/agentStage.ts`, `web/src/lib/agentStage.test.ts`
- Modify: `web/src/pages/AgentShell.tsx`

**Interfaces:**
- Consumes: `AgentHome` (Task 2); `AssessFlow` and the scoring in `web/src/lib/assessmentData.ts` (existing).
- Produces: `agentStage(input: { hasAssessment: boolean; welcomeSeen: boolean; isNewAccount: boolean }): 'welcome' | 'assessment' | 'app'`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/agentStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agentStage } from './agentStage';

describe('agentStage', () => {
  it('sends a brand-new agent to the welcome first', () => {
    expect(agentStage({ hasAssessment: false, welcomeSeen: false, isNewAccount: true })).toBe('welcome');
  });

  it('gates a new agent on the assessment once the welcome is done', () => {
    expect(agentStage({ hasAssessment: false, welcomeSeen: true, isNewAccount: true })).toBe('assessment');
  });

  it('opens the app once the assessment exists', () => {
    expect(agentStage({ hasAssessment: true, welcomeSeen: true, isNewAccount: true })).toBe('app');
  });

  it('never gates an agent who predates the gate', () => {
    expect(agentStage({ hasAssessment: false, welcomeSeen: false, isNewAccount: false })).toBe('app');
  });

  it('accepts an assessment taken through the old public link', () => {
    expect(agentStage({ hasAssessment: true, welcomeSeen: false, isNewAccount: true })).toBe('app');
  });
});
```

The last two are the spec's promises in §3.4 — existing agents are untouched, and an old public-link result satisfies the gate.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/lib/agentStage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/lib/agentStage.ts`:

```ts
export type Stage = 'welcome' | 'assessment' | 'app';

/** isNewAccount is what keeps this from ambushing the people already using the
 *  product: the gate applies to accounts created from the cutover forward. */
export function agentStage(i: {
  hasAssessment: boolean; welcomeSeen: boolean; isNewAccount: boolean;
}): Stage {
  if (i.hasAssessment) return 'app';
  if (!i.isNewAccount) return 'app';
  return i.welcomeSeen ? 'assessment' : 'welcome';
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && npx vitest run src/lib/agentStage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the welcome stamp**

The `welcome_seen_at` and `gated` columns already landed in Task 2's migration, and `agent_home()` already returns both. This step only adds the write. Append to `db/hq_agent_experience.sql` and re-apply:

```sql
create or replace function agent_mark_welcome_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  update agents set welcome_seen_at = now()
   where auth_id = auth.uid() and welcome_seen_at is null;
end $$;
grant execute on function agent_mark_welcome_seen() to authenticated;
```

- [ ] **Step 6: In-account assessment submit**

Add to the same migration:

```sql
-- The in-account twin of submit_cohort_assessment. Keyed on the auth link, so it
-- needs no join token and does NOT require coaching_enabled — a freshly invited
-- agent is not in a cohort yet and must still be able to complete the gate.
create or replace function submit_my_assessment(
  p_personal_code text, p_personal_axes jsonb,
  p_business_code text, p_tallies jsonb, p_answers jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_team uuid; v_org uuid;
begin
  select id, team_id, org_id into v_agent, v_team, v_org
    from agents where auth_id = auth.uid();
  if v_agent is null then raise exception 'not an agent'; end if;

  update agents set personal_code = p_personal_code, personal_axes = p_personal_axes
   where id = v_agent;

  insert into assessments (
    org_id, team_id, agent_id, code, answers,
    energy_p, energy_t, approach_pro, approach_rec,
    deal_r, deal_v, decision_d, decision_i
  ) values (
    v_org, v_team, v_agent, p_business_code, p_answers,
    (p_tallies->>'energy_p')::int,     (p_tallies->>'energy_t')::int,
    (p_tallies->>'approach_pro')::int, (p_tallies->>'approach_rec')::int,
    (p_tallies->>'deal_r')::int,       (p_tallies->>'deal_v')::int,
    (p_tallies->>'decision_d')::int,   (p_tallies->>'decision_i')::int
  );
  return json_build_object('ok', true);
end $$;
grant execute on function submit_my_assessment(text, jsonb, text, jsonb, jsonb) to authenticated;
```

Expose it as `POST /agent/assessment` in `worker/src/agentRoutes.ts`, following the `/agent/commitment` shape.

- [ ] **Step 7: In-account mode for Assess.tsx**

`AssessFlow` already runs the questions and scoring independent of the token; only the roster resolution and the submit are token-bound. Give `Assess` an in-account mode that skips `resolveCohortRoster` (the agent is known), runs the same `AssessFlow`, and submits through `POST /agent/assessment` instead of `/public/submit-assessment`. Do not fork the question or scoring code — one copy, two submit paths.

- [ ] **Step 8: Wire the gate**

In `AgentShell`, compute `agentStage({ hasAssessment: !!home.assessment, welcomeSeen: !!home.welcome_seen_at, isNewAccount: home.gated })`. On `'assessment'`, render the in-account assessment full-bleed with no tabs and no escape — no skip, no dismiss, per spec §3.4. On `'app'`, render the tabs as built.

- [ ] **Step 9: Verify by hand**

Create a test agent, invite them, accept, and confirm you cannot reach Home, Coach or Training until the assessment is finished — including by editing the URL. Then confirm an existing agent signs in and sees no gate at all.

- [ ] **Step 10: Commit**

```bash
git add db/hq_agent_experience.sql worker/src/agentRoutes.ts web/src/pages/Assess.tsx web/src/lib/agentStage.ts web/src/lib/agentStage.test.ts web/src/pages/AgentShell.tsx
git commit -m "feat(agent): the assessment gate, taken inside the account"
```

---

### Task 7: The welcome walkthrough

**Files:**
- Create: `web/src/pages/AgentWelcome.tsx`
- Modify: `web/src/pages/AgentShell.tsx`, `web/src/lib/api.ts`

**Interfaces:**
- Consumes: `agentStage` (Task 6), `agent_mark_welcome_seen` (Task 6).
- Produces: `<AgentWelcome onDone={() => void} />`

- [ ] **Step 1: Build the shell of it**

Three screens, next/back, a finish button on the last. On finish, call `markWelcomeSeen()` (a new `POST /agent/welcome-seen` wrapper in `api.ts` over the RPC from Task 6) and hand control back. No skip control — spec §3.3 says it is dismissible only by finishing.

- [ ] **Step 2: Put Eric's copy in**

Approved 2026-08-18. Use these three screens verbatim as a single named constant:

**Screen 1 — Welcome to TRU**
> You're here because your team invested in you. TRU is where your training, your coaching, and your commitments live in one place. It takes about ten minutes to get set up, and then you're working.

**Screen 2 — How this works**
> Your team lead meets with you one-on-one. What you commit to in those meetings shows up on your home screen, so you always know what you said you'd do and how you're tracking against it. Your training library sits alongside it — everything we've taught live, there to re-read whenever you need it.

**Screen 3 — First, we need to know how you work**
> Next is a short assessment. It's not a test and there's no score. It tells us how you're wired — how you make decisions, how you handle pressure, what you need from a coach. Your team lead uses it to coach you the way you actually learn instead of the way they happen to teach. Take it honestly; it's about ten minutes.

Screen 3 is load-bearing: it is what keeps the mandatory assessment from reading as a hoop. Do not trim it.

- [ ] **Step 3: Verify by hand**

New agent: welcome appears once, finishing lands on the assessment gate, and signing out and back in does not show it again.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/AgentWelcome.tsx web/src/pages/AgentShell.tsx web/src/lib/api.ts
git commit -m "feat(agent): one-time welcome walkthrough"
```

---

### Task 8: One front door

Close the other two entrances. There are three today, not two: the invite, the self-serve signup at the end of the public assessment, and the legacy anon `/public/*` agent portal (`get_agent_home`, `enroll_agent`, `agent_save_checkin`, `agent_toggle_commitment`) which nothing in this app calls but which is still granted to `anon` and still live.

**Files:**
- Modify: `web/src/pages/Assess.tsx` (remove `RegisterFlow`'s signup)
- Modify: `worker/src/publicRoutes.ts:20-38`
- Modify: `db/hq_agent_experience.sql` (revokes + `claim_agent` hardening)
- Modify: `worker/src/index.ts:788-821` (`/rep/invite` sets `gated`)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing downstream.

- [ ] **Step 1: Retire the self-serve signup**

In `Assess.tsx`, delete the `signUp` form from `RegisterFlow`. The assessment still submits on mount exactly as it does now — that behaviour is untouched — but the ending becomes a plain "Your team lead has your profile" with the app link and no account creation. Anyone who needs an account gets invited.

- [ ] **Step 2: Harden the claim**

Add to `db/hq_agent_experience.sql`:

```sql
-- claim_agent binds an agents row to whoever signs in with a matching email.
-- With self-serve signup gone, the only way to hold such a session is to have
-- accepted an invite sent to that address — but require the confirmation
-- explicitly rather than inheriting it from a project setting that can change.
create or replace function claim_agent()
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if (auth.jwt() ->> 'email_verified')::boolean is not true
     and (auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean is not true then
    return (select id from agents where auth_id = auth.uid() limit 1);
  end if;
  update agents set auth_id = auth.uid()
   where auth_id is null and email is not null
     and lower(email) = lower(auth.jwt() ->> 'email')
  returning id into aid;
  if aid is null then
    select id into aid from agents where auth_id = auth.uid() limit 1;
  end if;
  return aid;
end $$;
grant execute on function claim_agent() to authenticated;
```

Verify the claim on a real invited account before moving on — if this project's JWTs carry the flag under a different key, fix the check rather than dropping it.

- [ ] **Step 3: Close the legacy portal**

Add to the same migration:

```sql
-- The old token-URL agent portal. Nothing in the app calls these; each one is an
-- anon-reachable read or write keyed on a UUID that lives in a URL.
revoke execute on function get_agent_home(uuid)                                 from anon, authenticated;
revoke execute on function agent_toggle_commitment(uuid, uuid, boolean)         from anon, authenticated;
revoke execute on function agent_save_checkin(uuid, text, int, int, text, text) from anon, authenticated;
revoke execute on function enroll_agent(uuid, text, text, text, text, jsonb, jsonb) from anon, authenticated;
```

Then delete the matching entries from `ARGS` and `FN` in `worker/src/publicRoutes.ts` so the routes 404 rather than reaching a function they can no longer execute. Leave `resolve-cohort-roster` and `submit-assessment` alone — Task 6 leaves the old public assessment path working for anyone mid-flight, and it creates no accounts.

- [ ] **Step 4: Mark new invites as gated**

In `worker/src/index.ts`, in the `/rep/invite` handler, set `gated = true` on the agent row when minting a **first** invite (`linkType === 'invite'`), not on a re-invite. That is what makes the gate apply from the cutover forward and never to someone already working.

- [ ] **Step 5: Confirm a lead can actually send an invite**

Spec §3.1 says leads invite their own people, with no seat cap and no approval. `inviteAgent()` and `/rep/invite` exist, but confirm the control is reachable by a **team lead** — not only by an admin — from wherever they manage their roster in `Rep.tsx`. Sign in as a lead, not as Eric, and send a real invite to a test address. If the control is admin-gated or hidden, un-gate it here; that is the whole of §3.1's remaining work.

- [ ] **Step 6: Verify by hand**

- Walk the public assessment link end to end: the result still saves, and there is no way to create an account from it.
- `curl -X POST https://<worker>/public/get-agent-home -d '{"p_token":"<a real agent token>"}'` → 404.
- Invite a fresh test agent → they are gated. An existing agent → not gated.

- [ ] **Step 7: Run everything and commit**

```bash
cd worker && npm run typecheck && npm test
cd ../web && npm run typecheck && npm test
git add -A
git commit -m "feat(agent): one front door — retire self-serve signup and the legacy token portal"
```

---

### Task 9: Required vs self-paced, and the leader roster

**Files:**
- Modify: `db/hq_agent_experience.sql` (a `required` flag)
- Modify: `web/src/pages/Rep.tsx` (authoring toggle + roster column)
- Modify: `web/src/pages/AgentCourse.tsx` (the badge)

**Interfaces:**
- Consumes: `rep_modules`, `rep_progress`, and the track grouping from the training-library work.
- Produces: nothing downstream.

- [ ] **Step 1: Decide where the flag lives**

Spec §6 leaves this open. Read `db/hq_rep_library.sql` and `db/rep_tracks_seed.mjs` first: if tracks already group the Zillow Preferred set as a unit, mark the **track** required and do not add a per-module column. Only fall back to `alter table rep_modules add column if not exists required boolean not null default false;` if tracks cannot express it. Write the decision and the reason into the migration's header comment.

- [ ] **Step 2: Authoring toggle**

In the module manager in `Rep.tsx`, add a "Required to launch" toggle wherever the chosen flag lives. Eric sets this himself.

- [ ] **Step 3: The agent-side badge**

In the `AgentCourse` shelf, badge required modules. Do not lock anything, do not reorder, do not gate the sim on them — display only, per spec §3.7. Everything stays browsable.

- [ ] **Step 4: Confirm the roster**

Open the leader roster in `Rep.tsx` as a lead and check it answers: who finished what, who has stalled, and their scores. It largely does today. If required modules are not distinguishable from optional ones in that view, add the distinction — that is the one thing the flag exists to make visible to a lead.

- [ ] **Step 5: Verify by hand**

Mark the Zillow Preferred set required. As an agent: the badge shows and nothing is locked. As a lead: the roster separates required from optional progress.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(rep): mark required-to-launch training, surface it to agents and leads"
```

---

## Deploying

Per `DEPLOY.md` and the two-publish rule: deploy the Worker first, then the Pages bundle, and confirm `web/.env.production` exists before building. Blank any `CLOUDFLARE_API_TOKEN` in the environment first — a stale one silently overrides the login that works.

Migrations go through the Supabase MCP connector before either deploy, since the new Worker routes call RPCs that must already exist.

## Sequencing note

Tasks 1 through 8 are ordered by dependency and must run in order — Task 8 in particular must not run before Task 6, or there would be a window with no way to take the assessment at all. Task 9 is independent of the rest and can be done any time after Task 3.
