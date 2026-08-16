// Tenancy + shape test for GET /data/rep/library.
//
// Same contract as dataRoutes.test.ts: every read goes out as the USER, never with
// the service-role key, and two orgs signed in against the same endpoint must not
// see each other's tracks. The fake Supabase below decides what to return purely
// from the bearer token, exactly as a policy would.
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

const TOKEN_ORG: Record<string, string> = {
  'at-acme': 'acme', 'at-globex': 'globex', 'at-stranger': 'stranger',
};

/** Global tracks every org sees, plus one custom track owned by globex. */
const TRACKS: Record<string, any[]> = {
  acme: [
    { id: 't1', slug: 'zillow-day1', title: 'Zillow Preferred Onboarding', subtitle: null, cover: null, order_idx: 1 },
    { id: 't2', slug: 'fundamentals', title: 'TRU Fundamentals', subtitle: null, cover: null, order_idx: 2 },
  ],
  globex: [
    { id: 't1', slug: 'zillow-day1', title: 'Zillow Preferred Onboarding', subtitle: null, cover: null, order_idx: 1 },
    { id: 't2', slug: 'fundamentals', title: 'TRU Fundamentals', subtitle: null, cover: null, order_idx: 2 },
    { id: 't9', slug: 'globex-only', title: 'Globex House Rules', subtitle: null, cover: null, order_idx: 3 },
  ],
  stranger: [],
};

const TRACK_MODULES = [
  { track_id: 't1', module_id: 'm1', idx: 1, required: true },
  { track_id: 't1', module_id: 'm2', idx: 2, required: true },
  { track_id: 't2', module_id: 'm9', idx: 1, required: true },
];

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

    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const which = body.email.startsWith('acme') ? 'acme'
        : body.email.startsWith('globex') ? 'globex' : 'stranger';
      return ok({
        access_token: `at-${which}`, refresh_token: `rt-${which}`,
        expires_in: 3600, user: { id: `user-${which}`, email: body.email },
      });
    }

    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      const org = TOKEN_ORG[auth.replace('Bearer ', '')];
      if (!org) return ok([]);

      // The learner spine, minted by a security-definer function so a first-time
      // learner needs no client INSERT policy. A stranger gets null back.
      if (table === 'rpc/rep_ensure_learner') {
        if (org === 'stranger') return ok(null);
        return ok({ id: `L-${org}`, org_id: org, kind: 'agent', agent_id: `ag-${org}` });
      }
      if (table === 'rep_tracks') return ok(TRACKS[org] ?? []);
      if (table === 'rep_track_modules') return ok(TRACK_MODULES);
      if (table === 'rep_modules') return ok([
        { id: 'm1', idx: 1, title: 'Speed to Lead', summary: null, tags: [], level: null },
        { id: 'm2', idx: 2, title: 'The ALMS Call', summary: null, tags: [], level: null },
      ]);
      if (table === 'rep_progress') return ok([
        { module_id: 'm1', status: 'passed', score: 90, passed_at: '2026-08-01T00:00:00Z' },
      ]);
      if (table === 'rep_assignments') return ok([]);
      if (table === 'rep_certificates') return ok([]);
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

const library = (sid: string) =>
  worker.fetch(
    new Request('https://api.truhq.co/data/rep/library', {
      headers: { Origin: APP, Cookie: `${COOKIE_NAME}=${sid}` },
    }),
    env, ctx,
  );

describe('GET /data/rep/library', () => {
  it('refuses a caller with no session', async () => {
    const res = await worker.fetch(
      new Request('https://api.truhq.co/data/rep/library', { headers: { Origin: APP } }), env, ctx,
    );
    expect(res.status).toBe(401);
  });

  it('never sends the service-role key', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await library(sid);
    expect(sentAuthHeaders.length).toBeGreaterThan(0);
    for (const h of sentAuthHeaders) expect(h).not.toContain(SERVICE_ROLE);
  });

  it('sends the signed-in user\'s own access token', async () => {
    const sid = await signIn('acme@test.com');
    sentAuthHeaders = [];
    await library(sid);
    expect(sentAuthHeaders.some((h) => h.includes('Bearer at-acme'))).toBe(true);
  });

  it('returns the shelf with each track rolled up', async () => {
    const body = await (await library(await signIn('acme@test.com'))).json() as any;
    expect(body.tracks.map((t: any) => t.slug)).toEqual(['zillow-day1', 'fundamentals']);
    expect(body.tracks[0]).toMatchObject({ total: 2, passed: 1, pct: 50, complete: false });
    expect(body.tracks[0].nextModuleId).toBe('m2');
  });

  it('one org never sees another org custom track', async () => {
    const acme = await (await library(await signIn('acme@test.com'))).json() as any;
    const globex = await (await library(await signIn('globex@test.com'))).json() as any;
    expect(acme.tracks.some((t: any) => t.slug === 'globex-only')).toBe(false);
    expect(globex.tracks.some((t: any) => t.slug === 'globex-only')).toBe(true);
  });

  it('403s the learner-less caller rather than serving an empty shelf', async () => {
    expect((await library(await signIn('stranger@test.com'))).status).toBe(403);
  });

  it('returns every key the browser expects', async () => {
    const body = await (await library(await signIn('acme@test.com'))).json() as any;
    for (const k of ['learner', 'tracks', 'modules', 'trackModules', 'progress', 'certificates']) {
      expect(body).toHaveProperty(k);
    }
    expect(body.learner).toMatchObject({ id: 'L-acme', kind: 'agent' });
  });

  it('leaks no token back to the browser', async () => {
    const res = await library(await signIn('acme@test.com'));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('at-acme');
    expect(text).not.toContain('rt-acme');
    expect(text).not.toContain(SERVICE_ROLE);
  });
});
