# TRU HQ Intake Form + 1:1 Session Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform owner a form that provisions a brokerage from a Follow Up Boss key and emails its team leaders a set-password link, and stop the 1:1 page from resetting when the browser tab loses focus.

**Architecture:** Part 1 adds one worker module (`intake.ts`) plus an email helper (`invite.ts`) behind the existing `/admin/*` auth gate, and consolidates the two drifted provisioning paths so `connectTeamKey()` is the only code that puts a key on a team. Part 2 extracts three pure helpers (identity comparison, coach route parsing, scroll memory) so the fix is unit-testable in a `node` test environment, then wires them into `App.tsx` and `Coach.tsx`.

**Tech Stack:** Cloudflare Workers (TypeScript, `wrangler`), Supabase (PostgREST + admin auth API), Resend, React 18 + Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-hq-intake-and-1on1-persistence-design.md`

## Global Constraints

- Branch: `feat/hq-intake-and-1on1-persistence` (off `origin/main` @ a04e0f7). Already created.
- **Never read, write, or reference `BRIEF_FROM`.** It delivers the hustle score and PCVR reports, which are confirmed working. Invites use the new `INVITE_FROM` only.
- Resend has exactly one verified domain: `truhq.co`. Any other sender domain is rejected *silently*. `INVITE_FROM` is `TRU HQ <hq@truhq.co>`.
- Web tests run in vitest `environment: 'node'` with `include: ['src/**/*.test.ts']` — **`.ts` only, not `.tsx`, and there is no `window`.** All Part 2 logic under test must live in plain `.ts` modules that never touch `window` at import time and accept storage/location as parameters.
- Worker tests stub the whole world at the `fetch` boundary and run the real exported handler. Follow `worker/src/routes-auth.test.ts` exactly.
- Run `npm test` and `npm run typecheck` in **both** `web/` and `worker/` before any commit that touches that package.
- `db.insert(table, row)` returns the created row; `db.upsert(table, rows[], onConflict?)` returns void; `db.update(table, query, patch)` returns void; `db.select(table, query)` returns `any[]`.
- **Gotcha:** `Coach.tsx` has *two* different `openId` states — the roster's at line ~140 and a commitment accordion's at line ~1393. Part 2 touches **only** the one at ~140.

## File Structure

| File | Responsibility |
|---|---|
| `worker/src/provision.ts` | **Modify.** Tenant rows only: orgs, memberships, leaders, entitlements, org_settings, teams. No key storage. |
| `worker/src/invite.ts` | **Create.** Mint a Supabase auth link; render + send the invite email via Resend. |
| `worker/src/intake.ts` | **Create.** Validate an intake payload; orchestrate provision → keys → invites. |
| `worker/src/index.ts` | **Modify.** `/provision` calls `connectTeamKey`; add `POST /admin/intake` and `POST /admin/resend-invite`. |
| `worker/src/env.ts` | **Modify.** Add `INVITE_FROM`; fix the stale `trucoaching.co` comment. |
| `worker/wrangler.toml` | **Modify.** Document `INVITE_FROM`; fix the stale `trucoaching.co` comment. |
| `worker/src/intake.test.ts` | **Create.** Validation unit tests + full-route tests through the real handler. |
| `web/src/lib/authIdentity.ts` | **Create.** Pure: extract a session's user id, decide whether identity changed. |
| `web/src/lib/coachRoute.ts` | **Create.** Pure: format/parse `#/coach/<agentId>`. |
| `web/src/lib/scrollMemory.ts` | **Create.** Read/write a scroll offset against an injected `Storage`. |
| `web/src/lib/*.test.ts` | **Create.** One test file per helper above. |
| `web/src/App.tsx` | **Modify.** Ignore same-user token refreshes; route `/coach/<agentId>`. |
| `web/src/pages/Coach.tsx` | **Modify.** Drive the roster `openId` from the route; restore scroll per agent. |
| `web/src/components/AdminIntake.tsx` | **Create.** The owner intake form + per-leader result list. |
| `web/src/lib/api.ts` | **Modify.** Add `adminIntake()` and `adminResendInvite()`. |
| `web/src/pages/Home.tsx` | **Modify.** Render `<AdminIntake />` in a new owner-only panel. |

**Task order:** Part 2 first (Tasks 1–3) — it is smaller, independently shippable, and fixes a bug Eric hits daily. Then Part 1 (Tasks 4–7).

---

# Part 2 — 1:1 session persistence

### Task 1: Ignore same-user token refreshes

The bug: `supabase-js` refreshes its token when the tab regains visibility and emits an auth event. `App.tsx` calls `setSession(s)` with a brand-new object, the `[session]` effect re-runs, `setOrg(undefined)` fires, `App` renders its spinner branch, and `Coach` unmounts — destroying the open 1:1.

**Files:**
- Create: `web/src/lib/authIdentity.ts`
- Test: `web/src/lib/authIdentity.test.ts`
- Modify: `web/src/App.tsx:33-58`

**Interfaces:**
- Produces: `userIdOf(session): string | null`, `identityChanged(prev: string | null | undefined, next: string | null): boolean`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/authIdentity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { userIdOf, identityChanged } from './authIdentity';

describe('userIdOf', () => {
  it('reads the id out of a session', () => {
    expect(userIdOf({ user: { id: 'u1' } })).toBe('u1');
  });
  it('treats a signed-out session as no user', () => {
    expect(userIdOf(null)).toBeNull();
    expect(userIdOf(undefined)).toBeNull();
    expect(userIdOf({} as never)).toBeNull();
  });
});

describe('identityChanged', () => {
  // The whole point: a token refresh hands us a NEW session object for the
  // SAME person. That must not count as a change, or the app tears itself down.
  it('is false when the same user comes back with a fresh token', () => {
    expect(identityChanged('u1', 'u1')).toBe(false);
  });
  it('is true on first resolution, when we knew nothing yet', () => {
    expect(identityChanged(undefined, 'u1')).toBe(true);
    expect(identityChanged(undefined, null)).toBe(true);
  });
  it('is true when a different user signs in', () => {
    expect(identityChanged('u1', 'u2')).toBe(true);
  });
  it('is true on sign-out and on sign-in', () => {
    expect(identityChanged('u1', null)).toBe(true);
    expect(identityChanged(null, 'u1')).toBe(true);
  });
  it('is false when signed out and still signed out', () => {
    expect(identityChanged(null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/authIdentity.test.ts`
Expected: FAIL — `Failed to resolve import "./authIdentity"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/authIdentity.ts`:

```ts
// Who is signed in, reduced to a comparable string.
//
// supabase-js auto-refreshes its token whenever the tab regains visibility and
// emits an auth event carrying a BRAND-NEW session object for the same person.
// React sees a new object identity and re-runs anything keyed on the session —
// which used to blow away `org`, render App's spinner branch, and unmount Coach
// mid-1:1. Comparing user ids instead of object identity makes a token refresh
// the no-op it should always have been.

/** The signed-in user's id, or null when signed out / not a real session. */
export function userIdOf(session: { user?: { id?: string } | null } | null | undefined): string | null {
  return session?.user?.id ?? null;
}

/**
 * Should the app rebuild everything keyed to the signed-in user?
 *
 * `prev === undefined` means we had not resolved anyone yet, so the first
 * answer always counts as a change — including the first "nobody is signed in".
 */
export function identityChanged(prev: string | null | undefined, next: string | null): boolean {
  if (prev === undefined) return true;
  return prev !== next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/authIdentity.test.ts`
Expected: PASS (11 assertions across 8 tests).

- [ ] **Step 5: Wire it into `App.tsx`**

In `web/src/App.tsx`, add to the imports:

```tsx
import { userIdOf, identityChanged } from './lib/authIdentity';
```

Replace the two effects at lines 40–58 with:

```tsx
  // The signed-in user id we have already reacted to. A ref, not state, so a
  // token refresh cannot schedule a render on its own.
  const seenUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isDemo) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      // Only publish the session when the PERSON changed. Tab-focus token
      // refreshes land here constantly with a new object for the same user;
      // publishing those unmounts whatever the leader is in the middle of.
      if (identityChanged(seenUserId.current, userIdOf(s))) setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isDemo || session === undefined) return;
    const nextUserId = userIdOf(session);
    if (!identityChanged(seenUserId.current, nextUserId)) return;
    seenUserId.current = nextUserId;
    if (!session) {
      setOrg(null);
      return;
    }
    setOrg(undefined);
    myOrg().then((o) => setOrg(o));
  }, [session]);
```

Add `useRef` to the React import on line 1:

```tsx
import { useEffect, useRef, useState } from 'react';
```

- [ ] **Step 6: Typecheck and run the full web suite**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/authIdentity.ts web/src/lib/authIdentity.test.ts web/src/App.tsx
git commit -m "fix: don't rebuild the app when a tab-focus token refresh arrives

supabase-js refreshes its token on tab focus and emits a new session object
for the same user. App.tsx keyed an effect on that object, so returning from
another tab reset org to undefined, rendered the spinner branch and unmounted
Coach — losing which agent's 1:1 was open. Compare user ids instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Put the open agent in the route

Even with Task 1, a real refresh or the back button still drops the leader on the roster, because which agent is open lives only in `Coach`'s local state.

**Files:**
- Create: `web/src/lib/coachRoute.ts`
- Test: `web/src/lib/coachRoute.test.ts`
- Modify: `web/src/App.tsx:82-89`, `web/src/pages/Coach.tsx:137-140,301,349-413`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `coachRoute(agentId: string | null): string`, `parseCoachAgentId(route: string): string | null`, `isCoachRoute(route: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/coachRoute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { coachRoute, parseCoachAgentId, isCoachRoute } from './coachRoute';

describe('coachRoute', () => {
  it('builds the roster route when no agent is open', () => {
    expect(coachRoute(null)).toBe('/coach');
  });
  it('builds a per-agent route', () => {
    expect(coachRoute('a1')).toBe('/coach/a1');
  });
  it('escapes an id so it cannot break out of the path', () => {
    expect(coachRoute('a/b?c')).toBe('/coach/a%2Fb%3Fc');
  });
});

describe('parseCoachAgentId', () => {
  it('finds the agent id', () => {
    expect(parseCoachAgentId('/coach/a1')).toBe('a1');
  });
  it('decodes an escaped id', () => {
    expect(parseCoachAgentId('/coach/a%2Fb%3Fc')).toBe('a/b?c');
  });
  it('returns null on the bare roster route', () => {
    expect(parseCoachAgentId('/coach')).toBeNull();
    expect(parseCoachAgentId('/coach/')).toBeNull();
  });
  it('returns null for other routes', () => {
    expect(parseCoachAgentId('/pulse')).toBeNull();
    expect(parseCoachAgentId('/')).toBeNull();
    // Must not match a sibling route that merely starts with the same letters.
    expect(parseCoachAgentId('/coaching')).toBeNull();
  });
  it('ignores a query string', () => {
    expect(parseCoachAgentId('/coach/a1?x=1')).toBe('a1');
  });
});

describe('isCoachRoute', () => {
  it('accepts the roster and the drill-in', () => {
    expect(isCoachRoute('/coach')).toBe(true);
    expect(isCoachRoute('/coach/a1')).toBe(true);
  });
  it('rejects everything else, including near-misses', () => {
    expect(isCoachRoute('/coaching')).toBe(false);
    expect(isCoachRoute('/pulse')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/coachRoute.test.ts`
Expected: FAIL — `Failed to resolve import "./coachRoute"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/coachRoute.ts`:

```ts
// The Coach hash route: `#/coach` for the roster, `#/coach/<agentId>` for one
// agent's 1:1 sheet. Keeping the open agent in the URL means a refresh, the
// back button, and a bookmark all land back on the same sheet instead of the
// top of the team list.
//
// Pure string work on purpose — no `window` — so it is unit-testable in the
// node test environment the web package uses.

/** Strip any query string; routes here never carry one meaningfully. */
function pathOf(route: string): string {
  return route.split('?')[0];
}

export function coachRoute(agentId: string | null): string {
  return agentId ? `/coach/${encodeURIComponent(agentId)}` : '/coach';
}

export function isCoachRoute(route: string): boolean {
  const p = pathOf(route);
  return p === '/coach' || p.startsWith('/coach/');
}

export function parseCoachAgentId(route: string): string | null {
  const p = pathOf(route);
  if (!p.startsWith('/coach/')) return null;
  const raw = p.slice('/coach/'.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // a malformed escape is still better than crashing the route
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/coachRoute.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Route `/coach/<agentId>` in `App.tsx`**

The current dispatch matches `route === '/coach'` exactly, so `/coach/a1` would
fall through to `Home`. In `web/src/App.tsx` add to the imports:

```tsx
import { isCoachRoute, parseCoachAgentId, coachRoute } from './lib/coachRoute';
```

Replace the `shell` helper (lines 82–89) with:

```tsx
  // The HQ shell: home (product cards) ↔ a product module (Pulse), by hash route.
  const shell = (o: { id: string; name: string }, adminLeaders?: AdminLeader[]) =>
    route === '/pulse'
      ? <Dashboard org={o} onHome={() => go('/')} />
      : isCoachRoute(route)
        ? (
          <Coach
            org={o}
            onHome={() => go('/')}
            openAgentId={parseCoachAgentId(route)}
            onOpenAgent={(id) => go(coachRoute(id))}
          />
        )
      : route === '/rep'
        ? <Rep org={o} onHome={() => go('/')} />
        : <Home org={o} onOpenPulse={() => go('/pulse')} onOpenRep={() => go('/rep')} adminLeaders={adminLeaders} />;
```

- [ ] **Step 6: Drive the roster `openId` from the route in `Coach.tsx`**

**Only** the roster-level `openId` at line ~140. Leave the commitment accordion's
`openId` at line ~1393 completely alone.

Change the `Coach` signature (line 137) to accept the two new props:

```tsx
export default function Coach({
  org,
  onHome,
  openAgentId = null,
  onOpenAgent,
}: {
  org: { id: string; name: string };
  onHome?: () => void;
  openAgentId?: string | null;
  onOpenAgent?: (id: string | null) => void;
}) {
```

Replace the `openId` state declaration on line 140:

```tsx
  // Which agent's 1:1 is open lives in the ROUTE (see lib/coachRoute), so a
  // refresh or the back button returns to the same sheet. `setOpenId` keeps its
  // name and signature so every existing call site is unchanged; it now
  // navigates instead of setting local state. Falls back to local state only
  // when rendered without a router (the ?demo=1 preview).
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const openId = onOpenAgent ? openAgentId : localOpenId;
  const setOpenId = onOpenAgent ?? setLocalOpenId;
```

Every existing `setOpenId(...)` call (lines ~301, 349, 350, 367, 385, 386, 413) now works unchanged.

- [ ] **Step 7: Typecheck and run the full web suite**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/coachRoute.ts web/src/lib/coachRoute.test.ts web/src/App.tsx web/src/pages/Coach.tsx
git commit -m "feat: keep the open 1:1 agent in the hash route

#/coach/<agentId> drives which sheet is open, so a refresh, the back button
and a bookmark all return to that agent instead of the top of the roster.
App's dispatch matched '/coach' exactly, so the nested route needed routing
too. setOpenId keeps its name and signature — every call site is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Restore scroll position per agent

**Files:**
- Create: `web/src/lib/scrollMemory.ts`
- Test: `web/src/lib/scrollMemory.test.ts`
- Modify: `web/src/pages/Coach.tsx` (the `AgentDrill` component, line ~726)

**Interfaces:**
- Consumes: nothing.
- Produces: `scrollKey(agentId: string): string`, `saveScroll(store: ScrollStore | null, key: string, y: number): void`, `readScroll(store: ScrollStore | null, key: string): number | null`, `type ScrollStore = Pick<Storage, 'getItem' | 'setItem'>`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/scrollMemory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scrollKey, saveScroll, readScroll, type ScrollStore } from './scrollMemory';

/** A stand-in for sessionStorage — the node test env has no window. */
function fakeStore(): ScrollStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

describe('scrollKey', () => {
  it('is namespaced per agent', () => {
    expect(scrollKey('a1')).toBe('pulse:1on1scroll:a1');
    expect(scrollKey('a1')).not.toBe(scrollKey('a2'));
  });
});

describe('saveScroll / readScroll', () => {
  it('round-trips an offset', () => {
    const s = fakeStore();
    saveScroll(s, scrollKey('a1'), 420);
    expect(readScroll(s, scrollKey('a1'))).toBe(420);
  });

  it('returns null for an agent never scrolled', () => {
    expect(readScroll(fakeStore(), scrollKey('a1'))).toBeNull();
  });

  it('keeps each agent separate', () => {
    const s = fakeStore();
    saveScroll(s, scrollKey('a1'), 100);
    saveScroll(s, scrollKey('a2'), 900);
    expect(readScroll(s, scrollKey('a1'))).toBe(100);
    expect(readScroll(s, scrollKey('a2'))).toBe(900);
  });

  it('rejects a stored value that is not a usable number', () => {
    const s = fakeStore();
    s.map.set(scrollKey('a1'), 'not-a-number');
    expect(readScroll(s, scrollKey('a1'))).toBeNull();
    s.map.set(scrollKey('a2'), '-5');
    expect(readScroll(s, scrollKey('a2'))).toBeNull();
  });

  it('is a no-op without a store, instead of throwing', () => {
    expect(() => saveScroll(null, scrollKey('a1'), 10)).not.toThrow();
    expect(readScroll(null, scrollKey('a1'))).toBeNull();
  });

  it('survives a store that throws (private mode / quota)', () => {
    const hostile: ScrollStore = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(() => saveScroll(hostile, scrollKey('a1'), 10)).not.toThrow();
    expect(readScroll(hostile, scrollKey('a1'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/scrollMemory.test.ts`
Expected: FAIL — `Failed to resolve import "./scrollMemory"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/scrollMemory.ts`:

```ts
// Where the leader was scrolled to in an agent's 1:1 sheet, remembered per
// agent for the life of the tab. sessionStorage rather than localStorage: a
// scroll offset is worth restoring on a tab switch or refresh, but a week-old
// offset restored into a re-laid-out page would be noise.
//
// The store is injected so this is testable in the node environment the web
// package's vitest config uses, where `window` does not exist.

export type ScrollStore = Pick<Storage, 'getItem' | 'setItem'>;

export function scrollKey(agentId: string): string {
  return `pulse:1on1scroll:${agentId}`;
}

/** Best-effort: a storage failure must never break the sheet. */
export function saveScroll(store: ScrollStore | null, key: string, y: number): void {
  if (!store) return;
  try {
    store.setItem(key, String(Math.round(y)));
  } catch {
    /* private mode, quota, disabled storage — nothing to do */
  }
}

/** The saved offset, or null when absent or unusable. */
export function readScroll(store: ScrollStore | null, key: string): number | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/scrollMemory.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire it into `AgentDrill`**

In `web/src/pages/Coach.tsx`, add to the imports at the top of the file:

```tsx
import { scrollKey, saveScroll, readScroll } from '../lib/scrollMemory';
```

Inside `AgentDrill` (line ~726), immediately after its existing `useState`
declarations, add:

```tsx
  // Remember where the leader was in THIS agent's sheet. Restoring on mount is
  // what makes returning from another tab land on the same line rather than the
  // top — the route (Task 2) gets them back to the right agent, this gets them
  // back to the right place in it.
  useEffect(() => {
    const store = typeof window === 'undefined' ? null : window.sessionStorage;
    const key = scrollKey(agent.id);
    const saved = readScroll(store, key);
    if (saved !== null) {
      // After paint, or the page is not yet tall enough to scroll to it.
      requestAnimationFrame(() => window.scrollTo({ top: saved }));
    }
    let raf = 0;
    const onScroll = () => {
      if (raf) return;               // coalesce to one write per frame
      raf = requestAnimationFrame(() => {
        raf = 0;
        saveScroll(store, key, window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [agent.id]);
```

- [ ] **Step 6: Typecheck and run the full web suite**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/scrollMemory.ts web/src/lib/scrollMemory.test.ts web/src/pages/Coach.tsx
git commit -m "feat: restore scroll position per agent in the 1:1 sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Verify Part 2 by hand in the real app**

Run: `cd web && npm run dev`

Check all four, which are the acceptance criteria from the spec:
1. Open an agent's 1:1, type into a field, scroll down. Switch to another tab, wait ~10s, come back → **nothing moves, no spinner, no re-animation.**
2. Hard-refresh mid-1:1 → lands back on the same agent's sheet.
3. Browser back from a 1:1 → returns to the roster.
4. Open agent A, scroll, back to roster, open agent B → B starts at the top, not A's offset.

---

# Part 1 — Owner intake form

### Task 4: Consolidate provisioning

`provision()` writes `orgs`, `memberships`, `org_settings`, `teams`, `team_secrets`. It omits `leaders` (so Coach's `current_team_id()` returns null and the whole Coach product is broken for that tenant) and `entitlements`. It also encrypts keys itself, duplicating `connectTeamKey()` — which is the version that additionally registers FUB webhooks and kicks off the first sync. This task makes `provision()` write tenant rows only, and makes `connectTeamKey()` the single path that puts a key on a team.

**Files:**
- Modify: `worker/src/provision.ts` (whole file)
- Modify: `worker/src/index.ts:115-131` (the `/provision` route)
- Test: `worker/src/intake.test.ts` (created here, extended in Task 5)

**Interfaces:**
- Produces:
  ```ts
  export interface ProvisionMember { userId: string; role: string; name?: string; email?: string; teamIndex?: number }
  export interface ProvisionTeam { name: string; subdomain?: string }
  export interface ProvisionInput { orgName: string; members: ProvisionMember[]; teams: ProvisionTeam[]; products?: string[] }
  export async function provision(env: Env, database: Db, input: ProvisionInput): Promise<{ orgId: string; teamIds: string[] }>
  ```

- [ ] **Step 1: Write the failing test**

Create `worker/src/intake.test.ts`:

```ts
// Provisioning + intake. The Worker talks to Supabase and Resend over plain
// fetch, so the whole world is stubbed at the fetch boundary and the real
// exported handler runs end to end. Same shape as routes-auth.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

const env = {
  SUPABASE_URL: SUPA,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  FUB_ENC_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
  ADMIN_TOKEN: 'ops-token',
  RESEND_API_KEY: 'resend-key',
  INVITE_FROM: 'TRU HQ <hq@truhq.co>',
  BRIEF_FROM: 'DO NOT TOUCH <reports@truhq.co>',
} as Env;

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

interface Inserted { table: string; row: any }
interface World {
  users: Record<string, string>;            // bearer token → user id
  platformAdmins: string[];                 // rows in `admins`
  existingAuthUsers: Record<string, string>; // email → existing auth user id
}
let world: World;
let inserted: Inserted[];
let upserts: Array<{ table: string; rows: any[] }>;
let generatedLinks: Array<{ type: string; email: string }>;
let sentEmails: Array<{ from: string; to: any; subject: string; html: string }>;
let seq: number;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  inserted = []; upserts = []; generatedLinks = []; sentEmails = []; seq = 0;
  world = { users: { owner: 'owner-1' }, platformAdmins: ['owner-1'], existingAuthUsers: {} };

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (u.pathname === '/auth/v1/user') {
      const bearer = String((init?.headers as any)?.Authorization ?? '').replace('Bearer ', '');
      const id = world.users[bearer];
      return id ? ok({ id }) : ok({ error: 'bad token' }, 401);
    }

    // Supabase admin: mint an invite / recovery link, creating the user if new.
    if (u.pathname === '/auth/v1/admin/generate_link') {
      generatedLinks.push({ type: body.type, email: body.email });
      const existing = world.existingAuthUsers[body.email];
      const id = existing ?? `new-user-${++seq}`;
      world.existingAuthUsers[body.email] = id;
      return ok({ properties: { action_link: `https://app.truhq.co/#access_token=tok${seq}&type=${body.type}` }, user: { id } });
    }

    if (u.host === 'api.resend.com') {
      sentEmails.push(body);
      return ok({ id: 'email-1' });
    }

    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      const q = u.search.slice(1);
      const eq = (col: string) => {
        const m = q.match(new RegExp(`(?:^|&)${col}=eq\\.([^&]+)`));
        return m ? decodeURIComponent(m[1]) : null;
      };
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        if (String((init?.headers as any)?.Prefer ?? '').includes('resolution=')) {
          upserts.push({ table, rows });
          return new Response(null, { status: 204 });
        }
        const withIds = rows.map((r: any) => ({ ...r, id: r.id ?? `${table}-${++seq}` }));
        withIds.forEach((r) => inserted.push({ table, row: r }));
        return ok(withIds);
      }
      if (method === 'PATCH') return new Response(null, { status: 204 });
      if (table === 'admins') {
        const id = eq('id');
        return ok(id && world.platformAdmins.includes(id) ? [{ id }] : []);
      }
      return ok([]);
    }

    // FUB — webhook registration during connectTeamKey. No FUB_SYSTEM_KEY is
    // set in this env, so this should never be reached; fail loudly if it is.
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }));
});

const post = (path: string, body: unknown, token?: string) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

const rowsIn = (table: string) => inserted.filter((i) => i.table === table).map((i) => i.row);

// ════════════════════════════════════════════════════════════════════════════
describe('provision — completeness', () => {
  it('writes the rows Coach needs, not just the Pulse ones', async () => {
    const res = await post('/provision', {
      orgName: 'Acme Realty',
      userId: 'leader-1',
      teams: [{ name: 'Main office', fubKey: 'fka_key' }],
    }, undefined);
    expect(res.status).toBe(401); // no admin token, no bearer → refused
  });

  it('creates org, membership, settings, entitlements and a team', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': 'ops-token' },
        body: JSON.stringify({
          orgName: 'Acme Realty',
          userId: 'leader-1',
          teams: [{ name: 'Main office', fubKey: 'fka_key' }],
        }),
      }),
      env, ctx,
    );
    expect(res.status).toBe(200);
    expect(rowsIn('orgs')[0]).toMatchObject({ name: 'Acme Realty' });
    expect(rowsIn('memberships')[0]).toMatchObject({ user_id: 'leader-1', role: 'admin' });
    expect(rowsIn('teams')[0]).toMatchObject({ name: 'Main office' });
    // The gap this task closes: Coach is dead without entitlements.
    const ent = upserts.filter((u) => u.table === 'entitlements').flatMap((u) => u.rows);
    expect(ent.map((r: any) => r.product).sort()).toEqual(['coach', 'pulse']);
  });

  it('stores the FUB key exactly once, through connectTeamKey', async () => {
    await worker.fetch(
      new Request('https://worker.test/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': 'ops-token' },
        body: JSON.stringify({ orgName: 'Acme', userId: 'leader-1', teams: [{ name: 'Main', fubKey: 'fka_key' }] }),
      }),
      env, ctx,
    );
    const secrets = upserts.filter((u) => u.table === 'team_secrets');
    expect(secrets).toHaveLength(1);
    expect(secrets[0].rows[0].fub_key_enc).toBeTruthy();
    // And a first sync was scheduled rather than waited on.
    expect(ctx.waitUntil).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/intake.test.ts`
Expected: FAIL — no `entitlements` upsert, and two `team_secrets` upserts.

- [ ] **Step 3: Rewrite `provision.ts`**

Replace the entire contents of `worker/src/provision.ts`:

```ts
// Tenant provisioning — every row a new brokerage needs to exist, written with
// the service role (which sidesteps the RLS bootstrap catch-22).
//
// Deliberately does NOT store Follow Up Boss keys. `connectTeamKey()` in
// index.ts is the single path that puts a key on a team, because it also
// registers FUB webhooks and kicks off the first sync — steps this module used
// to skip, leaving tenants silently cron-only. Callers provision first, then
// connect each team's key with the ids returned here.
//
// The row set mirrors the Coach signup RPC `create_team()` in
// db/hq_coach_compat.sql. The two had drifted: this path omitted `leaders`
// (so Coach's current_team_id() returned null and the product was dead for the
// tenant) and `entitlements`.
import type { Env } from './env.js';
import type { Db } from './db.js';

/** A person who should be able to sign in and lead. */
export interface ProvisionMember {
  userId: string;               // Supabase auth.users id
  role: string;                 // 'admin' | 'leader' | 'coach'
  name?: string;                // present → also gets a Coach `leaders` row
  email?: string;               // required alongside `name`
  teamIndex?: number;           // which of `teams` they lead; defaults to 0
}

export interface ProvisionTeam {
  name: string;
  subdomain?: string;
}

export interface ProvisionInput {
  orgName: string;
  members: ProvisionMember[];
  teams: ProvisionTeam[];
  products?: string[];          // entitlements; defaults to pulse + coach
}

export const DEFAULT_PRODUCTS = ['pulse', 'coach'];

export async function provision(
  env: Env,
  database: Db,
  input: ProvisionInput,
): Promise<{ orgId: string; teamIds: string[] }> {
  const org = await database.insert('orgs', { name: input.orgName });
  await database.insert('org_settings', { org_id: org.id });

  const teamIds: string[] = [];
  for (const t of input.teams) {
    const team = await database.insert('teams', {
      org_id: org.id,
      name: t.name,
      fub_subdomain: t.subdomain ?? null,
    });
    teamIds.push(team.id);
  }

  for (const m of input.members) {
    await database.insert('memberships', { org_id: org.id, user_id: m.userId, role: m.role });
    // A Coach identity, so current_team_id() resolves for them. Two leaders on
    // one team is two rows sharing a team_id — native to the schema, since
    // leaders.id is the auth user id.
    if (m.name && m.email) {
      const teamId = teamIds[m.teamIndex ?? 0] ?? teamIds[0] ?? null;
      await database.upsert(
        'leaders',
        [{ id: m.userId, team_id: teamId, name: m.name, email: m.email }],
        'id',
      );
    }
  }

  const products = input.products ?? DEFAULT_PRODUCTS;
  await database.upsert(
    'entitlements',
    products.map((product) => ({ org_id: org.id, product })),
    'org_id,product',
  );

  return { orgId: org.id, teamIds };
}
```

- [ ] **Step 4: Update the `/provision` route to connect keys**

In `worker/src/index.ts`, replace the `/provision` route (lines 115–131) with:

```ts
    // Provision a tenant. Admin token → userId from body; else the signed-in user.
    // Keys are stored by connectTeamKey (below) rather than by provision(), so
    // this path also registers FUB webhooks and starts a first sync — which it
    // silently never did before.
    if (url.pathname === '/provision' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as any;
      if (!body?.orgName || !Array.isArray(body?.teams)) {
        return json({ error: 'orgName and teams[] required' }, 422);
      }
      const userId = isAdmin(req, env)
        ? (body.userId ?? null)
        : await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      try {
        const teams = (body.teams as Array<{ name: string; fubKey?: string; subdomain?: string }>);
        const result = await provision(env, database, {
          orgName: body.orgName,
          members: [{ userId, role: body.role ?? 'admin', name: body.name, email: body.email }],
          teams: teams.map((t) => ({ name: t.name, subdomain: t.subdomain })),
        });
        for (let i = 0; i < teams.length; i++) {
          const key = teams[i].fubKey;
          if (!key) continue;
          await connectTeamKey(
            env, database, ctx, url.origin,
            { id: result.teamIds[i], org_id: result.orgId },
            key,
            teams[i].subdomain ?? null,
          );
        }
        return json(result);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/intake.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the whole worker suite and typecheck**

Run: `cd worker && npm run typecheck && npm test`
Expected: all pass. `provision()`'s only other caller is the `/provision` route, updated above — if typecheck reports another, update it to the new shape.

- [ ] **Step 7: Commit**

```bash
git add worker/src/provision.ts worker/src/index.ts worker/src/intake.test.ts
git commit -m "fix: provision the rows Coach needs, and store keys in one place

provision() omitted leaders and entitlements, so a tenant created this way had
a dead Coach (current_team_id() returned null). It also encrypted keys itself,
duplicating connectTeamKey — the version that ALSO registers FUB webhooks and
starts a first sync. Tenants from the self-serve onboarding screen were
therefore silently cron-only. provision() now writes tenant rows only and
connectTeamKey is the single path that puts a key on a team.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The intake endpoint

**Files:**
- Create: `worker/src/invite.ts`
- Create: `worker/src/intake.ts`
- Modify: `worker/src/index.ts` (add two routes inside the `/admin/` block)
- Modify: `worker/src/env.ts`, `worker/wrangler.toml`
- Test: `worker/src/intake.test.ts` (extend)

**Interfaces:**
- Consumes: `provision`, `ProvisionMember` (Task 4); `connectTeamKey` (existing, `index.ts:79`).
- Produces:
  ```ts
  // invite.ts
  export function inviteEmailHtml(o: { name: string; orgName: string; link: string }): string
  export function inviteEmailSubject(orgName: string): string
  export async function mintAuthLink(env: Env, email: string, kind: 'invite' | 'recovery'): Promise<{ link: string; userId: string | null }>
  export async function sendInviteEmail(env: Env, o: { to: string; name: string; orgName: string; link: string }): Promise<boolean>
  // intake.ts
  export interface IntakeLeader { name: string; email: string; teamIndex?: number }
  export interface IntakeTeam { name: string; fubKey: string; subdomain?: string }
  export interface IntakeInput { orgName: string; teams: IntakeTeam[]; leaders: IntakeLeader[] }
  export interface IntakeLeaderResult { name: string; email: string; status: 'invited' | 'email_failed' | 'failed'; link?: string; error?: string }
  export interface IntakeResult { orgId: string; teamIds: string[]; leaders: IntakeLeaderResult[] }
  export function validateIntake(input: unknown): { ok: true; value: IntakeInput } | { ok: false; error: string }
  export async function runIntake(env: Env, database: Db, ctx: ExecutionContext, origin: string, input: IntakeInput): Promise<IntakeResult>
  ```

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/intake.test.ts`:

```ts
// ════════════════════════════════════════════════════════════════════════════
import { validateIntake } from './intake.js';

describe('validateIntake', () => {
  const good = {
    orgName: 'Acme Realty',
    teams: [{ name: 'Main', fubKey: 'fka_key' }],
    leaders: [{ name: 'Dana Lee', email: 'dana@acme.com' }],
  };

  it('accepts a complete payload', () => {
    const r = validateIntake(good);
    expect(r.ok).toBe(true);
  });

  it('requires a brokerage name', () => {
    const r = validateIntake({ ...good, orgName: '  ' });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('name') });
  });

  it('requires at least one team with a key — Eric chose to always require it', () => {
    expect(validateIntake({ ...good, teams: [] }).ok).toBe(false);
    expect(validateIntake({ ...good, teams: [{ name: 'Main', fubKey: '' }] }).ok).toBe(false);
    expect(validateIntake({ ...good, teams: [{ name: '', fubKey: 'fka_k' }] }).ok).toBe(false);
  });

  it('requires at least one leader with a plausible email', () => {
    expect(validateIntake({ ...good, leaders: [] }).ok).toBe(false);
    expect(validateIntake({ ...good, leaders: [{ name: 'Dana Lee', email: 'nope' }] }).ok).toBe(false);
    expect(validateIntake({ ...good, leaders: [{ name: '', email: 'dana@acme.com' }] }).ok).toBe(false);
  });

  it('rejects two leaders sharing one email', () => {
    const r = validateIntake({
      ...good,
      leaders: [
        { name: 'Dana Lee', email: 'dana@acme.com' },
        { name: 'Sam Ruiz', email: 'DANA@acme.com' }, // case-insensitive
      ],
    });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('once') });
  });

  it('rejects a leader pointed at a team that does not exist', () => {
    const r = validateIntake({ ...good, leaders: [{ name: 'Dana Lee', email: 'd@a.com', teamIndex: 3 }] });
    expect(r.ok).toBe(false);
  });

  it('trims whitespace and lowercases the email', () => {
    const r = validateIntake({
      orgName: '  Acme Realty ',
      teams: [{ name: ' Main ', fubKey: ' fka_key ' }],
      leaders: [{ name: ' Dana Lee ', email: '  Dana@Acme.com ' }],
    });
    if (!r.ok) throw new Error('expected valid');
    expect(r.value.orgName).toBe('Acme Realty');
    expect(r.value.teams[0]).toMatchObject({ name: 'Main', fubKey: 'fka_key' });
    expect(r.value.leaders[0]).toMatchObject({ name: 'Dana Lee', email: 'dana@acme.com' });
  });
});

describe('POST /admin/intake', () => {
  const payload = {
    orgName: 'Acme Realty',
    teams: [{ name: 'Main office', fubKey: 'fka_key' }],
    leaders: [
      { name: 'Dana Lee', email: 'dana@acme.com' },
      { name: 'Sam Ruiz', email: 'sam@acme.com' },
    ],
  };

  it('refuses a caller who is not a platform owner', async () => {
    world.users['nobody'] = 'u-9';        // signed in, but not in `admins`
    const res = await post('/admin/intake', payload, 'nobody');
    expect(res.status).toBe(403);
    expect(inserted).toEqual([]);          // nothing written
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/admin/intake', payload)).status).toBe(401);
    expect(inserted).toEqual([]);
  });

  it('rejects an invalid payload before writing anything', async () => {
    const res = await post('/admin/intake', { ...payload, leaders: [] }, 'owner');
    expect(res.status).toBe(422);
    expect(inserted).toEqual([]);
    expect(sentEmails).toEqual([]);
  });

  it('creates the tenant, invites both leaders, and emails each of them', async () => {
    const res = await post('/admin/intake', payload, 'owner');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(rowsIn('orgs')[0]).toMatchObject({ name: 'Acme Realty' });
    expect(rowsIn('teams')).toHaveLength(1);

    // Two leaders → two logins, two memberships, two Coach identities on ONE team.
    expect(rowsIn('memberships')).toHaveLength(2);
    const leaderRows = upserts.filter((u) => u.table === 'leaders').flatMap((u) => u.rows);
    expect(leaderRows).toHaveLength(2);
    expect(new Set(leaderRows.map((r: any) => r.team_id)).size).toBe(1);
    expect(leaderRows.map((r: any) => r.email).sort()).toEqual(['dana@acme.com', 'sam@acme.com']);

    // A brand-new email gets an `invite` link, which creates the auth user.
    expect(generatedLinks.map((l) => l.type)).toEqual(['invite', 'invite']);

    // One email each, from INVITE_FROM — never BRIEF_FROM.
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails.every((e) => e.from === 'TRU HQ <hq@truhq.co>')).toBe(true);
    expect(sentEmails.some((e) => e.from.includes('reports@'))).toBe(false);
    expect(sentEmails[0].html).toContain('Acme Realty');
    expect(sentEmails[0].html).toContain('https://app.truhq.co/#access_token=');

    expect(body.leaders.map((l: any) => l.status)).toEqual(['invited', 'invited']);
    expect(body.orgId).toBeTruthy();
  });

  it('brings the team online: key stored, first sync scheduled', async () => {
    await post('/admin/intake', payload, 'owner');
    const secrets = upserts.filter((u) => u.table === 'team_secrets');
    expect(secrets).toHaveLength(1);
    expect(secrets[0].rows[0].fub_key_enc).toBeTruthy();
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('sends a recovery link when the leader already has a login', async () => {
    world.existingAuthUsers['dana@acme.com'] = 'existing-1';
    await post('/admin/intake', { ...payload, leaders: [payload.leaders[0]] }, 'owner');
    expect(generatedLinks).toEqual([{ type: 'recovery', email: 'dana@acme.com' }]);
  });

  it('keeps the tenant when a leader email fails to send, and reports it', async () => {
    const realFetch = globalThis.fetch as any;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (new URL(url).host === 'api.resend.com') return new Response('nope', { status: 422 });
      return realFetch(input, init);
    }));

    const res = await post('/admin/intake', { ...payload, leaders: [payload.leaders[0]] }, 'owner');
    expect(res.status).toBe(200);           // the team is real; do not roll it back
    const body = (await res.json()) as any;
    expect(body.leaders[0].status).toBe('email_failed');
    expect(body.leaders[0].link).toContain('https://app.truhq.co/#access_token=');
    expect(rowsIn('orgs')).toHaveLength(1); // still provisioned
  });

  it('assigns each leader to the team the form pointed them at', async () => {
    await post('/admin/intake', {
      orgName: 'Two Office Realty',
      teams: [{ name: 'North', fubKey: 'fka_n' }, { name: 'South', fubKey: 'fka_s' }],
      leaders: [
        { name: 'Dana Lee', email: 'dana@acme.com', teamIndex: 0 },
        { name: 'Sam Ruiz', email: 'sam@acme.com', teamIndex: 1 },
      ],
    }, 'owner');
    const teamIds = rowsIn('teams').map((t: any) => t.id);
    const leaderRows = upserts.filter((u) => u.table === 'leaders').flatMap((u) => u.rows);
    expect(leaderRows.find((r: any) => r.email === 'dana@acme.com').team_id).toBe(teamIds[0]);
    expect(leaderRows.find((r: any) => r.email === 'sam@acme.com').team_id).toBe(teamIds[1]);
    expect(upserts.filter((u) => u.table === 'team_secrets')).toHaveLength(2);
  });
});

describe('POST /admin/resend-invite', () => {
  it('mints a recovery link for a leader who already has a login', async () => {
    world.existingAuthUsers['dana@acme.com'] = 'existing-1';
    const res = await post('/admin/resend-invite', { email: 'dana@acme.com', orgName: 'Acme Realty', name: 'Dana Lee' }, 'owner');
    expect(res.status).toBe(200);
    expect(generatedLinks).toEqual([{ type: 'recovery', email: 'dana@acme.com' }]);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].from).toBe('TRU HQ <hq@truhq.co>');
  });

  it('refuses a caller who is not a platform owner', async () => {
    world.users['nobody'] = 'u-9';
    expect((await post('/admin/resend-invite', { email: 'd@a.com' }, 'nobody')).status).toBe(403);
    expect(sentEmails).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run src/intake.test.ts`
Expected: FAIL — `Failed to resolve import "./intake.js"`.

- [ ] **Step 3: Write `invite.ts`**

Create `worker/src/invite.ts`:

```ts
// Leader invites — mint a Supabase auth link and email it.
//
// SENDER: this module reads INVITE_FROM and nothing else. BRIEF_FROM belongs to
// the weekly report mail (hustle score / PCVR) that leaders already rely on;
// keeping the two senders independent means an invite problem can never take
// reporting down. Resend has exactly ONE verified domain, truhq.co — any other
// domain is rejected silently, so INVITE_FROM must be @truhq.co.
import type { Env } from './env.js';

export function inviteEmailSubject(orgName: string): string {
  return `Set your password for ${orgName} on TRU HQ`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Warm gold on near-black, matching the TRU HQ auth screens. */
export function inviteEmailHtml(o: { name: string; orgName: string; link: string }): string {
  const name = escapeHtml(o.name.split(' ')[0] || o.name);
  const org = escapeHtml(o.orgName);
  const link = escapeHtml(o.link);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#111014;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111014;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#17161b;border:1px solid #2a2731;border-radius:16px;padding:32px">
        <tr><td style="color:#e8c98a;font-size:13px;letter-spacing:.14em;text-transform:uppercase;padding-bottom:18px">TRU HQ</td></tr>
        <tr><td style="color:#f4ecdc;font-size:23px;line-height:1.3;font-weight:600;padding-bottom:14px">
          ${name}, your ${org} account is ready.
        </td></tr>
        <tr><td style="color:#a9a3b4;font-size:15px;line-height:1.6;padding-bottom:26px">
          Set your password and you're in — Pulse and Coach, your whole team in one place.
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${link}" style="display:inline-block;background:#e8c98a;color:#17161b;font-size:15px;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:10px">
            Set your password
          </a>
        </td></tr>
        <tr><td style="color:#6f6a7a;font-size:13px;line-height:1.6">
          This link works once and expires in 24 hours. If it's expired, reply and we'll send a fresh one.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Create-or-reuse the auth user and get a one-time link they can sign in with.
 * `invite` creates the user; `recovery` is for an email that already has one.
 */
export async function mintAuthLink(
  env: Env,
  email: string,
  kind: 'invite' | 'recovery',
): Promise<{ link: string; userId: string | null }> {
  const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: kind, email, redirect_to: 'https://app.truhq.co' }),
  });
  const gl = (await res.json().catch(() => null)) as any;
  const props = gl?.properties ?? gl;
  const link = props?.action_link;
  if (!res.ok || !link) throw new Error(`could not mint ${kind} link for ${email}`);
  return { link, userId: gl?.user?.id ?? gl?.id ?? null };
}

/** True when Resend accepted it. Never throws — the caller reports per leader. */
export async function sendInviteEmail(
  env: Env,
  o: { to: string; name: string; orgName: string; link: string },
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.INVITE_FROM) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.INVITE_FROM,
        to: o.to,
        subject: inviteEmailSubject(o.orgName),
        html: inviteEmailHtml({ name: o.name, orgName: o.orgName, link: o.link }),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Does this email already have a login? Decides invite vs recovery. */
export async function authUserIdByEmail(env: Env, email: string): Promise<string | null> {
  const u = new URL(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/users');
  u.searchParams.set('filter', email);
  const res = await fetch(u.toString(), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as any;
  const users: any[] = body?.users ?? [];
  const hit = users.find((x) => String(x?.email ?? '').toLowerCase() === email.toLowerCase());
  return hit?.id ?? null;
}
```

- [ ] **Step 4: Write `intake.ts`**

Create `worker/src/intake.ts`:

```ts
// Owner intake — one call that turns "here is a brokerage and its FUB key" into
// a working tenant whose leaders have been emailed a set-password link.
//
// TRU HQ is sold by hand, so the leader-initiated onboarding screen inverts the
// real motion: Eric holds the key and the relationship. This is the path he
// drives.
//
// Ordering matters. Validation happens first and writes nothing, so a bad
// payload is free. Past that point the tenant is REAL, and a failed invite
// email must not roll it back — otherwise Eric is left guessing what state
// things are in. Each leader reports its own outcome instead.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { provision, type ProvisionMember } from './provision.js';
import { mintAuthLink, sendInviteEmail, authUserIdByEmail } from './invite.js';

export interface IntakeTeam { name: string; fubKey: string; subdomain?: string }
export interface IntakeLeader { name: string; email: string; teamIndex?: number }
export interface IntakeInput { orgName: string; teams: IntakeTeam[]; leaders: IntakeLeader[] }

export interface IntakeLeaderResult {
  name: string;
  email: string;
  /** invited = emailed. email_failed = login exists, link in `link`. failed = no login. */
  status: 'invited' | 'email_failed' | 'failed';
  link?: string;
  error?: string;
}

export interface IntakeResult {
  orgId: string;
  teamIds: string[];
  leaders: IntakeLeaderResult[];
}

/** Deliberately loose — catches typos and empties, not exotic-but-valid addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateIntake(
  input: unknown,
): { ok: true; value: IntakeInput } | { ok: false; error: string } {
  const raw = input as any;
  const orgName = String(raw?.orgName ?? '').trim();
  if (!orgName) return { ok: false, error: 'A brokerage name is required.' };

  if (!Array.isArray(raw?.teams) || raw.teams.length === 0) {
    return { ok: false, error: 'Add at least one Follow Up Boss account.' };
  }
  const teams: IntakeTeam[] = [];
  for (const t of raw.teams) {
    const name = String(t?.name ?? '').trim();
    const fubKey = String(t?.fubKey ?? '').trim();
    if (!name) return { ok: false, error: 'Every Follow Up Boss account needs a name.' };
    if (!fubKey) return { ok: false, error: `Add a Follow Up Boss API key for "${name}".` };
    const subdomain = String(t?.subdomain ?? '').trim();
    teams.push({ name, fubKey, ...(subdomain ? { subdomain } : {}) });
  }

  if (!Array.isArray(raw?.leaders) || raw.leaders.length === 0) {
    return { ok: false, error: 'Add at least one team leader.' };
    }
  const leaders: IntakeLeader[] = [];
  const seen = new Set<string>();
  for (const l of raw.leaders) {
    const name = String(l?.name ?? '').trim();
    const email = String(l?.email ?? '').trim().toLowerCase();
    if (!name) return { ok: false, error: 'Every team leader needs a name.' };
    if (!EMAIL_RE.test(email)) return { ok: false, error: `"${l?.email ?? ''}" is not a valid email address.` };
    if (seen.has(email)) return { ok: false, error: `Each email can only be used once — ${email} appears twice.` };
    seen.add(email);
    const teamIndex = Number.isInteger(l?.teamIndex) ? Number(l.teamIndex) : 0;
    if (teamIndex < 0 || teamIndex >= teams.length) {
      return { ok: false, error: `${name} is assigned to a Follow Up Boss account that doesn't exist.` };
    }
    leaders.push({ name, email, teamIndex });
  }

  return { ok: true, value: { orgName, teams, leaders } };
}

export async function runIntake(
  env: Env,
  database: Db,
  ctx: ExecutionContext,
  origin: string,
  input: IntakeInput,
  connectTeamKey: (
    env: Env, database: Db, ctx: ExecutionContext, origin: string,
    team: { id: string; org_id: string }, fubKey: string, subdomain: string | null,
  ) => Promise<void>,
): Promise<IntakeResult> {
  // 1. Every leader needs a login BEFORE provisioning, because memberships and
  //    the Coach `leaders` row are both keyed by auth user id. A leader whose
  //    email already has a login gets a recovery link instead of an invite, so
  //    re-running intake for an existing person is safe.
  const minted: Array<{ leader: IntakeLeader; link: string | null; userId: string | null; error?: string }> = [];
  for (const leader of input.leaders) {
    try {
      const existing = await authUserIdByEmail(env, leader.email);
      const { link, userId } = await mintAuthLink(env, leader.email, existing ? 'recovery' : 'invite');
      minted.push({ leader, link, userId: userId ?? existing });
    } catch (e) {
      minted.push({ leader, link: null, userId: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const members: ProvisionMember[] = minted
    .filter((m) => m.userId)
    .map((m) => ({
      userId: m.userId as string,
      role: 'leader',
      name: m.leader.name,
      email: m.leader.email,
      teamIndex: m.leader.teamIndex ?? 0,
    }));
  if (members.length === 0) {
    throw new Error('Could not create a login for any of the team leaders — nothing was created.');
  }

  // 2. The tenant itself.
  const { orgId, teamIds } = await provision(env, database, {
    orgName: input.orgName,
    members,
    teams: input.teams.map((t) => ({ name: t.name, subdomain: t.subdomain })),
  });

  // 3. Bring each team's data online through the one path that also registers
  //    FUB webhooks and starts a first sync.
  for (let i = 0; i < input.teams.length; i++) {
    await connectTeamKey(
      env, database, ctx, origin,
      { id: teamIds[i], org_id: orgId },
      input.teams[i].fubKey,
      input.teams[i].subdomain ?? null,
    );
  }

  // 4. Now tell the humans. The tenant already exists, so an email failure is
  //    reported, not fatal — the link is handed back for Eric to pass along.
  const leaders: IntakeLeaderResult[] = [];
  for (const m of minted) {
    if (!m.link || !m.userId) {
      leaders.push({ name: m.leader.name, email: m.leader.email, status: 'failed', error: m.error ?? 'could not create a login' });
      continue;
    }
    const sent = await sendInviteEmail(env, {
      to: m.leader.email, name: m.leader.name, orgName: input.orgName, link: m.link,
    });
    leaders.push(
      sent
        ? { name: m.leader.name, email: m.leader.email, status: 'invited' }
        : { name: m.leader.name, email: m.leader.email, status: 'email_failed', link: m.link },
    );
  }

  return { orgId, teamIds, leaders };
}
```

- [ ] **Step 5: Add the two routes**

In `worker/src/index.ts`, add to the imports near the top:

```ts
import { runIntake, validateIntake } from './intake.js';
import { mintAuthLink, sendInviteEmail, authUserIdByEmail } from './invite.js';
```

Inside the `if (url.pathname.startsWith('/admin/'))` block (after the
`/admin/leaders` handler), add:

```ts
      // Owner intake — create a brokerage from a FUB key and email each of its
      // team leaders a set-password link. Two leaders means two logins.
      if (url.pathname === '/admin/intake' && req.method === 'POST') {
        const parsed = validateIntake(await req.json().catch(() => null));
        if (!parsed.ok) return json({ error: parsed.error }, 422);
        try {
          return json(await runIntake(env, database, ctx, url.origin, parsed.value, connectTeamKey));
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 500);
        }
      }

      // Re-send a leader's set-password link (they expire in 24h, single use).
      if (url.pathname === '/admin/resend-invite' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as any;
        const email = String(body?.email ?? '').trim().toLowerCase();
        const name = String(body?.name ?? '').trim() || email;
        const orgName = String(body?.orgName ?? '').trim() || 'TRU HQ';
        if (!email) return json({ error: 'email required' }, 422);
        try {
          const existing = await authUserIdByEmail(env, email);
          const { link } = await mintAuthLink(env, email, existing ? 'recovery' : 'invite');
          const sent = await sendInviteEmail(env, { to: email, name, orgName, link });
          return json({ sent, link: sent ? undefined : link });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 502);
        }
      }
```

- [ ] **Step 6: Add `INVITE_FROM` and fix the stale sender comment**

In `worker/src/env.ts`, replace the `RESEND_API_KEY` / `BRIEF_FROM` lines with:

```ts
  RESEND_API_KEY?: string;            // Resend — shared by the brief and invite mail
  BRIEF_FROM?: string;                // weekly Leadership Brief sender, e.g. "TRU Pulse <pulse@truhq.co>"
  INVITE_FROM?: string;               // leader set-password invites, e.g. "TRU HQ <hq@truhq.co>"
```

In `worker/wrangler.toml`, replace the `RESEND_API_KEY`/`BRIEF_FROM` comment lines with:

```
#   RESEND_API_KEY               Resend key (weekly brief + leader invites)
#   BRIEF_FROM                   weekly Leadership Brief sender — must be @truhq.co
#   INVITE_FROM                  leader invite sender, e.g. "TRU HQ <hq@truhq.co>"
#                                truhq.co is the ONLY domain verified in Resend; any
#                                other sender domain is rejected SILENTLY.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd worker && npx vitest run src/intake.test.ts`
Expected: PASS (all `validateIntake`, `/admin/intake` and `/admin/resend-invite` tests).

- [ ] **Step 8: Run the whole worker suite and typecheck**

Run: `cd worker && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add worker/src/invite.ts worker/src/intake.ts worker/src/index.ts worker/src/intake.test.ts worker/src/env.ts worker/wrangler.toml
git commit -m "feat: owner intake endpoint — provision a brokerage and invite its leaders

POST /admin/intake, behind the existing admins-table gate: validate, mint a
login per leader (recovery instead of invite when the email already has one),
provision the tenant, bring each team online through connectTeamKey, then
email each leader a set-password link. Validation writes nothing, so a bad
payload is free; past that the tenant is real and an email failure is reported
per leader with the link rather than rolling the brokerage back.

Invites send from the new INVITE_FROM. BRIEF_FROM is untouched — it delivers
the hustle score and PCVR reports leaders already rely on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The intake form UI

**Files:**
- Create: `web/src/components/AdminIntake.tsx`
- Modify: `web/src/lib/api.ts` (append near `adminConnections`, ~line 753)
- Modify: `web/src/pages/Home.tsx` (new panel between "Act as a team" and "Team connections")

**Interfaces:**
- Consumes: `POST /admin/intake` and `POST /admin/resend-invite` (Task 5).
- Produces: `adminIntake(input): Promise<IntakeResult>`, `adminResendInvite(o): Promise<{ sent: boolean; link?: string }>`, `<AdminIntake />`

- [ ] **Step 1: Add the API callers**

Append to `web/src/lib/api.ts`:

```ts
// ── Platform owner: intake a new brokerage ──────────────────────────────────
export interface IntakeLeaderResult {
  name: string;
  email: string;
  status: 'invited' | 'email_failed' | 'failed';
  link?: string;
  error?: string;
}
export interface IntakeResult { orgId: string; teamIds: string[]; leaders: IntakeLeaderResult[] }

export async function adminIntake(input: {
  orgName: string;
  teams: Array<{ name: string; fubKey: string; subdomain?: string }>;
  leaders: Array<{ name: string; email: string; teamIndex: number }>;
}): Promise<IntakeResult> {
  const res = await fetch(WORKER_URL + '/admin/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? 'Could not create the team.');
  return body as IntakeResult;
}

export async function adminResendInvite(o: {
  email: string; name?: string; orgName?: string;
}): Promise<{ sent: boolean; link?: string }> {
  const res = await fetch(WORKER_URL + '/admin/resend-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(o),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? 'Could not resend the invite.');
  return body as { sent: boolean; link?: string };
}
```

- [ ] **Step 2: Write the component**

Create `web/src/components/AdminIntake.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { adminIntake, adminResendInvite, type IntakeResult } from '../lib/api';

// Platform-owner intake. TRU HQ is sold by hand, so this is the path that
// actually gets used: Eric fills it in with the brokerage's Follow Up Boss key,
// and each team leader is emailed a set-password link. Two leaders on one team
// get two separate logins — see the design spec for why.

interface TeamRow { name: string; fubKey: string; subdomain: string }
interface LeaderRow { name: string; email: string; teamIndex: number }

const emptyTeam = (): TeamRow => ({ name: '', fubKey: '', subdomain: '' });
const emptyLeader = (): LeaderRow => ({ name: '', email: '', teamIndex: 0 });

export function AdminIntake() {
  const [orgName, setOrgName] = useState('');
  const [teams, setTeams] = useState<TeamRow[]>([emptyTeam()]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([emptyLeader()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [resent, setResent] = useState<Record<string, string>>({});

  const setTeam = (i: number, patch: Partial<TeamRow>) =>
    setTeams((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const setLeader = (i: number, patch: Partial<LeaderRow>) =>
    setLeaders((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function reset() {
    setOrgName(''); setTeams([emptyTeam()]); setLeaders([emptyLeader()]);
    setResult(null); setError(''); setResent({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setResult(await adminIntake({
        orgName: orgName.trim(),
        teams: teams.map((t) => ({
          name: t.name.trim(),
          fubKey: t.fubKey.trim(),
          ...(t.subdomain.trim() ? { subdomain: t.subdomain.trim() } : {}),
        })),
        leaders: leaders.map((l) => ({
          name: l.name.trim(),
          email: l.email.trim(),
          teamIndex: Math.min(l.teamIndex, teams.length - 1),
        })),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend(email: string, name: string) {
    try {
      const r = await adminResendInvite({ email, name, orgName });
      setResent((m) => ({ ...m, [email]: r.sent ? 'Sent.' : `Send failed — link: ${r.link ?? 'n/a'}` }));
    } catch (err) {
      setResent((m) => ({ ...m, [email]: err instanceof Error ? err.message : String(err) }));
    }
  }

  if (result) {
    return (
      <div>
        <p style={{ color: 'var(--text-60)', marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>{orgName}</strong> is set up. Their leads are
          syncing now — the dashboard fills in within a few minutes.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 10 }}>
          {result.leaders.map((l) => (
            <li key={l.email} style={{ display: 'grid', gap: 4 }}>
              <div>
                <strong>{l.name}</strong> · {l.email}{' '}
                {l.status === 'invited' && <span style={{ color: 'var(--ok, #7ac77a)' }}>— invite sent</span>}
                {l.status === 'email_failed' && <span style={{ color: 'var(--warn, #e0b055)' }}>— account created, email failed</span>}
                {l.status === 'failed' && <span className="err">— could not create a login: {l.error}</span>}
              </div>
              {l.link && (
                <input
                  readOnly
                  value={l.link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`Set-password link for ${l.name}`}
                />
              )}
              {l.status !== 'failed' && (
                <div>
                  <button type="button" className="link" onClick={() => resend(l.email, l.name)}>
                    Resend invite
                  </button>
                  {resent[l.email] && <span style={{ marginLeft: 8, color: 'var(--text-60)' }}>{resent[l.email]}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={reset}>Add another team</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label>Brokerage / team name</label>
      <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Realty" required />

      <h4 style={{ margin: '20px 0 6px' }}>Follow Up Boss accounts</h4>
      {teams.map((t, i) => (
        <div className="row2" key={i}>
          <div className="grow">
            <label>Account name</label>
            <input value={t.name} onChange={(e) => setTeam(i, { name: e.target.value })} placeholder="Main office" required />
          </div>
          <div className="grow">
            <label>API key</label>
            <input value={t.fubKey} onChange={(e) => setTeam(i, { fubKey: e.target.value })} placeholder="fka_…" required />
          </div>
        </div>
      ))}
      <button type="button" className="link" onClick={() => setTeams((ts) => [...ts, emptyTeam()])}>
        + Add another Follow Up Boss account
      </button>

      <h4 style={{ margin: '20px 0 6px' }}>Team leaders</h4>
      <p style={{ color: 'var(--text-60)', fontSize: 13, marginTop: 0 }}>
        Each leader gets their own login and their own set-password email.
      </p>
      {leaders.map((l, i) => (
        <div className="row2" key={i}>
          <div className="grow">
            <label>Name</label>
            <input value={l.name} onChange={(e) => setLeader(i, { name: e.target.value })} placeholder="Dana Lee" required />
          </div>
          <div className="grow">
            <label>Email</label>
            <input type="email" value={l.email} onChange={(e) => setLeader(i, { email: e.target.value })} placeholder="dana@acme.com" required />
          </div>
          {teams.length > 1 && (
            <div className="grow">
              <label>Leads which account</label>
              <select value={l.teamIndex} onChange={(e) => setLeader(i, { teamIndex: Number(e.target.value) })}>
                {teams.map((t, ti) => (
                  <option key={ti} value={ti}>{t.name || `Account ${ti + 1}`}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}
      <button type="button" className="link" onClick={() => setLeaders((ls) => [...ls, emptyLeader()])}>
        + Add another team leader
      </button>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
      <button className="btn full" type="submit" disabled={busy} style={{ marginTop: 16 }}>
        {busy ? 'Setting them up…' : 'Create team & send invites'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Render it in `Home.tsx`**

Add to the imports in `web/src/pages/Home.tsx`:

```tsx
import { AdminIntake } from '../components/AdminIntake';
```

Immediately after the closing `)}` of the "Act as a team" section (line ~327,
before the `{/* ============ FOLLOW UP BOSS ============ */}` comment), insert:

```tsx
          {/* ============ PLATFORM OWNER: Add a team ============ */}
          {adminLeaders && (
            <section className="hqcard hh-panel reveal" data-delay="70" style={{ marginBottom: 18 }}>
              <div className="hh-panel-tag">Platform owner</div>
              <h3>Add a team</h3>
              <p className="hh-panel-sub">
                Set a brokerage up from their Follow Up Boss key. Each team leader gets their own
                login and an email to set their password — nothing for them to configure.
              </p>
              <AdminIntake />
            </section>
          )}
```

- [ ] **Step 4: Typecheck, test, and build**

Run: `cd web && npm run typecheck && npm test && npm run build`
Expected: all clean. (`npm run build` catches JSX errors the node-environment tests cannot.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AdminIntake.tsx web/src/lib/api.ts web/src/pages/Home.tsx
git commit -m "feat: owner intake form on the TRU HQ home panel

Add a team from their Follow Up Boss key; each leader gets their own login and
set-password email. Result view reports per-leader outcome, exposes the link
when an email fails, and offers Resend invite for the 24h expiry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Set `INVITE_FROM` and verify end to end

**Files:** none — deployment and manual verification.

- [ ] **Step 1: Set the secret**

Run:

```bash
cd worker && CLOUDFLARE_API_TOKEN= npx wrangler secret put INVITE_FROM
```

Enter exactly: `TRU HQ <hq@truhq.co>`

**Note:** `CLOUDFLARE_API_TOKEN=` is required — a stale token in the environment
otherwise shadows the working login with an opaque "Authentication error".

- [ ] **Step 2: Confirm `hq@truhq.co` can send**

In the Resend dashboard, confirm `truhq.co` is verified. Nothing else needs to
exist — Resend sends from any address at a verified domain. **Do not modify the
existing domain or the `BRIEF_FROM` secret.**

- [ ] **Step 3: Verify the full suite before deploying**

Run: `cd worker && npm run typecheck && npm test && cd ../web && npm run typecheck && npm test && npm run build`
Expected: everything green.

- [ ] **Step 4: Deploy the worker**

Run: `cd worker && CLOUDFLARE_API_TOKEN= npx wrangler deploy`

- [ ] **Step 5: Deploy the web app**

Follow `DEPLOY.md` in the repo root for the Pages deploy.

- [ ] **Step 6: End-to-end check with a real brokerage**

Using a throwaway brokerage name and two email addresses Eric controls:
1. Sign in as the platform owner → **Add a team** → fill it in with a real FUB key.
2. Both addresses receive an email from `hq@truhq.co`. Confirm neither lands in spam.
3. Follow one link → the set-password screen → set a password → lands in their HQ.
4. Open **Coach** as that leader → the roster loads (this is what proves the
   `leaders` and `entitlements` rows were written; before this work it would 404
   or come up empty).
5. Open **Pulse** → leads are present (proves `connectTeamKey` ran the sync).
6. Follow the second leader's link → they land in the *same* team.
7. Confirm Eric's next weekly report still arrives, proving `BRIEF_FROM` was untouched.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/hq-intake-and-1on1-persistence
gh pr create --title "Owner intake form + 1:1 session persistence" --body "$(cat <<'EOF'
## Summary
- Owner-only intake form: provision a brokerage from a Follow Up Boss key and email each team leader their own set-password link. Two leaders get two logins.
- Fix the 1:1 page resetting when the browser tab loses focus, plus refresh/back and scroll position.

## Notable
- Consolidates two drifted provisioning paths. `provision()` was missing the `leaders` and `entitlements` rows, so tenants created that way had a dead Coach; it also duplicated key storage, and the copy it duplicated (`connectTeamKey`) is the one that registers FUB webhooks — so self-serve tenants were silently cron-only. Both fixed.
- `BRIEF_FROM` is deliberately untouched; invites use a new `INVITE_FROM`.

Spec: `docs/superpowers/specs/2026-08-11-hq-intake-and-1on1-persistence-design.md`
Plan: `docs/superpowers/plans/2026-08-11-hq-intake-and-1on1-persistence.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Owner-only form location, existing `admins` gate | 5 (route), 6 (UI in Home) |
| Repeatable FUB accounts, key always required | 5 (`validateIntake`), 6 |
| Repeatable leaders, per-leader team when >1 team | 5, 6 |
| `provision()` gains `members[]`, `leaders`, `entitlements` | 4 |
| `provision()` gives up key storage; `connectTeamKey` sole path | 4 |
| `/provision` route calls `connectTeamKey` (self-serve webhook fix) | 4 |
| Invite via `generate_link`, recovery when user exists | 5 |
| Resend email, `INVITE_FROM`, `BRIEF_FROM` untouched | 5, 7 |
| Stale `trucoaching.co` comments fixed | 5 Step 6 |
| Lands on existing `SetPassword.tsx` | 5 (`redirect_to`), 7 Step 6 |
| Per-leader status; failed email does not roll back | 5, 6 |
| Resend-invite per leader | 5, 6 |
| Ignore same-user token refresh | 1 |
| Open agent in the hash route | 2 |
| Per-agent scroll restore | 3 |
| Acceptance test (tab switch, refresh) | 3 Step 8 |

No gaps.

**Placeholder scan:** none — every code step carries real code; no TBD, no "add error handling".

**Type consistency:** `ProvisionMember`/`ProvisionInput` as defined in Task 4 are consumed with those exact field names in Task 5's `runIntake`. `IntakeResult`/`IntakeLeaderResult` are defined identically in `worker/src/intake.ts` (Task 5) and `web/src/lib/api.ts` (Task 6). `coachRoute`/`parseCoachAgentId`/`isCoachRoute` (Task 2) are used with those names in `App.tsx`. `scrollKey`/`saveScroll`/`readScroll` (Task 3) match their `AgentDrill` usage. `connectTeamKey` is passed into `runIntake` as a parameter rather than imported, because it is defined in `index.ts` and importing it there would be circular — its signature in Task 5's `runIntake` matches `index.ts:79` exactly.
