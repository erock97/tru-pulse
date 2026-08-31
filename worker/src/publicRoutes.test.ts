// The no-login agent path. It must keep working without a session, while no longer
// being an open door: allowlisted functions only, token required, rate limited.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
const TOKEN = 'aaaaaaaa-1111-4111-8111-111111111111';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

let env: Env;
let ctx: ExecutionContext;
let rpcCalls: Array<{ fn: string; args: any }>;
let supabaseOk: boolean;

beforeEach(() => {
  env = {
    SESSIONS: fakeKV(), SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'SERVICE-ROLE', ADMIN_TOKEN: 'ops',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  rpcCalls = [];
  supabaseOk = true;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      rpcCalls.push({
        fn: u.pathname.split('/').pop() as string,
        args: JSON.parse(String(init?.body ?? '{}')),
      });
      // Record which key was used so a test can assert it wasn't the service role.
      rpcCalls[rpcCalls.length - 1].args.__auth = String((init?.headers as any)?.Authorization ?? '');
    }
    return new Response(JSON.stringify(
      supabaseOk ? { team_id: 't1' } : { message: 'row-not-found-for-token-abc123' },
    ), {
      status: supabaseOk ? 200 : 400, headers: { 'Content-Type': 'application/json' },
    });
  }));
});

const call = (action: string, body: unknown) =>
  worker.fetch(
    new Request(`https://api.truhq.co/public/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env, ctx,
  );

describe('the public agent path', () => {
  it('works with NO cookie and no session — the whole point', async () => {
    const res = await call('resolve-join-token', { p_token: TOKEN });
    expect(res.status).toBe(200);
    expect(rpcCalls[0].fn).toBe('resolve_join_token');
  });

  it('refuses a missing or malformed token before touching the database', async () => {
    for (const t of [undefined, '', 'not-a-uuid']) {
      const res = await call('get-agent-home', t === undefined ? {} : { p_token: t });
      expect(res.status).toBe(401);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it('only exposes allowlisted functions', async () => {
    for (const bad of ['create_team', 'set_agent_pause', 'replace_revenue', 'anything']) {
      expect((await call(bad, { p_token: TOKEN })).status).toBe(404);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it('drops parameters the function does not declare, rather than forwarding them', async () => {
    await call('resolve-join-token', { p_token: TOKEN, p_is_admin: true, injected: 'x' });
    expect(Object.keys(rpcCalls[0].args)).not.toContain('p_is_admin');
    expect(Object.keys(rpcCalls[0].args)).not.toContain('injected');
  });

  it('never uses the service-role key on the public path', async () => {
    await call('save-checkin', { p_token: TOKEN, p_met: 'yes', p_leads: 3 });
    expect(rpcCalls[0].args.__auth).not.toContain('SERVICE-ROLE');
    expect(rpcCalls[0].args.__auth).toContain('anon-key');
  });

  it('rate-limits a caller grinding tokens', async () => {
    for (let i = 0; i < 60; i++) await call('resolve-join-token', { p_token: TOKEN });
    expect((await call('resolve-join-token', { p_token: TOKEN })).status).toBe(429);
  });

  it('does not echo the database error, which could reveal whether a token exists', async () => {
    supabaseOk = false;
    const res = await call('get-agent-home', { p_token: TOKEN });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    // The database's own wording must not reach the caller — it can reveal whether a
    // token or row exists.
    expect(JSON.stringify(body)).not.toContain('row-not-found-for-token-abc123');
    expect(body.error).toContain('not valid');
  });

  it('rejects GET — these all change or reveal state', async () => {
    const res = await worker.fetch(
      new Request(`https://api.truhq.co/public/get-agent-home`), env, ctx,
    );
    expect(res.status).toBe(404);
  });
});

describe('the broker confirm actions', () => {
  it('reach their RPCs with the ANON key, never the service role', async () => {
    await call('verify-list', { p_token: TOKEN });
    await call('verify-respond', { p_token: TOKEN, p_closing_id: TOKEN, p_outcome: 'confirmed' });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['tru_verify_list', 'tru_verify_respond']);
    for (const c of rpcCalls) {
      expect(c.args.__auth).toContain('anon-key');
      expect(c.args.__auth).not.toContain('SERVICE-ROLE');
    }
  });

  it('passes through the database\'s KNOWN broker-facing refusals, and only those', async () => {
    // A known sentence is the broker's UX — "this link has expired" tells them
    // what to do next, where a generic reply would strand them mid-round.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'this link has expired' }), { status: 400 }),
    ));
    let res = await call('verify-list', { p_token: TOKEN });
    expect(((await res.json()) as any).error).toBe('this link has expired');

    // Anything outside the allowlist still collapses to the generic reply.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'internal: row 42 of closings_v2 missing' }), { status: 400 }),
    ));
    res = await call('verify-list', { p_token: TOKEN });
    expect(((await res.json()) as any).error).toContain('not valid');
  });

  it('the non-broker actions keep the generic reply even for an allowlisted sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'this link has expired' }), { status: 400 }),
    ));
    const res = await call('get-agent-home', { p_token: TOKEN });
    expect(((await res.json()) as any).error).toContain('not valid');
  });
});
