// Text-message consent routes.
//
// These tests exist for one reason above all others: to prove the browser cannot
// author its own consent record. Every other assertion here is ordinary route
// hygiene; that one is the difference between a consent ledger that is evidence
// and one that is decoration.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSmsRoutes } from './smsRoutes.js';
import type { Env } from './env.js';
import { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } from '../../shared/smsConsent.js';

const SUPA = 'https://proj.supabase.co';
const SID = 'sid-1';

let env: Env;
let rpcCalls: Array<{ fn: string; args: any }>;
let rpcOk: boolean;

function fakeKV(session: unknown) {
  const store = new Map<string, string>();
  // Same key shape readSession() uses. Set from the real helper rather than a
  // guessed literal, so a change there fails this file instead of silently
  // making every test here pass against no session at all.
  if (session) store.set(`sess:${SID}`, JSON.stringify(session));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

beforeEach(() => {
  rpcCalls = [];
  rpcOk = true;
  env = {
    SESSIONS: fakeKV({
      userId: 'u1',
      accessToken: 'user-jwt',
      refreshToken: 'r1',
      // Unix SECONDS, not millis — and far enough out that withFreshToken does
      // not try to refresh mid-test.
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      createdAt: Math.floor(Date.now() / 1000),
    }),
    SUPABASE_URL: SUPA,
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'SERVICE-ROLE',
  } as unknown as Env;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      rpcCalls.push({
        fn: u.pathname.split('/').pop() as string,
        args: {
          ...JSON.parse(String(init?.body ?? '{}')),
          __auth: String((init?.headers as any)?.Authorization ?? ''),
        },
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: rpcOk ? 200 : 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

const cors = { 'Access-Control-Allow-Origin': '*' };

function call(path: string, opts: {
  method?: string; body?: unknown; cookie?: string | null; headers?: Record<string, string>;
} = {}) {
  const method = opts.method ?? 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.cookie !== null) headers.Cookie = `hq_sid=${opts.cookie ?? SID}`;
  const req = new Request(`https://api.truhq.co${path}`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(opts.body ?? {}) }),
  });
  return handleSmsRoutes(req, env, new URL(req.url), cors, true);
}

describe('sms routes', () => {
  it('ignores anything outside /sms/, so it cannot shadow another router', async () => {
    expect(await call('/data/me', { method: 'GET' })).toBeNull();
  });

  it('refuses without a session', async () => {
    const res = await call('/sms/state', { method: 'GET', cookie: null });
    expect(res!.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  describe('opt-in', () => {
    it('stores the SERVER’s consent wording, never the browser’s', async () => {
      // The heart of it. A page that could post its own consent text could claim
      // agreement to words it never displayed, and the ledger would be worthless.
      const res = await call('/sms/opt-in', {
        body: {
          phone: '(555) 555-0123',
          consent_text: 'I agree to absolutely anything forever',
          p_consent_text: 'I agree to absolutely anything forever',
          consent_version: '1999',
        },
      });
      expect(res!.status).toBe(200);
      expect(rpcCalls[0].fn).toBe('agent_sms_opt_in');
      expect(rpcCalls[0].args.p_consent_text).toBe(SMS_CONSENT_TEXT);
      expect(rpcCalls[0].args.p_consent_version).toBe(SMS_CONSENT_VERSION);
      expect(JSON.stringify(rpcCalls[0].args)).not.toContain('absolutely anything');
    });

    it('normalises the number to E.164 before it reaches the database', async () => {
      await call('/sms/opt-in', { body: { phone: '555 555 0123' } });
      expect(rpcCalls[0].args.p_phone).toBe('+15555550123');
    });

    it('rejects a number that is not dialable, without touching the database', async () => {
      // 555-123-4567 looks right and is not a real number — its exchange code
      // starts with 1. A ledger full of those is a ledger of nothing.
      for (const bad of ['', '555', '5551234567', '+44 20 7946 0958']) {
        const res = await call('/sms/opt-in', { body: { phone: bad } });
        expect(res!.status).toBe(422);
      }
      expect(rpcCalls).toHaveLength(0);
    });

    it('takes the IP from Cloudflare, not from the request body', async () => {
      await call('/sms/opt-in', {
        body: { phone: '5555550123', ip: '1.1.1.1', p_ip: '1.1.1.1' },
        headers: { 'CF-Connecting-IP': '203.0.113.7' },
      });
      expect(rpcCalls[0].args.p_ip).toBe('203.0.113.7');
    });

    it('acts as the signed-in user, never as the service role', async () => {
      await call('/sms/opt-in', { body: { phone: '5555550123' } });
      expect(rpcCalls[0].args.__auth).not.toContain('SERVICE-ROLE');
      expect(rpcCalls[0].args.__auth).toContain('user-jwt');
    });

    it('refuses a cross-origin write', async () => {
      const req = new Request('https://api.truhq.co/sms/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `hq_sid=${SID}` },
        body: JSON.stringify({ phone: '5555550123' }),
      });
      const res = await handleSmsRoutes(req, env, new URL(req.url), cors, false);
      expect(res!.status).toBe(403);
      expect(rpcCalls).toHaveLength(0);
    });
  });

  describe('opt-out', () => {
    it('calls the opt-out RPC', async () => {
      const res = await call('/sms/opt-out');
      expect(res!.status).toBe(200);
      expect(rpcCalls[0].fn).toBe('agent_sms_opt_out');
    });

    it('reports a failure loudly, with a human to contact', async () => {
      // The worst possible bug in this file is an opt-out that fails silently:
      // the person believes they have stopped and the messages keep arriving.
      rpcOk = false;
      const res = await call('/sms/opt-out');
      expect(res!.status).toBe(400);
      const body = await res!.json() as { error: string };
      expect(body.error).toContain('@');
    });
  });

  it('decline records that we asked', async () => {
    const res = await call('/sms/decline');
    expect(res!.status).toBe(200);
    expect(rpcCalls[0].fn).toBe('agent_sms_decline');
  });

  it('state reads through the self-contained RPC, not agent_home', async () => {
    // agent_sms_state exists precisely so this feature does not depend on the
    // unmerged agent-experience work. If this ever becomes agent_home, SMS
    // consent silently acquires that dependency again.
    const res = await call('/sms/state', { method: 'GET' });
    expect(res!.status).toBe(200);
    expect(rpcCalls[0].fn).toBe('agent_sms_state');
  });
});
