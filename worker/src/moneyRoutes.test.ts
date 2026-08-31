// The Money routes' gate: every one of them lives behind the /admin/ check —
// a valid session AND a row in `admins` — because these are the routes that
// email brokers and bill clients. Plus the import route's own validation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let env: Env;
let admins: string[];
let rpcCalls: Array<{ fn: string; args: any }>;

beforeEach(() => {
  env = {
    SESSIONS: fakeKV(),
    SUPABASE_URL: SUPA,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  } as unknown as Env;
  admins = ['admin-1'];
  rpcCalls = [];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const bearer = String((init?.headers as any)?.Authorization ?? '').replace('Bearer ', '');
      return bearer === 'admin-token' ? ok({ id: 'admin-1' }) : bearer === 'agent-token' ? ok({ id: 'agent-9' }) : ok({}, 401);
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.split('/').pop() as string;
      rpcCalls.push({ fn, args: JSON.parse(String(init?.body ?? '{}')) });
      if (fn === 'tru_import_closings') {
        return ok({ team: 'Costigan', source: 'Zillow Preferred', imported: 1, duplicates: [{ client_name: 'Repeat Buyer', address: null, close_date: '2026-07-02' }] });
      }
      return ok({});
    }
    if (u.pathname === '/rest/v1/admins') {
      const m = u.search.match(/id=eq\.([^&]+)/);
      const id = m ? decodeURIComponent(m[1]) : null;
      return ok(id && admins.includes(id) ? [{ id }] : []);
    }
    return ok([]);
  }));
});

const call = (path: string, opts: { method?: string; body?: unknown; token?: string } = {}) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: opts.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    env,
    ctx,
  );

const ROUTES: Array<{ path: string; method: string }> = [
  { path: '/admin/money/overview?year=2026&month=8', method: 'GET' },
  { path: '/admin/money/team-month?team=X&year=2026&month=8', method: 'GET' },
  { path: '/admin/money/team-pay', method: 'POST' },
  { path: '/admin/money/brokers?team=X', method: 'GET' },
  { path: '/admin/money/broker-email', method: 'POST' },
  { path: '/admin/money/send-verification', method: 'POST' },
  { path: '/admin/money/confirm-deal', method: 'POST' },
  { path: '/admin/money/preview-team?team=X&year=2026&month=8', method: 'GET' },
  { path: '/admin/money/invoice-team', method: 'POST' },
  { path: '/admin/money/invoice/send', method: 'POST' },
  { path: '/admin/money/invoice/void', method: 'POST' },
  { path: '/admin/money/import', method: 'POST' },
];

describe('the money routes', () => {
  it('401 every route with no session', async () => {
    for (const r of ROUTES) {
      expect((await call(r.path, { method: r.method })).status, r.path).toBe(401);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it('403 every route for a signed-in user who is not in `admins`', async () => {
    for (const r of ROUTES) {
      expect((await call(r.path, { method: r.method, token: 'agent-token' })).status, r.path).toBe(403);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it('rejects an import deal missing its client name or close date before the database sees it', async () => {
    const res = await call('/admin/money/import', {
      token: 'admin-token',
      body: { team: 'Costigan', source: 'Zillow Preferred', deals: [{ client_name: 'Buyer', close_date: '' }] },
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/close date/);
    expect(rpcCalls.filter((c) => c.fn === 'tru_import_closings')).toHaveLength(0);
  });

  it('passes the database\'s duplicates back so the screen can say "already on the books"', async () => {
    const res = await call('/admin/money/import', {
      token: 'admin-token',
      body: {
        team: 'Costigan',
        source: 'Zillow Preferred',
        deals: [
          { client_name: 'New Buyer', close_date: '2026-07-02' },
          { client_name: 'Repeat Buyer', close_date: '2026-07-02' },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.imported).toBe(1);
    expect(body.duplicates).toEqual([{ client_name: 'Repeat Buyer', address: null, close_date: '2026-07-02' }]);
  });
});
