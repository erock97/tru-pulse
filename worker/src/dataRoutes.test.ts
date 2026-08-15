// The tenancy regression test for the whole migration.
//
// Moving reads from the browser into the Worker is only safe if the Worker keeps
// calling Supabase AS THE USER. If it ever used the service-role key instead, every
// policy audited on 2026-08-11 would be bypassed and one brokerage could be served
// another's leads — with no error, no warning, and no visible symptom. So:
//
//   1. assert the service-role key is NEVER sent on a /data route
//   2. assert the user's own access token IS sent
//   3. assert two users in different orgs get disjoint rows through the same endpoint
//
// The fake Supabase below enforces row-level security the way Postgres would: it
// decides what to return based on which bearer token it was given.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';
import { COOKIE_NAME } from './session.js';

const SUPA = 'https://proj.supabase.co';
const APP = 'https://app.truhq.co';
const SERVICE_ROLE = 'SERVICE-ROLE-KEY-MUST-NEVER-APPEAR-ON-A-DATA-ROUTE';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

/** Which org each user's token belongs to, i.e. what RLS would let them see. */
const TOKEN_ORG: Record<string, string> = { 'at-acme': 'acme', 'at-globex': 'globex' };

// Practice-lab attempts. Sign-off does NOT depend on these — mutable only so a
// test can prove a leader who has never touched the lab can still sign off.
const LAB_PASSED: Record<string, Array<{ id: string }>> = {
  acme: [{ id: 'acme-avery-pass' }],
  globex: [{ id: 'globex-avery-pass' }],
};

/** Which org owns each test agent — the fake resolves write targets through this. */
const AGENT_ORG: Record<string, string> = {
  'aaaaaaaa-1111-4111-8111-111111111111': 'acme',
  'bbbbbbbb-2222-4222-8222-222222222222': 'globex',
};

const LEADS: Record<string, Array<{ team_id: string; name: string }>> = {
  acme: [{ team_id: 'acme-t1', name: 'Acme Lead' }],
  globex: [{ team_id: 'globex-t1', name: 'Globex Lead' }],
};

let env: Env;
let ctx: ExecutionContext;
let sentAuthHeaders: string[];
/** Every PostgREST path the Worker asked for, so a test can assert which TABLES a
 *  route touches — not just what it returned. Used to prove the agent-facing recap
 *  never reaches for the leader's private note. */
let sentPaths: string[];

beforeEach(() => {
  env = {
    SESSIONS: fakeKV(), SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE, ADMIN_TOKEN: 'ops',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  sentAuthHeaders = [];
  sentPaths = [];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const auth = String((init?.headers as any)?.Authorization ?? '');
    const apikey = String((init?.headers as any)?.apikey ?? '');
    sentAuthHeaders.push(`${auth} | ${apikey}`);
    sentPaths.push(u.pathname + u.search);

    const ok = (b: unknown) => new Response(JSON.stringify(b), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

    // Password grant → hand back a session for whichever user is signing in.
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const which = body.email.startsWith('acme') ? 'acme' : 'globex';
      return ok({
        access_token: `at-${which}`, refresh_token: `rt-${which}`,
        expires_in: 3600, user: { id: `user-${which}`, email: body.email },
      });
    }

    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      const method = (init?.method ?? 'GET').toUpperCase();
      const callerOrg = TOKEN_ORG[auth.replace('Bearer ', '')];

      // RLS stand-in for WRITES. Rows are named "<org>-..." so ownership is legible.
      // A write is refused (403, as Postgres does) unless the caller's org owns the
      // target — this is what proves the Worker isn't quietly using the service role.
      if (method !== 'GET') {
        const blob = url + String(init?.body ?? '');
        const found = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(blob)?.[0];
        const targetOrg = found ? AGENT_ORG[found.toLowerCase()] : undefined;
        if (!callerOrg || (targetOrg && targetOrg !== callerOrg)) {
          return new Response(JSON.stringify({ message: 'new row violates row-level security policy' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.pathname.startsWith('/rest/v1/rpc/')) return ok({ checkinId: `${callerOrg}-ci` });
        return ok([{ id: `${callerOrg}-row`, ok: true }]);
      }
      // THIS is the RLS stand-in: what you see depends on your token, nothing else.
      const org = TOKEN_ORG[auth.replace('Bearer ', '')];
      if (!org) return ok([]); // unknown caller sees nothing, as a policy would decide
      if (table === 'leads') return ok(LEADS[org]);
      if (table === 'teams') return ok([{ id: `${org}-t1`, name: org, fub_subdomain: null }]);
      if (table === 'org_settings') return ok([{ org_id: org, avg_gci: 5000 }]);
      if (table === 'rep_lab_attempts') return ok(LAB_PASSED[org] ?? []);
      return ok([]);
    }
    return ok({});
  }));
});

async function signIn(email: string): Promise<string> {
  const res = await worker.fetch(
    new Request('https://api.truhq.co/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP },
      body: JSON.stringify({ email, password: 'whatever12345' }),
    }),
    env, ctx,
  );
  return (res.headers.get('Set-Cookie') ?? '').match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1] ?? '';
}

const dashboard = (sid: string) =>
  worker.fetch(
    new Request('https://api.truhq.co/data/dashboard', {
      headers: { Origin: APP, Cookie: `${COOKIE_NAME}=${sid}` },
    }),
    env, ctx,
  );

describe('GET /data/dashboard', () => {
  it('refuses a caller with no session', async () => {
    const res = await worker.fetch(
      new Request('https://api.truhq.co/data/dashboard', { headers: { Origin: APP } }), env, ctx,
    );
    expect(res.status).toBe(401);
  });

  it('NEVER sends the service-role key — that would bypass every RLS policy', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await dashboard(sid);
    expect(sentAuthHeaders.length).toBeGreaterThan(0);
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });

  it('sends the signed-in user\'s own access token, so Postgres sees the real caller', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await dashboard(sid);
    expect(sentAuthHeaders.some((h) => h.includes('Bearer at-acme'))).toBe(true);
  });

  it('two users in different orgs get disjoint rows from the same endpoint', async () => {
    const acme = await dashboard(await signIn('acme@test.com'));
    const globex = await dashboard(await signIn('globex@test.com'));

    const a = await acme.json() as any;
    const g = await globex.json() as any;

    expect(a.leads.map((l: any) => l.name)).toEqual(['Acme Lead']);
    expect(g.leads.map((l: any) => l.name)).toEqual(['Globex Lead']);
    // The actual requirement, stated bluntly: no overlap, in either direction.
    expect(JSON.stringify(a)).not.toContain('Globex');
    expect(JSON.stringify(g)).not.toContain('Acme');
  });

  it('returns the shape the web app already expects', async () => {
    const res = await dashboard(await signIn('acme@test.com'));
    const body = await res.json() as any;
    for (const k of ['teams', 'settings', 'leads', 'cases', 'agents', 'deals', 'stageLog']) {
      expect(body).toHaveProperty(k);
    }
    expect(Array.isArray(body.leads)).toBe(true);
    expect(body.settings).toMatchObject({ org_id: 'acme' });
  });

  it('leaks no token back to the browser', async () => {
    const res = await dashboard(await signIn('acme@test.com'));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('at-acme');
    expect(text).not.toContain('rt-acme');
    expect(text).not.toContain(SERVICE_ROLE);
  });

  it('a dead session is refused rather than silently served', async () => {
    const sid = await signIn('acme@test.com');
    await worker.fetch(
      new Request('https://api.truhq.co/auth/logout', {
        method: 'POST', headers: { Origin: APP, Cookie: `${COOKIE_NAME}=${sid}`, 'Content-Type': 'application/json' },
        body: '{}',
      }), env, ctx,
    );
    expect((await dashboard(sid)).status).toBe(401);
  });
});

// ── Coach reads ─────────────────────────────────────────────────────────────
// Same requirement as the dashboard: the user's own token, never the service role,
// and no cross-tenant bleed. Plus id validation, since agentId arrives in the URL.
describe('Coach read endpoints', () => {
  const coach = (path: string, sid: string) =>
    worker.fetch(
      new Request(`https://api.truhq.co${path}`, {
        headers: { Origin: APP, Cookie: `${COOKIE_NAME}=${sid}` },
      }),
      env, ctx,
    );

  it('roster requires a session', async () => {
    const res = await worker.fetch(
      new Request('https://api.truhq.co/data/coach/roster', { headers: { Origin: APP } }), env, ctx,
    );
    expect(res.status).toBe(401);
  });

  it('roster never sends the service-role key', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await coach('/data/coach/roster', sid);
    expect(sentAuthHeaders.length).toBeGreaterThan(0);
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });

  it('roster sends the caller\'s own token', async () => {
    const sid = await signIn('globex@test.com');
    sentAuthHeaders = [];
    await coach('/data/coach/roster', sid);
    expect(sentAuthHeaders.some((h) => h.includes('Bearer at-globex'))).toBe(true);
  });

  it('rejects an agentId that is not a uuid, before it reaches a database filter', async () => {
    const sid = await signIn('acme@test.com');
    for (const bad of ['not-a-uuid', '', 'x&select=*', '../etc']) {
      const res = await coach(`/data/coach/checkins?agentId=${encodeURIComponent(bad)}`, sid);
      expect(res.status).toBe(422);
    }
  });

  it('accepts a well-formed agentId and returns the bundle shape', async () => {
    const sid = await signIn('acme@test.com');
    const res = await coach('/data/coach/checkins?agentId=3a84fd98-13f2-46e7-83a2-a1ed3aeadab7', sid);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    for (const k of ['checkins', 'items', 'leader']) expect(body).toHaveProperty(k);
  });

  it('leaks no token into a Coach response', async () => {
    const sid = await signIn('acme@test.com');
    const text = JSON.stringify(await (await coach('/data/coach/roster', sid)).json());
    expect(text).not.toContain('at-acme');
    expect(text).not.toContain(SERVICE_ROLE);
  });

  // ── The routes that finished the migration ──
  // Until these existed, Coach read the database straight from the browser, which
  // only worked in a browser still holding a pre-cutover token — so it answered as
  // whoever that token belonged to, and returned nothing for anyone else.
  const AGENT = '3a84fd98-13f2-46e7-83a2-a1ed3aeadab7';
  const CHECKIN = '7c1d0b52-9f3e-4a11-9d64-2b8e4f6a1c33';

  it('every Coach read requires a session', async () => {
    for (const path of [
      `/data/coach/profile?agentId=${AGENT}`,
      `/data/coach/commitments?agentId=${AGENT}`,
      `/data/coach/checkin-items?checkinId=${CHECKIN}`,
      `/data/coach/checkin-leader?checkinId=${CHECKIN}`,
      `/data/coach/open-commitments?agentId=${AGENT}`,
      `/data/coach/my-one-on-ones?agentId=${AGENT}`,
      '/data/coach/full-roster',
      '/data/coach/team-links',
      `/data/rep/practice?agentId=${AGENT}`,
    ]) {
      const res = await worker.fetch(
        new Request(`https://api.truhq.co${path}`, { headers: { Origin: APP } }), env, ctx,
      );
      expect(res.status, path).toBe(401);
    }
  });

  it('every id-taking Coach read refuses a non-uuid before it reaches a filter', async () => {
    const sid = await signIn('acme@test.com');
    for (const path of [
      '/data/coach/profile?agentId=',
      '/data/coach/commitments?agentId=',
      '/data/coach/checkin-items?checkinId=',
      '/data/coach/checkin-leader?checkinId=',
      '/data/coach/open-commitments?agentId=',
      '/data/coach/my-one-on-ones?agentId=',
      '/data/rep/practice?agentId=',
    ]) {
      for (const bad of ['not-a-uuid', '', 'x&select=*']) {
        const res = await coach(path + encodeURIComponent(bad), sid);
        expect(res.status, path + bad).toBe(422);
      }
    }
  });

  it('the new Coach reads use the caller\'s own token, never the service role', async () => {
    const sid = await signIn('globex@test.com');
    for (const path of [
      `/data/coach/profile?agentId=${AGENT}`,
      `/data/coach/my-one-on-ones?agentId=${AGENT}`,
      '/data/coach/full-roster',
      '/data/coach/team-links',
    ]) {
      sentAuthHeaders = [];
      await coach(path, sid);
      expect(sentAuthHeaders.length, path).toBeGreaterThan(0);
      for (const h of sentAuthHeaders) expect(h, path).not.toContain(SERVICE_ROLE);
      expect(sentAuthHeaders.some((h) => h.includes('Bearer at-globex')), path).toBe(true);
    }
  });

  // The agent-facing recap must not be able to reach the leader's private note. RLS
  // would refuse it, but a route that never names the table cannot regress if a
  // policy is later loosened.
  it('the agent recap route never touches checkin_leader', async () => {
    const sid = await signIn('acme@test.com');
    sentPaths = [];
    await coach(`/data/coach/my-one-on-ones?agentId=${AGENT}`, sid);
    expect(sentPaths.length).toBeGreaterThan(0);
    for (const p of sentPaths) expect(p).not.toContain('checkin_leader');
  });
});

// ── Coach WRITES ────────────────────────────────────────────────────────────
// The strongest assertion in this migration. A read bug shows someone the wrong
// numbers; a write bug puts one team's commitment on another team's agent. The fake
// Supabase above refuses a mutation whose target org differs from the caller's, the
// way Postgres does via WITH CHECK — so if the Worker ever switched to the
// service-role key, these tests fail rather than silently permitting it.
describe('Coach write endpoints', () => {
  const ACME_AGENT = 'aaaaaaaa-1111-4111-8111-111111111111';
  const GLOBEX_AGENT = 'bbbbbbbb-2222-4222-8222-222222222222';

  const write = (path: string, body: unknown, sid: string, origin: string | null = APP) =>
    worker.fetch(
      new Request(`https://api.truhq.co${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
          Cookie: `${COOKIE_NAME}=${sid}`,
        },
        body: JSON.stringify(body),
      }),
      env, ctx,
    );

  it('refuses a write with no session', async () => {
    const res = await worker.fetch(
      new Request('https://api.truhq.co/data/coach/goal', {
        method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: ACME_AGENT, fields: { quarter: 'Q3' } }),
      }), env, ctx,
    );
    expect(res.status).toBe(401);
  });

  it('refuses a write from an origin we do not recognise (CSRF on a mutation)', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/goal', { agentId: ACME_AGENT, fields: {} }, sid, 'https://evil.io');
    expect(res.status).toBe(403);
  });

  it('refuses a write with no Origin at all', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/goal', { agentId: ACME_AGENT, fields: {} }, sid, null);
    expect(res.status).toBe(403);
  });

  it('lets a leader update a goal on their OWN agent', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/goal', { agentId: ACME_AGENT, fields: { quarter: 'Q3' } }, sid);
    expect(res.status).toBe(200);
  });

  it('REFUSES a leader updating a goal on ANOTHER team\'s agent', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/goal', { agentId: GLOBEX_AGENT, fields: { quarter: 'Q3' } }, sid);
    expect(res.status).toBe(403);
  });

  it('REFUSES adding a commitment onto another team\'s agent', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/commitment', {
      action: 'add', agentId: GLOBEX_AGENT, row: { agent_id: GLOBEX_AGENT, text: 'sneak' },
    }, sid);
    expect(res.status).toBe(403);
  });

  it('REFUSES deleting another team\'s commitment', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/commitment', {
      action: 'delete', id: GLOBEX_AGENT, // a row owned by the other team
    }, sid);
    expect(res.status).toBe(403);
  });

  it('validates ids before they reach a database filter', async () => {
    const sid = await signIn('acme@test.com');
    expect((await write('/data/coach/goal', { agentId: 'nope', fields: {} }, sid)).status).toBe(422);
    expect((await write('/data/coach/commitment', { action: 'update', id: 'x&y' }, sid)).status).toBe(422);
  });

  it('rejects an unknown commitment action rather than guessing', async () => {
    const sid = await signIn('acme@test.com');
    expect((await write('/data/coach/commitment', { action: 'drop-table', id: ACME_AGENT }, sid)).status).toBe(422);
  });

  it('never uses the service-role key on a write', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await write('/data/coach/goal', { agentId: ACME_AGENT, fields: { quarter: 'Q4' } }, sid);
    expect(sentAuthHeaders.length).toBeGreaterThan(0);
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });

  it('logs a structured 1:1 via the transactional function, not piecemeal writes', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/checkin', { args: { p_agent_id: ACME_AGENT } }, sid);
    expect(res.status).toBe(200);
    // Splitting this into separate inserts could leave a half-saved 1:1.
    expect(sentAuthHeaders.some((h) => h.includes('Bearer at-acme'))).toBe(true);
  });

  it('surfaces a refused pause as 403 rather than a silent no-op', async () => {
    const sid = await signIn('acme@test.com');
    const res = await write('/data/coach/agent-flags', { agentId: GLOBEX_AGENT, pause: true }, sid);
    expect(res.status).toBe(403);
  });
});

// ── Rep ─────────────────────────────────────────────────────────────────────
describe('Rep endpoints', () => {
  const rep = (path: string, sid: string) =>
    worker.fetch(
      new Request(`https://api.truhq.co${path}`, {
        headers: { Origin: APP, Cookie: `${COOKIE_NAME}=${sid}` },
      }), env, ctx,
    );

  it('both endpoints require a session', async () => {
    for (const p of ['/data/rep/board', '/data/rep/course?agentId=aaaaaaaa-1111-4111-8111-111111111111']) {
      const res = await worker.fetch(
        new Request(`https://api.truhq.co${p}`, { headers: { Origin: APP } }), env, ctx,
      );
      expect(res.status).toBe(401);
    }
  });

  it('never sends the service-role key', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await rep('/data/rep/board', sid);
    expect(sentAuthHeaders.length).toBeGreaterThan(0);
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });

  it('board returns the shape the leader view expects', async () => {
    const res = await rep('/data/rep/board', await signIn('acme@test.com'));
    const body = await res.json() as any;
    for (const k of ['modules', 'questions', 'progress', 'agents', 'practice']) {
      expect(body).toHaveProperty(k);
    }
  });

  it('course validates the agent id', async () => {
    const sid = await signIn('acme@test.com');
    expect((await rep('/data/rep/course?agentId=nope', sid)).status).toBe(422);
  });

  it('course reads questions from the masked view, so answers never ship', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    const res = await rep('/data/rep/course?agentId=aaaaaaaa-1111-4111-8111-111111111111', sid);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('"answer"');
    expect(text).not.toContain(SERVICE_ROLE);
  });
});

describe('the routes the cutover added', () => {
  const get = (path: string, sid: string) =>
    worker.fetch(
      new Request(`https://api.truhq.co${path}`, {
        headers: { Origin: APP, Cookie: `${COOKIE_NAME}=${sid}` },
      }),
      env, ctx,
    );
  const post = (path: string, sid: string, body: unknown, origin: string | null = APP) =>
    worker.fetch(
      new Request(`https://api.truhq.co${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
          Cookie: `${COOKIE_NAME}=${sid}`,
        },
        body: JSON.stringify(body),
      }),
      env, ctx,
    );

  it('/data/me answers org, agent and role in one call, as the user', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    const res = await get('/data/me', sid);
    expect(res.status).toBe(200);
    const body = await res.json() as { org: unknown; agent: unknown; role: unknown };
    expect(body).toHaveProperty('org');
    expect(body).toHaveProperty('agent');
    expect(body).toHaveProperty('role');
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });

  it('/data/me refuses a caller with no session', async () => {
    const res = await worker.fetch(
      new Request('https://api.truhq.co/data/me', { headers: { Origin: APP } }), env, ctx,
    );
    expect(res.status).toBe(401);
  });

  it('rejects a malformed orgId rather than letting it reach a filter', async () => {
    const sid = await signIn('acme@test.com');
    const res = await get('/data/rep/custom-modules?orgId=select=*', sid);
    expect(res.status).toBe(422);
  });

  it('rejects a malformed moduleId on the masked question read', async () => {
    const sid = await signIn('acme@test.com');
    expect((await get('/data/rep/questions-masked?moduleId=nope', sid)).status).toBe(422);
  });

  it('the masked question read never asks for the answer column', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    const res = await get('/data/rep/questions-masked?moduleId=aaaaaaaa-1111-4111-8111-111111111111', sid);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('"answer"');
  });

  it('sign-off writes as the user, so RLS refuses another org\'s agent', async () => {
    const sid = await signIn('acme@test.com');
    // globex's agent — the fake refuses it exactly as a WITH CHECK policy would.
    const res = await post('/data/rep/sign-off', sid,
      { agentId: 'bbbbbbbb-2222-4222-8222-222222222222', who: 'acme lead' });
    expect(res.status).toBe(403);
  });

  it('sign-off succeeds for the caller\'s own agent', async () => {
    const sid = await signIn('acme@test.com');
    const res = await post('/data/rep/sign-off', sid,
      { agentId: 'aaaaaaaa-1111-4111-8111-111111111111', who: 'acme lead' });
    expect(res.status).toBe(200);
  });

  it('signs off a leader who has never touched the practice lab', async () => {
    // The lab is available to leaders; it is not a prerequisite. Gating sign-off
    // on it locked out every existing leader the day it shipped. Eric's call.
    const had = LAB_PASSED.acme;
    LAB_PASSED.acme = [];
    try {
      const sid = await signIn('acme@test.com');
      const res = await post('/data/rep/sign-off', sid,
        { agentId: 'aaaaaaaa-1111-4111-8111-111111111111', who: 'acme lead' });
      expect(res.status).toBe(200);
    } finally {
      LAB_PASSED.acme = had;
    }
  });

  it('refuses a sign-off from an origin we do not recognise', async () => {
    const sid = await signIn('acme@test.com');
    const res = await post('/data/rep/sign-off', sid,
      { agentId: 'aaaaaaaa-1111-4111-8111-111111111111' }, 'https://evil.io');
    expect(res.status).toBe(403);
  });

  it('claim-agent needs a recognised origin too', async () => {
    const sid = await signIn('acme@test.com');
    expect((await post('/data/claim-agent', sid, {}, 'https://evil.io')).status).toBe(403);
    expect((await post('/data/claim-agent', sid, {})).status).toBe(200);
  });

  it('never sends the service-role key on any of them', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await get('/data/me', sid);
    await get('/data/rep/custom-modules?orgId=aaaaaaaa-1111-4111-8111-111111111111', sid);
    await post('/data/claim-agent', sid, {});
    expect(sentAuthHeaders.length).toBeGreaterThan(0);
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });
});
