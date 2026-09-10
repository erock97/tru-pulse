import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { mintAuthLink } from './invite.js';
import type { Env } from './env.js';

afterEach(() => vi.unstubAllGlobals());

describe('invitation and reset through the cookie-auth handlers', () => {
  it.each(['invite', 'recovery'] as const)('%s: generated link → session → save → fresh login', async (kind) => {
    const email = 'mock@example.com';
    const user = { id: 'mock-user', email };
    const kv = new Map<string, string>();
    const env = {
      SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service', RESEND_API_KEY: 'capture', INVITE_FROM: 'test@truhq.co',
      SESSIONS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
    } as unknown as Env;
    let password = 'original-test-password';
    let used = false;
    let delivered = '';
    const session = { user, access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600 };
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.hostname === 'api.resend.com') {
        delivered = body.html.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
        return Response.json({ id: 'captured' });
      }
      if (url.pathname.endsWith('/admin/users')) return Response.json({ users: [user] });
      if (url.pathname.endsWith('/admin/generate_link')) return Response.json({
        user, hashed_token: 'one-time-hash', verification_type: kind,
        action_link: `https://test.supabase.co/auth/v1/verify?token=one-time-hash&type=${kind}`,
      });
      if (url.pathname.endsWith('/verify')) {
        if (used || body.token_hash !== 'one-time-hash' || body.type !== kind) return Response.json({}, { status: 401 });
        used = true;
        return Response.json(session);
      }
      if (url.pathname.endsWith('/user')) {
        if (init?.method === 'PUT') password = body.password;
        return Response.json(user);
      }
      if (url.pathname.endsWith('/token')) return Response.json(body.password === password ? session : {}, { status: body.password === password ? 200 : 401 });
      if (url.pathname.endsWith('/agents')) return Response.json([]);
      throw new Error(`Unexpected request: ${url.pathname}`);
    }));
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const response = await worker.fetch(new Request(`https://api.truhq.co${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Origin: 'https://app.truhq.co', 'Content-Type': 'application/json', Cookie: cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), env, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext);
      const setCookie = response.headers.get('Set-Cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    };
    let link: string;
    if (kind === 'invite') link = (await mintAuthLink(env, email, kind)).link;
    else {
      expect((await call('/auth/reset-request', { email })).status).toBe(200);
      link = delivered;
    }
    const url = new URL(link);
    expect(url.origin).toBe('https://app.truhq.co');
    const exchange = Object.fromEntries(new URLSearchParams(url.hash.slice(1)));
    const response = await call('/auth/exchange', exchange);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, email });
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect((await (await call('/auth/me')).json() as any).user.email).toBe(email);
    expect((await call('/auth/set-password', { password: 'replacement-test-password' })).status).toBe(200);
    expect((await call('/auth/logout', {})).status).toBe(200);
    expect((await call('/auth/login', { email, password: 'original-test-password' })).status).toBe(401);
    expect((await call('/auth/login', { email, password: 'replacement-test-password' })).status).toBe(200);
    expect((await call('/auth/exchange', exchange)).status).toBe(401);
  });
});
