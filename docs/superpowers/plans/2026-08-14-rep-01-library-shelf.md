# Rep Phase 1 — the shelf and the learner spine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rep from a flat five-module course into a browsable library of tracks that leaders can
assign, that both agents *and* leaders can complete, and that issues a certificate at the end.

**Architecture:** Additive SQL only (house style of `db/hq_rep_*.sql`). A new `rep_learners` table
unifies the two kinds of learner (agent, org member) so every progress-bearing table can key off one
id. Tracks group existing `rep_modules` rows through a join table, leaving `rep_modules.idx` and the
current course untouched. All new reads land on one Worker route, `/data/rep/library`; all new writes
follow the established service-role pattern. Every piece of derived state (track %, next module,
locked, overdue) is a **pure function in `shared/repLibrary.ts`** so it is unit-testable under the
existing node-environment vitest config and reusable by both the Worker and the browser.

**Tech Stack:** Supabase/Postgres, Cloudflare Worker (TypeScript, service-role PostgREST via
`worker/src/db.ts`), React 18 + Vite, vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-08-14-rep-training-library-design.md`

## Global Constraints

- **All Supabase DDL is applied through the Supabase MCP connector**, never by handing Eric SQL to
  paste. The `.sql` files in `db/` are the versioned source of truth; the connector is how they land.
- **Additive and idempotent.** `create table if not exists`, `add column if not exists`, guarded
  `ADD CONSTRAINT` via `pg_constraint`, `drop policy if exists` before `create policy`. Every file
  ends with `notify pgrst, 'reload schema';`.
- **No client-facing INSERT/UPDATE policies on any new table.** Writes go through the Worker with the
  service role — the invariant stated in `db/hq_rep_authoring.sql:83-89`.
- **`/data/*` routes call Supabase AS THE USER**, never with the service role. `worker/src/dataRoutes.test.ts`
  exists to enforce this; do not weaken it.
- **Answers never reach the browser.** No new route or view may select a column holding a correct
  answer, a check definition, or a rubric.
- Import shared modules with the `.js` extension: `import { x } from '../../shared/repLibrary.js'`
  (Worker) / `'../../../shared/repLibrary.js'` (web) — matching `worker/src/sync.ts:8`.
- Web tests are **node environment, `.test.ts` only** (`web/vitest.config.ts`). No JSX rendering
  tests. Logic goes in plain-TS modules and is tested there.
- Commit per task. Branch off current `main`; fetch and merge before every push (`main` moves under
  you when Codex lands commits on the laptop).

---

### Task 1: The learner spine

Today `rep_progress.agent_id` is `not null references agents(id)`. A team leader is a `memberships`
row, so a leader cannot complete a module at all. This task creates one identity every
progress-bearing table can key on.

**Files:**
- Create: `db/hq_rep_learners.sql`
- Test: `worker/src/repLearner.test.ts` (Task 3 — this task is DDL only)

**Interfaces:**
- Produces: table `rep_learners (id uuid, org_id uuid, kind text, agent_id uuid, user_id uuid,
  name text, email text, created_at timestamptz)`; column `rep_progress.learner_id uuid`.

- [ ] **Step 1: Write the migration file**

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — the learner spine: one identity for agents AND org members
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor via the Supabase MCP connector.
-- Additive + idempotent.
--
-- WHY: rep_progress.agent_id references agents(id). A team leader is a
-- memberships row, not an agent, so a leader can watch the course but can never
-- complete a module. rep_learners unifies both kinds so progress, assignments,
-- sim attempts and certificates all key on ONE id.

create table if not exists rep_learners (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  kind       text not null,                                   -- 'agent' | 'member'
  agent_id   uuid references agents(id) on delete cascade,    -- set when kind='agent'
  user_id    uuid references auth.users(id) on delete cascade,-- set when kind='member'
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rep_learners_kind_check') then
    alter table rep_learners add constraint rep_learners_kind_check
      check (kind in ('agent','member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rep_learners_one_ref_check') then
    alter table rep_learners add constraint rep_learners_one_ref_check
      check ((kind = 'agent'  and agent_id is not null and user_id is null)
          or (kind = 'member' and user_id  is not null and agent_id is null));
  end if;
end $$;

-- Partial uniques: one learner row per agent, one per (org, user).
create unique index if not exists rep_learners_agent_uk  on rep_learners (agent_id) where agent_id is not null;
create unique index if not exists rep_learners_member_uk on rep_learners (org_id, user_id) where user_id is not null;
create index        if not exists rep_learners_org_idx   on rep_learners (org_id);

-- ── Backfill: every existing agent becomes a learner ─────────────────────────
insert into rep_learners (org_id, kind, agent_id, name, email)
select a.org_id, 'agent', a.id, a.name, a.email
  from agents a
 where a.org_id is not null
   and not exists (select 1 from rep_learners l where l.agent_id = a.id);

-- ── rep_progress migration: add learner_id, relax agent_id ───────────────────
-- agent_id stays (nullable, dual-written) for ONE release so the existing leader
-- roster in Rep.tsx keeps rendering while the UI moves over. Dropping it is a
-- separate, later migration.
alter table rep_progress add column if not exists learner_id uuid references rep_learners(id) on delete cascade;
alter table rep_progress alter column agent_id drop not null;

update rep_progress p
   set learner_id = l.id
  from rep_learners l
 where l.agent_id = p.agent_id
   and p.learner_id is null;

create unique index if not exists rep_progress_learner_module_uk
  on rep_progress (learner_id, module_id) where learner_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table rep_learners enable row level security;

-- An org member (leader) sees their org's learners; a learner sees their own row.
drop policy if exists rep_learners_org_read on rep_learners;
create policy rep_learners_org_read on rep_learners for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_learners_self_read on rep_learners;
create policy rep_learners_self_read on rep_learners for select to authenticated
  using (user_id = auth.uid()
      or agent_id in (select id from agents where auth_id = auth.uid()));

-- rep_progress: the existing agent self-read policy only matches agent_id. Add
-- the learner_id equivalent so a MEMBER learner can read their own progress.
drop policy if exists rep_progress_learner_self on rep_progress;
create policy rep_progress_learner_self on rep_progress for select to authenticated
  using (learner_id in (
    select id from rep_learners
     where user_id = auth.uid()
        or agent_id in (select id from agents where auth_id = auth.uid())));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it through the Supabase MCP connector**

Use `apply_migration` with name `hq_rep_learners`. Then verify with `execute_sql`:

```sql
select kind, count(*) from rep_learners group by kind;
select count(*) as unmigrated from rep_progress where learner_id is null;
```

Expected: a non-zero `agent` count matching `select count(*) from agents where org_id is not null`,
and `unmigrated = 0`.

- [ ] **Step 3: Commit**

```bash
git add db/hq_rep_learners.sql
git commit -m "feat(rep): learner spine so leaders can take modules too"
```

---

### Task 2: The shelf schema

**Files:**
- Create: `db/hq_rep_library.sql`

**Interfaces:**
- Consumes: `rep_learners` (Task 1).
- Produces: tables `rep_tracks`, `rep_track_modules`, `rep_assignments`, `rep_certificates`; columns
  `rep_modules.kind | duration_min | level | tags | cover | version`.

- [ ] **Step 1: Write the migration file**

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — the shelf: tracks, assignment, certificates, module metadata
-- ═══════════════════════════════════════════════════════════════════════════
-- Additive + idempotent. Writes are service-role-only (no client INSERT/UPDATE
-- policies) — same contract as db/hq_rep_authoring.sql.

-- ── 1. Module metadata for browsing ─────────────────────────────────────────
alter table rep_modules add column if not exists kind         text not null default 'lesson';
alter table rep_modules add column if not exists duration_min int;
alter table rep_modules add column if not exists level        text;
alter table rep_modules add column if not exists tags         text[] not null default '{}';
alter table rep_modules add column if not exists cover        text;
alter table rep_modules add column if not exists version      int not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rep_modules_kind_check') then
    alter table rep_modules add constraint rep_modules_kind_check
      check (kind in ('lesson','sim','voice','assignment'));
  end if;
end $$;

-- ── 2. Tracks ────────────────────────────────────────────────────────────────
-- org_id NULL = a shared TRU track every team sees, mirroring rep_modules.
create table if not exists rep_tracks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references orgs(id) on delete cascade,
  slug       text not null,
  title      text not null,
  subtitle   text,
  cover      text,
  order_idx  int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists rep_tracks_global_slug_uk on rep_tracks (slug) where org_id is null;
create unique index if not exists rep_tracks_org_slug_uk    on rep_tracks (org_id, slug) where org_id is not null;

create table if not exists rep_track_modules (
  track_id  uuid not null references rep_tracks(id) on delete cascade,
  module_id uuid not null references rep_modules(id) on delete cascade,
  idx       int  not null default 0,
  required  boolean not null default true,
  primary key (track_id, module_id)
);
create index if not exists rep_track_modules_track_idx on rep_track_modules (track_id, idx);

-- ── 3. Assignment ────────────────────────────────────────────────────────────
create table if not exists rep_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  learner_id   uuid not null references rep_learners(id) on delete cascade,
  track_id     uuid not null references rep_tracks(id) on delete cascade,
  due_at       timestamptz,
  assigned_by  uuid references auth.users(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (learner_id, track_id)
);
create index if not exists rep_assignments_org_idx on rep_assignments (org_id, due_at);

-- ── 4. Certificates ──────────────────────────────────────────────────────────
create table if not exists rep_certificates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  learner_id    uuid not null references rep_learners(id) on delete cascade,
  track_id      uuid not null references rep_tracks(id) on delete cascade,
  issued_at     timestamptz not null default now(),
  signed_off_by text,
  unique (learner_id, track_id)
);
create index if not exists rep_certificates_org_idx on rep_certificates (org_id, issued_at desc);

-- ── 5. RLS — reads only; every write goes through the Worker ─────────────────
alter table rep_tracks        enable row level security;
alter table rep_track_modules enable row level security;
alter table rep_assignments   enable row level security;
alter table rep_certificates  enable row level security;

-- Tracks: global or own-org — the same predicate rep_modules_read uses, so a
-- learner agent (anon-role token) can read the shared shelf.
drop policy if exists rep_tracks_read on rep_tracks;
create policy rep_tracks_read on rep_tracks for select to anon, authenticated
  using (org_id is null or is_org_member(org_id));

drop policy if exists rep_track_modules_read on rep_track_modules;
create policy rep_track_modules_read on rep_track_modules for select to anon, authenticated
  using (exists (select 1 from rep_tracks t
                  where t.id = track_id and (t.org_id is null or is_org_member(t.org_id))));

-- Assignments / certificates: a leader sees their org's; a learner sees their own.
drop policy if exists rep_assignments_org_read on rep_assignments;
create policy rep_assignments_org_read on rep_assignments for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_assignments_self_read on rep_assignments;
create policy rep_assignments_self_read on rep_assignments for select to authenticated
  using (learner_id in (select id from rep_learners
                         where user_id = auth.uid()
                            or agent_id in (select id from agents where auth_id = auth.uid())));

drop policy if exists rep_certificates_org_read on rep_certificates;
create policy rep_certificates_org_read on rep_certificates for select to authenticated
  using (is_org_member(org_id));

drop policy if exists rep_certificates_self_read on rep_certificates;
create policy rep_certificates_self_read on rep_certificates for select to authenticated
  using (learner_id in (select id from rep_learners
                         where user_id = auth.uid()
                            or agent_id in (select id from agents where auth_id = auth.uid())));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply through the Supabase MCP connector, then verify**

```sql
select table_name from information_schema.tables
 where table_name in ('rep_tracks','rep_track_modules','rep_assignments','rep_certificates');
select column_name from information_schema.columns
 where table_name='rep_modules' and column_name in ('kind','duration_min','level','tags','cover','version');
```

Expected: 4 table rows, 6 column rows.

- [ ] **Step 3: Commit**

```bash
git add db/hq_rep_library.sql
git commit -m "feat(rep): tracks, assignments, certificates, module metadata"
```

---

### Task 3: `resolveLearner` — one lookup for both learner kinds

**Files:**
- Create: `worker/src/repLearner.ts`
- Test: `worker/src/repLearner.test.ts`

**Interfaces:**
- Consumes: `Db` from `worker/src/db.ts`.
- Produces: `resolveLearner(database: Db, userId: string, orgHint?: string): Promise<Learner | null>`
  where `Learner = { id: string; org_id: string; kind: 'agent' | 'member'; agent_id: string | null }`.
  Every later route calls this instead of the `agents.auth_id` lookup at `worker/src/index.ts:968`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/repLearner.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLearner } from './repLearner.js';
import type { Db } from './db.js';

/** A fake PostgREST that answers by table + query substring, and records inserts. */
function fakeDb(rows: Record<string, any[]>, inserted: any[] = []): Db {
  return {
    async select(table: string, query: string) {
      const all = rows[table] ?? [];
      if (table === 'rep_learners' && query.includes('agent_id=eq.')) {
        const id = query.split('agent_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.agent_id === id);
      }
      if (table === 'rep_learners' && query.includes('user_id=eq.')) {
        const id = query.split('user_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.user_id === id);
      }
      if (table === 'agents' && query.includes('auth_id=eq.')) {
        const id = query.split('auth_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.auth_id === id);
      }
      if (table === 'memberships' && query.includes('user_id=eq.')) {
        const id = query.split('user_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.user_id === id);
      }
      return all;
    },
    async insert(table: string, row: any) { inserted.push({ table, row }); return { id: 'new-learner', ...row }; },
    async upsert() {}, async update() {},
  } as unknown as Db;
}

describe('resolveLearner', () => {
  it('returns the existing learner row for an agent', async () => {
    const db = fakeDb({
      agents: [{ id: 'ag1', org_id: 'o1', auth_id: 'u1', name: 'Maya', email: 'm@x.co' }],
      rep_learners: [{ id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1', user_id: null }],
    });
    expect(await resolveLearner(db, 'u1')).toEqual(
      { id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1' });
  });

  it('creates a member learner on first sight of a leader', async () => {
    const inserted: any[] = [];
    const db = fakeDb({
      agents: [],
      memberships: [{ user_id: 'u2', org_id: 'o1', role: 'leader' }],
      rep_learners: [],
      profiles: [{ id: 'u2', name: 'Eric', email: 'eric@truhq.co' }],
    }, inserted);
    const learner = await resolveLearner(db, 'u2', 'o1');
    expect(learner?.kind).toBe('member');
    expect(inserted[0].table).toBe('rep_learners');
    expect(inserted[0].row).toMatchObject({ org_id: 'o1', kind: 'member', user_id: 'u2' });
  });

  it('returns null when the user is neither an agent nor a member', async () => {
    const db = fakeDb({ agents: [], memberships: [], rep_learners: [] });
    expect(await resolveLearner(db, 'nobody')).toBeNull();
  });

  it('prefers the agent identity when a user is somehow both', async () => {
    const db = fakeDb({
      agents: [{ id: 'ag1', org_id: 'o1', auth_id: 'u1', name: 'Maya', email: null }],
      memberships: [{ user_id: 'u1', org_id: 'o1', role: 'leader' }],
      rep_learners: [{ id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1', user_id: null }],
    });
    expect((await resolveLearner(db, 'u1'))?.kind).toBe('agent');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/repLearner.test.ts`
Expected: FAIL — `Failed to resolve import "./repLearner.js"`.

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/repLearner.ts
// One identity for both kinds of learner. An AGENT is an `agents` row linked to
// a login by auth_id (hq_rep_agent.sql); a MEMBER is a leader/admin in
// `memberships`. rep_progress / rep_assignments / rep_sim_attempts /
// rep_certificates all key on rep_learners.id so neither kind is special-cased
// downstream.
import type { Db } from './db.js';

export type Learner = {
  id: string;
  org_id: string;
  kind: 'agent' | 'member';
  agent_id: string | null;
};

/**
 * Resolve (and lazily create) the rep_learners row for a signed-in user.
 * Agent identity wins when a login is somehow both — an agent taking the course
 * must record progress against their roster row, which is what the leader board
 * reads.
 *
 * `orgHint` picks the org for a user who leads more than one; ignored for agents
 * (an agents row already carries exactly one org_id).
 */
export async function resolveLearner(
  database: Db,
  userId: string,
  orgHint?: string,
): Promise<Learner | null> {
  // ── Agent path ─────────────────────────────────────────────────────────────
  const agents = await database.select('agents', `auth_id=eq.${userId}&select=id,org_id,name,email`);
  if (agents.length) {
    const a = agents[0] as { id: string; org_id: string; name: string; email: string | null };
    const existing = await database.select(
      'rep_learners', `agent_id=eq.${a.id}&select=id,org_id,kind,agent_id`);
    if (existing.length) return existing[0] as Learner;
    const row = await database.insert('rep_learners', {
      org_id: a.org_id, kind: 'agent', agent_id: a.id, name: a.name, email: a.email,
    });
    return { id: row.id, org_id: a.org_id, kind: 'agent', agent_id: a.id };
  }

  // ── Member path ────────────────────────────────────────────────────────────
  const memberships = await database.select(
    'memberships', `user_id=eq.${userId}&select=org_id,role`);
  if (!memberships.length) return null;
  const orgId = orgHint && memberships.some((m: any) => m.org_id === orgHint)
    ? orgHint
    : (memberships[0] as { org_id: string }).org_id;

  const existing = await database.select(
    'rep_learners', `user_id=eq.${userId}&org_id=eq.${orgId}&select=id,org_id,kind,agent_id`);
  if (existing.length) return existing[0] as Learner;

  const profiles = await database.select('profiles', `id=eq.${userId}&select=name,email`);
  const p = (profiles[0] as { name?: string; email?: string } | undefined) ?? {};
  const row = await database.insert('rep_learners', {
    org_id: orgId, kind: 'member', user_id: userId,
    name: p.name ?? p.email ?? 'Team leader', email: p.email ?? null,
  });
  return { id: row.id, org_id: orgId, kind: 'member', agent_id: null };
}
```

> **Before implementing:** confirm the profile table's real name and columns —
> `grep -n "'profiles'\|profiles?" worker/src/*.ts`. If this codebase reads the leader's display
> name from somewhere else (e.g. `memberships` joined to `auth.users`), use that source instead and
> keep the fallback chain `name → email → 'Team leader'`.

- [ ] **Step 4: Run the tests**

Run: `cd worker && npx vitest run src/repLearner.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/repLearner.ts worker/src/repLearner.test.ts
git commit -m "feat(rep): resolveLearner unifies agent and leader learners"
```

---

### Task 4: `/rep/grade` writes `learner_id` (dual-write)

Quiz grading currently 403s for a leader (`worker/src/index.ts:968-970`,
`if (!arows.length) return json({ error: 'not an agent' }, 403)`). This is the change that lets a
leader complete a module.

**Files:**
- Modify: `worker/src/index.ts:961-1004` (the `/rep/grade` handler)
- Test: `worker/src/repGrade.test.ts`

**Interfaces:**
- Consumes: `resolveLearner` (Task 3).
- Produces: `rep_progress` rows carrying both `learner_id` and (for agents) `agent_id`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/repGrade.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
let env: Env; let ctx: ExecutionContext; let upserted: any[];

beforeEach(() => {
  upserted = [];
  env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon',
          SUPABASE_SERVICE_ROLE_KEY: 'svc' } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init: any) => {
    const u = String(input);
    const body = init?.body ? JSON.parse(init.body) : null;
    // token introspection → the leader's user id
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u-leader' }), { status: 200 });
    if (u.includes('/agents?')) return new Response('[]', { status: 200 });
    if (u.includes('/memberships?')) return new Response(JSON.stringify([{ org_id: 'o1', role: 'leader' }]), { status: 200 });
    if (u.includes('/profiles?')) return new Response(JSON.stringify([{ name: 'Eric', email: 'e@truhq.co' }]), { status: 200 });
    if (u.includes('/rep_learners?') && init?.method === 'POST')
      return new Response(JSON.stringify([{ id: 'L-leader', org_id: 'o1', kind: 'member', agent_id: null }]), { status: 201 });
    if (u.includes('/rep_learners?')) return new Response('[]', { status: 200 });
    if (u.includes('/rep_modules?')) return new Response(JSON.stringify([{ id: 'm1', pass_pct: 80, active: true }]), { status: 200 });
    if (u.includes('/rep_questions?')) return new Response(JSON.stringify([
      { idx: 1, answer: 0, explain: null }, { idx: 2, answer: 1, explain: null }]), { status: 200 });
    if (u.includes('/rep_progress?') && init?.method === 'POST') { upserted.push(body); return new Response('', { status: 201 }); }
    if (u.includes('/rep_progress?')) return new Response('[]', { status: 200 });
    return new Response('[]', { status: 200 });
  }));
});

describe('/rep/grade', () => {
  const call = () => worker.fetch(new Request('https://api.truhq.co/rep/grade', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: 'm1', answers: [0, 1] }),
  }), env, ctx);

  it('grades a LEADER, not just an agent', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ score: 100, passed: true, correct: 2, total: 2 });
  });

  it('writes learner_id on the progress row', async () => {
    await call();
    expect(upserted[0][0]).toMatchObject({ learner_id: 'L-leader', org_id: 'o1', module_id: 'm1' });
  });

  it('leaves agent_id null for a member learner', async () => {
    await call();
    expect(upserted[0][0].agent_id ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repGrade.test.ts`
Expected: FAIL — first test returns 403 `{"error":"not an agent"}`.

- [ ] **Step 3: Change the handler**

In `worker/src/index.ts`, replace the agent lookup inside `/rep/grade`:

```ts
// BEFORE
const arows = await database.select('agents', `auth_id=eq.${userId}&select=id,org_id`);
if (!arows.length) return json({ error: 'not an agent' }, 403);
const agent = arows[0] as any;
```

```ts
// AFTER — a leader takes the same modules as their agents (spec §3.5).
const learner = await resolveLearner(database, userId, body?.orgId ? String(body.orgId) : undefined);
if (!learner) return json({ error: 'not enrolled' }, 403);
```

Then the prior-attempt read and the upsert key on the learner, dual-writing `agent_id` so the
existing leader roster (which still joins on `agent_id`) keeps rendering for one release:

```ts
const prior = await database.select(
  'rep_progress',
  `learner_id=eq.${learner.id}&module_id=eq.${moduleId}&select=attempts,passed_at`,
);
// …score/passed computed unchanged…
await database.upsert(
  'rep_progress',
  [{
    learner_id: learner.id, agent_id: learner.agent_id, org_id: learner.org_id,
    module_id: moduleId, status: passed ? 'passed' : 'in_progress', score, attempts,
    passed_at, updated_at: new Date().toISOString(),
  }],
  'learner_id,module_id',
);
```

Add the import at the top of `index.ts`: `import { resolveLearner } from './repLearner.js';`

- [ ] **Step 4: Run the tests**

Run: `cd worker && npx vitest run`
Expected: all pass, including the pre-existing `dataRoutes.test.ts` tenancy suite.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/repGrade.test.ts
git commit -m "feat(rep): leaders can pass module quizzes; progress keys on learner_id"
```

---

### Task 5: `shared/repLibrary.ts` — every derived number, as pure functions

**Files:**
- Create: `shared/repLibrary.ts`
- Test: `shared/repLibrary.test.ts`

**Interfaces:**
- Produces the types and functions every later task consumes:
  - `type TrackRow = { id: string; slug: string; title: string; subtitle: string | null; cover: string | null; order_idx: number }`
  - `type TrackModuleRow = { track_id: string; module_id: string; idx: number; required: boolean }`
  - `type ProgressRow = { module_id: string; status: string; score: number | null; passed_at: string | null }`
  - `type AssignmentRow = { track_id: string; due_at: string | null; completed_at: string | null }`
  - `type TrackView = { id: string; slug: string; title: string; subtitle: string | null; cover: string | null; total: number; passed: number; pct: number; complete: boolean; nextModuleId: string | null; dueAt: string | null; overdue: boolean; assigned: boolean }`
  - `buildTrackViews(tracks, trackModules, progress, assignments, now: Date): TrackView[]`
  - `isModuleLocked(trackModules, progress, trackId, moduleId): boolean`
  - `searchModules(modules, q): ModuleRow[]`

- [ ] **Step 1: Write the failing test**

```ts
// shared/repLibrary.test.ts
import { describe, it, expect } from 'vitest';
import { buildTrackViews, isModuleLocked, searchModules } from './repLibrary.js';

const NOW = new Date('2026-08-14T12:00:00Z');
const tracks = [
  { id: 't1', slug: 'zillow-day1', title: 'Zillow Preferred Onboarding', subtitle: null, cover: null, order_idx: 1 },
  { id: 't2', slug: 'fundamentals', title: 'TRU Fundamentals', subtitle: null, cover: null, order_idx: 2 },
];
const tms = [
  { track_id: 't1', module_id: 'm1', idx: 1, required: true },
  { track_id: 't1', module_id: 'm2', idx: 2, required: true },
  { track_id: 't1', module_id: 'm3', idx: 3, required: false },
  { track_id: 't2', module_id: 'm9', idx: 1, required: true },
];

describe('buildTrackViews', () => {
  it('counts only REQUIRED modules toward completion', () => {
    const v = buildTrackViews(tracks, tms, [{ module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' }], [], NOW);
    const t1 = v.find((t) => t.id === 't1')!;
    expect(t1.total).toBe(2);
    expect(t1.passed).toBe(1);
    expect(t1.pct).toBe(50);
    expect(t1.complete).toBe(false);
  });

  it('marks a track complete when every required module is passed', () => {
    const prog = [
      { module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' },
      { module_id: 'm2', status: 'passed', score: 85, passed_at: 'y' },
    ];
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.complete).toBe(true);
    expect(t1.pct).toBe(100);
    expect(t1.nextModuleId).toBeNull();
  });

  it('nextModuleId is the lowest-idx unpassed module, optional ones included', () => {
    const prog = [{ module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' }];
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.nextModuleId).toBe('m2');
  });

  it('flags an assignment past its due date as overdue', () => {
    const assign = [{ track_id: 't1', due_at: '2026-08-10T00:00:00Z', completed_at: null }];
    const t1 = buildTrackViews(tracks, tms, [], assign, NOW).find((t) => t.id === 't1')!;
    expect(t1.assigned).toBe(true);
    expect(t1.overdue).toBe(true);
  });

  it('never marks a completed assignment overdue', () => {
    const assign = [{ track_id: 't1', due_at: '2026-08-10T00:00:00Z', completed_at: '2026-08-09T00:00:00Z' }];
    expect(buildTrackViews(tracks, tms, [], assign, NOW).find((t) => t.id === 't1')!.overdue).toBe(false);
  });

  it('returns tracks in order_idx order', () => {
    expect(buildTrackViews(tracks, tms, [], [], NOW).map((t) => t.slug))
      .toEqual(['zillow-day1', 'fundamentals']);
  });

  it('treats an empty track as 0% and not complete', () => {
    const t = buildTrackViews([tracks[0]], [], [], [], NOW)[0];
    expect(t.pct).toBe(0);
    expect(t.complete).toBe(false);
  });
});

describe('isModuleLocked', () => {
  it('leaves the first module open', () => {
    expect(isModuleLocked(tms, [], 't1', 'm1')).toBe(false);
  });
  it('locks a module whose required predecessor is unpassed', () => {
    expect(isModuleLocked(tms, [], 't1', 'm2')).toBe(true);
  });
  it('unlocks once the predecessor passes', () => {
    const prog = [{ module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' }];
    expect(isModuleLocked(tms, prog, 't1', 'm2')).toBe(false);
  });
  it('does not let an OPTIONAL predecessor block anything', () => {
    const prog = [
      { module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' },
      { module_id: 'm2', status: 'passed', score: 90, passed_at: 'y' },
    ];
    expect(isModuleLocked(tms, prog, 't1', 'm3')).toBe(false);
  });
});

describe('searchModules', () => {
  const mods = [
    { id: 'm1', title: 'Speed to Lead', summary: 'first five minutes', tags: ['speed'], level: 'core' },
    { id: 'm2', title: 'The ALMS Call Framework', summary: null, tags: ['call', 'scripts'], level: 'core' },
  ];
  it('matches on title, case-insensitively', () => {
    expect(searchModules(mods, 'alms').map((m) => m.id)).toEqual(['m2']);
  });
  it('matches on a tag', () => {
    expect(searchModules(mods, 'scripts').map((m) => m.id)).toEqual(['m2']);
  });
  it('matches on the summary', () => {
    expect(searchModules(mods, 'five minutes').map((m) => m.id)).toEqual(['m1']);
  });
  it('returns everything for an empty query', () => {
    expect(searchModules(mods, '   ')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run ../shared/repLibrary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// shared/repLibrary.ts
// Pure derivations for the Rep library shelf. No I/O, no React, no Worker types —
// so the Worker, the browser and the tests all agree on one definition of
// "how far along is this learner", and it can be tested under the node-env
// vitest config (web/vitest.config.ts includes ../shared/**/*.test.ts).

export type TrackRow = {
  id: string; slug: string; title: string;
  subtitle: string | null; cover: string | null; order_idx: number;
};
export type TrackModuleRow = { track_id: string; module_id: string; idx: number; required: boolean };
export type ProgressRow = { module_id: string; status: string; score: number | null; passed_at: string | null };
export type AssignmentRow = { track_id: string; due_at: string | null; completed_at: string | null };
export type ModuleRow = {
  id: string; title: string; summary: string | null;
  tags?: string[] | null; level?: string | null;
};

export type TrackView = {
  id: string; slug: string; title: string; subtitle: string | null; cover: string | null;
  total: number; passed: number; pct: number; complete: boolean;
  nextModuleId: string | null;
  assigned: boolean; dueAt: string | null; overdue: boolean;
};

const passedIds = (progress: ProgressRow[]) =>
  new Set(progress.filter((p) => p.status === 'passed').map((p) => p.module_id));

export function buildTrackViews(
  tracks: TrackRow[],
  trackModules: TrackModuleRow[],
  progress: ProgressRow[],
  assignments: AssignmentRow[],
  now: Date,
): TrackView[] {
  const done = passedIds(progress);
  const byTrack = new Map<string, TrackModuleRow[]>();
  for (const tm of trackModules) {
    const list = byTrack.get(tm.track_id) ?? [];
    list.push(tm);
    byTrack.set(tm.track_id, list);
  }

  return [...tracks]
    .sort((a, b) => a.order_idx - b.order_idx || a.title.localeCompare(b.title))
    .map((t) => {
      const rows = (byTrack.get(t.id) ?? []).slice().sort((a, b) => a.idx - b.idx);
      const required = rows.filter((r) => r.required);
      const passed = required.filter((r) => done.has(r.module_id)).length;
      const total = required.length;
      // Completion is measured on REQUIRED modules only; "next" walks every
      // module in order, so an optional one still shows up as the next thing to do.
      const complete = total > 0 && passed === total;
      const next = rows.find((r) => !done.has(r.module_id));
      const a = assignments.find((x) => x.track_id === t.id) ?? null;
      const overdue = !!(a && a.due_at && !a.completed_at && new Date(a.due_at) < now);
      return {
        id: t.id, slug: t.slug, title: t.title, subtitle: t.subtitle, cover: t.cover,
        total, passed,
        pct: total ? Math.round((passed / total) * 100) : 0,
        complete,
        nextModuleId: next?.module_id ?? null,
        assigned: !!a, dueAt: a?.due_at ?? null, overdue,
      };
    });
}

/** A module is locked while any REQUIRED module earlier in its track is unpassed. */
export function isModuleLocked(
  trackModules: TrackModuleRow[],
  progress: ProgressRow[],
  trackId: string,
  moduleId: string,
): boolean {
  const done = passedIds(progress);
  const rows = trackModules.filter((t) => t.track_id === trackId).sort((a, b) => a.idx - b.idx);
  const me = rows.find((r) => r.module_id === moduleId);
  if (!me) return false;
  return rows.some((r) => r.required && r.idx < me.idx && !done.has(r.module_id));
}

/** Title / summary / tag / level search. Empty or whitespace query returns everything. */
export function searchModules<T extends ModuleRow>(modules: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return modules;
  return modules.filter((m) =>
    m.title.toLowerCase().includes(needle) ||
    (m.summary ?? '').toLowerCase().includes(needle) ||
    (m.level ?? '').toLowerCase().includes(needle) ||
    (m.tags ?? []).some((t) => t.toLowerCase().includes(needle)));
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run ../shared/repLibrary.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add shared/repLibrary.ts shared/repLibrary.test.ts
git commit -m "feat(rep): pure track/progress derivations for the library shelf"
```

---

### Task 6: `GET /data/rep/library`

One round trip returns the whole shelf for whoever is signed in.

**Files:**
- Modify: `worker/src/dataRoutes.ts`
- Test: `worker/src/repLibraryRoute.test.ts`

**Interfaces:**
- Consumes: `resolveLearner` (Task 3), `buildTrackViews` (Task 5).
- Produces: `GET /data/rep/library` → `{ learner, tracks: TrackView[], modules: ModuleRow[],
  trackModules: TrackModuleRow[], progress: ProgressRow[], certificates: Array<{track_id, issued_at}> }`

- [ ] **Step 1: Write the failing test**

Model it on `worker/src/dataRoutes.test.ts` — fake Supabase, two users in two orgs, and assert:

```ts
it('never sends the service-role key on /data/rep/library', async () => {
  await call('at-acme');
  expect(sentAuthHeaders.every((h) => !h.includes(SERVICE_ROLE))).toBe(true);
});

it('returns the shelf with each track rolled up', async () => {
  const body = await (await call('at-acme')).json();
  expect(body.tracks.map((t: any) => t.slug)).toEqual(['zillow-day1', 'fundamentals']);
  expect(body.tracks[0]).toMatchObject({ total: 2, passed: 1, pct: 50 });
});

it('one org never sees another org custom track', async () => {
  const acme = await (await call('at-acme')).json();
  const globex = await (await call('at-globex')).json();
  expect(acme.tracks.some((t: any) => t.slug === 'globex-only')).toBe(false);
  expect(globex.tracks.some((t: any) => t.slug === 'globex-only')).toBe(true);
});

it('404s the learner-less caller rather than leaking an empty shelf', async () => {
  expect((await call('at-stranger')).status).toBe(403);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repLibraryRoute.test.ts`
Expected: FAIL — 404 from the router.

- [ ] **Step 3: Implement the route**

Add to `worker/src/dataRoutes.ts`, following the existing as-the-user pattern in that file (the
tenancy invariant: reads use the caller's access token, never `SUPABASE_SERVICE_ROLE_KEY`). The
learner lookup is the one service-role call, and it selects nothing tenant-scoped beyond the caller's
own identity.

```ts
if (url.pathname === '/data/rep/library' && req.method === 'GET') {
  const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const learner = await resolveLearner(database, userId, url.searchParams.get('org') ?? undefined);
  if (!learner) return json({ error: 'not enrolled' }, 403);

  // RLS decides every row below — these five reads go out AS THE USER.
  const [tracks, trackModules, modules, progress, assignments, certificates] = await Promise.all([
    asUser('rep_tracks',        'select=id,slug,title,subtitle,cover,order_idx&active=is.true&order=order_idx'),
    asUser('rep_track_modules', 'select=track_id,module_id,idx,required'),
    asUser('rep_modules',       'select=id,idx,title,summary,pass_pct,kind,duration_min,level,tags,cover&active=is.true'),
    asUser('rep_progress',      `select=module_id,status,score,passed_at&learner_id=eq.${learner.id}`),
    asUser('rep_assignments',   `select=track_id,due_at,completed_at&learner_id=eq.${learner.id}`),
    asUser('rep_certificates',  `select=track_id,issued_at&learner_id=eq.${learner.id}`),
  ]);

  return json({
    learner: { id: learner.id, kind: learner.kind, org_id: learner.org_id },
    tracks: buildTrackViews(tracks, trackModules, progress, assignments, new Date()),
    modules, trackModules, progress, certificates,
  });
}
```

> Use whatever the file's existing helper for user-scoped reads is named — read
> `worker/src/dataRoutes.ts` and `worker/src/asUser.ts` first and match it exactly rather than
> introducing a second idiom.

- [ ] **Step 4: Run the whole worker suite**

Run: `cd worker && npm test`
Expected: all pass, `dataRoutes.test.ts` included.

- [ ] **Step 5: Commit**

```bash
git add worker/src/dataRoutes.ts worker/src/repLibraryRoute.test.ts
git commit -m "feat(rep): GET /data/rep/library returns the whole shelf in one trip"
```

---

### Task 7: Browser API — `loadLibrary()`

**Files:**
- Modify: `web/src/lib/api.ts` (append after the existing Rep block, ~line 249)

**Interfaces:**
- Consumes: `/data/rep/library` (Task 6), `shared/repLibrary.ts` types (Task 5).
- Produces: `loadLibrary(): Promise<LibraryData>` where
  `LibraryData = { learner: { id: string; kind: 'agent'|'member'; org_id: string }; tracks: TrackView[]; modules: LibraryModule[]; trackModules: TrackModuleRow[]; progress: ProgressRow[]; certificates: Array<{ track_id: string; issued_at: string }> }`
  and `LibraryModule = RepModule & { kind: string; duration_min: number | null; level: string | null; tags: string[]; cover: string | null }`.

- [ ] **Step 1: Add the types and the loader**

```ts
// ── TRU Rep — the library shelf (Phase 1) ───────────────────────────────────
import type { TrackView, TrackModuleRow, ProgressRow } from '../../../shared/repLibrary.js';
export type { TrackView, TrackModuleRow, ProgressRow };

export interface LibraryModule extends RepModule {
  kind: string; duration_min: number | null; level: string | null;
  tags: string[]; cover: string | null;
}
export interface LibraryData {
  learner: { id: string; kind: 'agent' | 'member'; org_id: string };
  tracks: TrackView[];
  modules: LibraryModule[];
  trackModules: TrackModuleRow[];
  progress: ProgressRow[];
  certificates: Array<{ track_id: string; issued_at: string }>;
}

/** The whole shelf for whoever is signed in — one round trip, RLS-scoped. */
export async function loadLibrary(): Promise<LibraryData> {
  const res = await workerFetch('/data/rep/library');
  if (!res.ok) throw new Error('Could not load the training library.');
  return (await res.json()) as LibraryData;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(rep): loadLibrary() client for the shelf"
```

---

### Task 8: The learner's library home

Replace `AgentCourse`'s flat module list with a shelf: *continue where you left off*, *assigned to
you*, *browse by track*, *search*. The lesson / quiz / result / sim views are untouched.

**Files:**
- Create: `web/src/pages/LibraryHome.tsx`
- Modify: `web/src/pages/AgentCourse.tsx:82-163` (the `view === 'home'` branch delegates to it)
- Modify: `web/src/truHqDark.css` (append a `.lib-*` block)

**Interfaces:**
- Consumes: `loadLibrary()` (Task 7), `isModuleLocked` / `searchModules` (Task 5),
  `CourseModule` (existing).
- Produces: `<LibraryHome data={LibraryData} onOpenModule={(moduleId: string) => void} />`

- [ ] **Step 1: Build the component**

Sections, in order down the page:

1. **Hero** — greeting, the learner's overall ring (all required modules across assigned tracks),
   and the single most urgent call to action: continue the in-flight module, or start the assigned
   track's `nextModuleId`.
2. **Assigned to you** — one card per `TrackView` with `assigned: true`; due date; an `overdue` chip
   in `--terracotta`; progress bar from `pct`.
3. **Certificates** — earned track badges, reusing the existing `.ac-cert` treatment.
4. **Browse the library** — every track as a cover card, expanding to its module list. Locked modules
   (`isModuleLocked`) render dimmed with a lock chip and the reason: *"Finish {predecessor title}
   first."*
5. **Search** — one input filtering across all modules via `searchModules`, results grouped by track.

Reuse what exists rather than inventing: `ac-modcard`, `ac-ring`, `ac-cert`, `accentOf(idx)`,
`estMinutes(m)` — all already in `AgentCourse.tsx`. Export `estMinutes` and `accentOf` from
`AgentCourse.tsx` instead of copying them, and prefer each module's `duration_min` when set, falling
back to `estMinutes`.

Per Eric's standing preference, **the screen changes only when the learner changes it**: no
self-collapsing sections, no auto-reordering, no panel that closes itself after a pass.

- [ ] **Step 2: Wire it into `AgentCourse`**

In `AgentCourse.tsx`, load `loadLibrary()` alongside the existing `loadCourse(agent.id)` and render
`<LibraryHome …/>` in place of the current `.ac-modlist` block. Keep the Live Sim card at the bottom
of the Zillow track. `openModule` is unchanged.

- [ ] **Step 3: Verify in the running app**

Run: `cd web && npm run dev`, then sign in as a test agent and as a leader.
Expected: both see the shelf; the leader's progress ring updates after passing a quiz (Task 4).

- [ ] **Step 4: Typecheck and build**

Run: `cd web && npm run typecheck && npm run build`
Expected: clean; the existing "bundle optimization" warning is pre-existing and fine.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/LibraryHome.tsx web/src/pages/AgentCourse.tsx web/src/truHqDark.css
git commit -m "feat(rep): library home — assigned, browse, search, certificates"
```

---

### Task 9: `POST /rep/assignments` — a leader assigns a track

**Files:**
- Modify: `worker/src/index.ts` (new route beside `/rep/modules`)
- Test: `worker/src/repAssignments.test.ts`

**Interfaces:**
- Consumes: `isOrgLeaderOrAdmin` (existing in `index.ts`).
- Produces: `POST /rep/assignments` with body
  `{ org_id: string; track_id: string; learner_ids: string[]; due_at?: string | null }`
  → `{ count: number }`.

- [ ] **Step 1: Write the failing test**

```ts
it('403s a plain member', async () => { /* isOrgLeaderOrAdmin false → 403 */ });
it('422s an empty learner_ids array', async () => { /* → 422 */ });
it('403s when a learner belongs to another org', async () => {
  // the route must re-read rep_learners and verify org_id === body.org_id
});
it('upserts on (learner_id, track_id) so re-assigning updates the due date', async () => {
  expect(upserted.onConflict).toBe('learner_id,track_id');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repAssignments.test.ts`
Expected: FAIL — 404 from the router.

- [ ] **Step 3: Implement**

```ts
if (url.pathname === '/rep/assignments' && req.method === 'POST') {
  const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const body = (await req.json().catch(() => null)) as any;
  const orgId = String(body?.org_id ?? '').trim();
  const trackId = String(body?.track_id ?? '').trim();
  const learnerIds: string[] = Array.isArray(body?.learner_ids) ? body.learner_ids.map(String) : [];
  const dueAt = body?.due_at ? String(body.due_at) : null;
  if (!isUuid(orgId) || !isUuid(trackId)) return json({ error: 'invalid id' }, 422);
  if (!learnerIds.length || !learnerIds.every(isUuid)) return json({ error: 'learner_ids[] required' }, 422);
  if (!(await isOrgLeaderOrAdmin(database, userId, orgId))) return json({ error: 'forbidden' }, 403);

  // Every learner must belong to THIS org — a forged id can't cross a tenant line.
  const owned = await database.select(
    'rep_learners', `id=in.(${learnerIds.join(',')})&select=id,org_id`);
  if (owned.length !== learnerIds.length || owned.some((l: any) => l.org_id !== orgId)) {
    return json({ error: 'forbidden' }, 403);
  }
  await database.upsert(
    'rep_assignments',
    learnerIds.map((id) => ({
      org_id: orgId, learner_id: id, track_id: trackId,
      due_at: dueAt, assigned_by: userId, assigned_at: new Date().toISOString(),
    })),
    'learner_id,track_id',
  );
  return json({ count: learnerIds.length });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd worker && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/repAssignments.test.ts
git commit -m "feat(rep): leaders assign a track to learners with a due date"
```

---

### Task 10: Leader-side assignment UI

**Files:**
- Modify: `web/src/pages/Rep.tsx` (hero CTA row, ~line 253-270; roster row actions, ~line 393-425)
- Create: `web/src/pages/RepAssign.tsx` (the overlay)
- Modify: `web/src/lib/api.ts` (`assignTrack()`)

**Interfaces:**
- Consumes: `POST /rep/assignments` (Task 9), `loadLibrary()` (Task 7).
- Produces: `assignTrack(input: { orgId: string; trackId: string; learnerIds: string[]; dueAt: string | null }): Promise<{ count: number }>`

- [ ] **Step 1: Add the API call**

```ts
/** Leader/admin: assign a track to one or more learners with an optional due date. */
export async function assignTrack(input: {
  orgId: string; trackId: string; learnerIds: string[]; dueAt: string | null;
}): Promise<{ count: number }> {
  const res = await workerFetch('/rep/assignments', {
    method: 'POST',
    body: JSON.stringify({
      org_id: input.orgId, track_id: input.trackId,
      learner_ids: input.learnerIds, due_at: input.dueAt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
  if (!res.ok) throw new Error(body.error ?? 'Could not assign this track');
  return { count: body.count ?? 0 };
}
```

- [ ] **Step 2: Build `RepAssign`**

Reuse the existing overlay idiom exactly — `rp-mgmt-overlay` / `rp-mgmt-panel`, fixed backdrop, click
outside to close, mounted **on top of** the dashboard so the roster's search state survives (the
pattern `ModuleManager` already uses, `Rep.tsx:617`).

Contents: a track picker, a checkbox roster (reusing `Avatar` + the existing search box), a due-date
input, and a footer button reading `Assign to N`. On success, refresh and show
`Assigned to N · due Aug 21`.

- [ ] **Step 3: Add the entry points**

- Hero CTA row (`Rep.tsx:253`): a `📋 Assign a track` button beside `🛠 Manage modules`, gated on the
  same `canAuthor` check.
- Roster row: an `Assign` button beside `Invite`, opening `RepAssign` pre-checked to that one learner.

- [ ] **Step 4: Show assignment state on the roster**

In `AgentDrill` (`Rep.tsx:468`), add a line per assigned track: `Zillow Preferred · 4/11 · due Aug 21`,
with the overdue variant in `--terracotta`. Derive it with `buildTrackViews` — do not recompute
percentages in the component.

- [ ] **Step 5: Typecheck, build, and eyeball it**

Run: `cd web && npm run typecheck && npm run build && npm run dev`
Expected: assigning a track to a test agent makes it appear under *Assigned to you* on their side.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Rep.tsx web/src/pages/RepAssign.tsx web/src/lib/api.ts
git commit -m "feat(rep): leader assigns tracks from the Rep roster"
```

---

### Task 11: Certificates on track completion

**Files:**
- Modify: `worker/src/index.ts` (issue inside `/rep/grade`, after the progress upsert)
- Create: `worker/src/repCertificates.ts`
- Test: `worker/src/repCertificates.test.ts`

**Interfaces:**
- Consumes: `buildTrackViews` (Task 5), `Learner` (Task 3).
- Produces: `maybeIssueCertificates(database: Db, learner: Learner): Promise<string[]>` — returns the
  track ids newly certified. Idempotent: `rep_certificates` is unique on `(learner_id, track_id)`.

- [ ] **Step 1: Write the failing test**

```ts
it('issues nothing while a required module is unpassed', async () => {
  expect(await maybeIssueCertificates(db, learner)).toEqual([]);
});
it('issues one certificate when the last required module passes', async () => {
  expect(await maybeIssueCertificates(db, learner)).toEqual(['t1']);
});
it('is idempotent — a second call issues nothing', async () => {
  await maybeIssueCertificates(db, learner);
  expect(await maybeIssueCertificates(db, learner)).toEqual([]);
});
it('stamps the matching assignment completed_at', async () => {
  await maybeIssueCertificates(db, learner);
  expect(updates.find((u) => u.table === 'rep_assignments')?.patch.completed_at).toBeTruthy();
});
it('ignores OPTIONAL modules when deciding completion', async () => {
  // m3 required:false is unpassed; the certificate still issues
  expect(await maybeIssueCertificates(db, learner)).toEqual(['t1']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/repCertificates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/repCertificates.ts
import type { Db } from './db.js';
import type { Learner } from './repLearner.js';
import { buildTrackViews } from '../../shared/repLibrary.js';

/** Issue a certificate for every track this learner has just completed. Idempotent. */
export async function maybeIssueCertificates(database: Db, learner: Learner): Promise<string[]> {
  const [tracks, trackModules, progress, existing, assignments] = await Promise.all([
    database.select('rep_tracks',        'select=id,slug,title,subtitle,cover,order_idx&active=is.true'),
    database.select('rep_track_modules', 'select=track_id,module_id,idx,required'),
    database.select('rep_progress',      `learner_id=eq.${learner.id}&select=module_id,status,score,passed_at`),
    database.select('rep_certificates',  `learner_id=eq.${learner.id}&select=track_id`),
    database.select('rep_assignments',   `learner_id=eq.${learner.id}&select=track_id,due_at,completed_at`),
  ]);
  const already = new Set((existing as Array<{ track_id: string }>).map((c) => c.track_id));
  const views = buildTrackViews(tracks as any, trackModules as any, progress as any, assignments as any, new Date());
  const fresh = views.filter((v) => v.complete && !already.has(v.id));
  if (!fresh.length) return [];

  const now = new Date().toISOString();
  await database.upsert(
    'rep_certificates',
    fresh.map((v) => ({ org_id: learner.org_id, learner_id: learner.id, track_id: v.id, issued_at: now })),
    'learner_id,track_id',
    { ignoreDuplicates: true },
  );
  for (const v of fresh.filter((x) => x.assigned)) {
    await database.update(
      'rep_assignments',
      `learner_id=eq.${learner.id}&track_id=eq.${v.id}`,
      { completed_at: now },
    );
  }
  return fresh.map((v) => v.id);
}
```

Then call it from `/rep/grade`, after the `rep_progress` upsert and only when `passed`:

```ts
const certified = passed ? await maybeIssueCertificates(database, learner) : [];
return json({ score, passed, correct, total, review, certified });
```

- [ ] **Step 4: Run the tests**

Run: `cd worker && npm test`
Expected: all pass.

- [ ] **Step 5: Render it**

In `AgentCourse.tsx`'s `Result` view, when `result.certified?.length`, show the existing `.ac-cert`
seal with the track's title. In `LibraryHome`, list earned certificates. In `Rep.tsx`'s `AgentDrill`,
show `Certified · Zillow Preferred · Aug 14, 2026`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/repCertificates.ts worker/src/repCertificates.test.ts worker/src/index.ts \
        web/src/pages/AgentCourse.tsx web/src/pages/LibraryHome.tsx web/src/pages/Rep.tsx
git commit -m "feat(rep): certificate on track completion"
```

---

### Task 12: Seed the two launch tracks

**Files:**
- Create: `db/rep_tracks_seed.mjs`

**Interfaces:**
- Consumes: the existing `db/rep_curriculum.mjs` module ids (`a0000000-…` through `a4444444-…`).
- Produces: two `rep_tracks` rows and their `rep_track_modules` links; module metadata backfilled.

- [ ] **Step 1: Write the seeder**

Same shape as `db/rep_curriculum.mjs` — a data-only Node script taking a secrets path, writing over
PostgREST with the service role, safe to re-run.

```js
// db/rep_tracks_seed.mjs
// Usage: node rep_tracks_seed.mjs <path-to-secrets.json>
// Seeds the two launch tracks and backfills browse metadata onto the shared
// TRU curriculum. Idempotent: fixed uuids + upsert.
const T_FUND = 'b1111111-1111-1111-1111-111111111111';
const T_ZILL = 'b2222222-2222-2222-2222-222222222222';

const TRACKS = [
  { id: T_ZILL, org_id: null, slug: 'zillow-preferred-onboarding', order_idx: 1,
    title: 'Zillow Preferred Onboarding',
    subtitle: 'Day 1 — from the connection to a record another agent could take over.' },
  { id: T_FUND, org_id: null, slug: 'tru-fundamentals', order_idx: 2,
    title: 'TRU Fundamentals',
    subtitle: 'Speed, the ALMS call, working a paid lead, and telling the CRM the truth.' },
];

// Fundamentals maps 1:1 onto today's five modules. The Zillow track starts with
// only the shared "Welcome to Preferred" module (M0) and fills out in Phase 3 —
// see plans/2026-08-14-rep-03-day1-track.md.
const LINKS = [
  { track_id: T_ZILL, module_id: 'a0000000-0000-0000-0000-000000000000', idx: 1, required: true },
  { track_id: T_FUND, module_id: 'a1111111-1111-1111-1111-111111111111', idx: 1, required: true },
  { track_id: T_FUND, module_id: 'a2222222-2222-2222-2222-222222222222', idx: 2, required: true },
  { track_id: T_FUND, module_id: 'a3333333-3333-3333-3333-333333333333', idx: 3, required: true },
  { track_id: T_FUND, module_id: 'a4444444-4444-4444-4444-444444444444', idx: 4, required: true },
];

const META = {
  'a0000000-0000-0000-0000-000000000000': { kind: 'lesson', duration_min: 12, level: 'core', tags: ['zillow','standards','stages'] },
  'a1111111-1111-1111-1111-111111111111': { kind: 'lesson', duration_min:  9, level: 'core', tags: ['speed','lead-response'] },
  'a2222222-2222-2222-2222-222222222222': { kind: 'lesson', duration_min: 11, level: 'core', tags: ['alms','scripts','calls'] },
  'a3333333-3333-3333-3333-333333333333': { kind: 'lesson', duration_min:  9, level: 'core', tags: ['paid-leads','pipeline'] },
  'a4444444-4444-4444-4444-444444444444': { kind: 'lesson', duration_min:  8, level: 'core', tags: ['crm','follow-up'] },
};
// …upsert TRACKS on id, LINKS on (track_id,module_id), PATCH each module with META…
```

- [ ] **Step 2: Run it**

Run: `node db/rep_tracks_seed.mjs <secrets.json>`
Expected: `tracks: 2, links: 5, modules updated: 5`.

- [ ] **Step 3: Verify through the app**

Sign in as a test agent: two tracks on the shelf, Fundamentals showing 4 modules with durations and
tags, Zillow showing 1.

- [ ] **Step 4: Commit and deploy**

```bash
git add db/rep_tracks_seed.mjs
git commit -m "feat(rep): seed the Fundamentals and Zillow Preferred tracks"
git fetch origin && git merge origin/main     # main moves under you
cd worker && npx wrangler deploy               # Worker deploys only from main
cd ../web && npm run build                     # needs .env.production present (gitignored)
```

Then publish the web bundle per `DEPLOY.md`, and re-verify the live bundle actually changed — a stale
service-worker cache has silently swallowed a deploy on this project before.

---

## Self-review notes

- **Spec coverage:** §3.5 learner spine → Tasks 1, 3, 4. §3.6 shelf → Tasks 2, 5, 6, 7, 8, 12.
  Assignment → Tasks 9, 10. Certificates → Task 11. §3.2/§3.3/§3.4 (the simulator) are deliberately
  **not** here — they are Phase 2, `plans/2026-08-14-rep-02-practice-crm.md`.
- **Naming is consistent across tasks:** `resolveLearner` / `Learner` (T3) is what T4, T6 and T11
  import; `buildTrackViews` / `isModuleLocked` / `searchModules` (T5) is what T6, T8, T10 and T11
  import; `TrackView` is the one shape crossing the Worker/browser boundary.
- **Two unknowns flagged inline rather than guessed:** the leader profile source in Task 3, and the
  exact name of the as-the-user read helper in Task 6. Both say *read the file first and match it.*
