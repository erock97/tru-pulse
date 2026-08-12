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

const LEADS: Record<string, Array<{ team_id: string; name: string }>> = {
  acme: [{ team_id: 'acme-t1', name: 'Acme Lead' }],
  globex: [{ team_id: 'globex-t1', name: 'Globex Lead' }],
};

let env: Env;
let ctx: ExecutionContext;
let sentAuthHeaders: string[];

beforeEach(() => {
  env = {
    SESSIONS: fakeKV(), SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE, ADMIN_TOKEN: 'ops',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  sentAuthHeaders = [];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const auth = String((init?.headers as any)?.Authorization ?? '');
    const apikey = String((init?.headers as any)?.apikey ?? '');
    sentAuthHeaders.push(`${auth} | ${apikey}`);

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
      // THIS is the RLS stand-in: what you see depends on your token, nothing else.
      const org = TOKEN_ORG[auth.replace('Bearer ', '')];
      if (!org) return ok([]); // unknown caller sees nothing, as a policy would decide
      if (table === 'leads') return ok(LEADS[org]);
      if (table === 'teams') return ok([{ id: `${org}-t1`, name: org, fub_subdomain: null }]);
      if (table === 'org_settings') return ok([{ org_id: org, avg_gci: 5000 }]);
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
