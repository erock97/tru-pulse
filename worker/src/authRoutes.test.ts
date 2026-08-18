// Cookie-based auth, exercised through the real exported handler with Supabase stubbed
// at the fetch boundary — same approach as routes-auth.test.ts.
//
// The two properties that must never regress:
//   1. no token ever appears in a response body
//   2. a mutating request from an origin we don't recognise is refused
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';
import { COOKIE_NAME } from './session.js';

const SUPA = 'https://proj.supabase.co';
const APP = 'https://app.truhq.co';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

let kv: ReturnType<typeof fakeKV>;
let env: Env;
let ctx: ExecutionContext;
/** What Supabase will answer, per test. */
let supabase: { ok: boolean; body: unknown; status?: number };
let calls: Array<{ url: string; method: string; body: unknown }>;
/** Per-URL answers, for flows that call Supabase more than once (act-as). Returning
 *  null falls back to the single `supabase` reply above. */
let route: ((url: string) => { ok: boolean; body: unknown; status?: number } | null) | null;

beforeEach(() => {
  kv = fakeKV();
  env = {
    SESSIONS: kv, SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service', ADMIN_TOKEN: 'ops',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  supabase = { ok: true, body: {} };
  calls = [];
  route = null;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({
      url, method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const r = route?.(url) ?? supabase;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? (r.ok ? 200 : 401),
      headers: { 'Content-Type': 'application/json' },
    });
  }));
});

const post = (path: string, body: unknown, opts: { origin?: string | null; cookie?: string } = {}) =>
  worker.fetch(
    new Request(`https://api.truhq.co${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.origin === null ? {} : { Origin: opts.origin ?? APP }),
        ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    env, ctx,
  );

const get = (path: string, cookie?: string) =>
  worker.fetch(
    new Request(`https://api.truhq.co${path}`, {
      headers: { Origin: APP, ...(cookie ? { Cookie: cookie } : {}) },
    }),
    env, ctx,
  );

const goodSession = {
  access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600,
  user: { id: 'user-1', email: 'dana@acme.com' },
};
const sidFrom = (res: Response) =>
  (res.headers.get('Set-Cookie') ?? '').match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1] ?? '';

describe('POST /auth/login', () => {
  it('sets an HttpOnly cookie and returns NO token in the body', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await post('/auth/login', { email: 'dana@acme.com', password: 'hunter2222' });
    expect(res.status).toBe(200);

    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');

    // The whole point: the browser learns nothing it could steal.
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('at-123');
    expect(text).not.toContain('rt-456');
  });

  it('stores the tokens server-side, not in the response', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await post('/auth/login', { email: 'dana@acme.com', password: 'hunter2222' });
    const stored = [...kv.store.values()].join(' ');
    expect(stored).toContain('at-123');
    expect(stored).toContain('rt-456');
    expect(sidFrom(res)).not.toBe('');
  });

  it('refuses a wrong password without revealing whether the account exists', async () => {
    supabase = { ok: false, body: { error: 'invalid_grant' } };
    const res = await post('/auth/login', { email: 'nobody@acme.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect((await res.json() as any).error).toBe('invalid email or password');
  });

  it('rate-limits repeated failures', async () => {
    supabase = { ok: false, body: {} };
    for (let i = 0; i < 10; i++) {
      await post('/auth/login', { email: 'target@acme.com', password: `guess${i}` });
    }
    const res = await post('/auth/login', { email: 'target@acme.com', password: 'guess-again' });
    expect(res.status).toBe(429);
  });

  it('clears the rate limit after a genuine sign-in', async () => {
    supabase = { ok: false, body: {} };
    for (let i = 0; i < 3; i++) await post('/auth/login', { email: 'd@a.com', password: 'x' });
    supabase = { ok: true, body: goodSession };
    expect((await post('/auth/login', { email: 'd@a.com', password: 'right' })).status).toBe(200);
    expect([...kv.store.keys()].some((k) => k.startsWith('rl:'))).toBe(false);
  });

  it('requires an email and a password', async () => {
    expect((await post('/auth/login', { email: 'a@b.com' })).status).toBe(422);
  });

  it('refuses a login attempt from an origin we do not recognise (CSRF)', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await post('/auth/login', { email: 'd@a.com', password: 'x' }, { origin: 'https://evil.io' });
    expect(res.status).toBe(403);
  });

  it('refuses a mutating request with no Origin at all', async () => {
    const res = await post('/auth/login', { email: 'd@a.com', password: 'x' }, { origin: null });
    expect(res.status).toBe(403);
  });
});

describe('GET /auth/me', () => {
  it('reports nobody when there is no cookie', async () => {
    const res = await get('/auth/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('reports the signed-in user, and no token', async () => {
    supabase = { ok: true, body: goodSession };
    const sid = sidFrom(await post('/auth/login', { email: 'd@a.com', password: 'pw12345678' }));
    supabase = { ok: true, body: { id: 'user-1', email: 'dana@acme.com' } };
    const res = await get('/auth/me', `${COOKIE_NAME}=${sid}`);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('dana@acme.com');
    expect(body).not.toContain('at-123');
  });

  it('drops the session when Supabase no longer recognises the user', async () => {
    supabase = { ok: true, body: goodSession };
    const sid = sidFrom(await post('/auth/login', { email: 'd@a.com', password: 'pw12345678' }));
    supabase = { ok: false, body: {}, status: 401 }; // deleted or banned
    const res = await get('/auth/me', `${COOKIE_NAME}=${sid}`);
    expect(await res.json()).toEqual({ user: null });
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('a made-up cookie value resolves to nobody', async () => {
    expect(await (await get('/auth/me', `${COOKIE_NAME}=totally-invented`)).json())
      .toEqual({ user: null });
  });
});

describe('POST /auth/logout', () => {
  it('destroys the server-side session, so a copied cookie is dead too', async () => {
    supabase = { ok: true, body: goodSession };
    const sid = sidFrom(await post('/auth/login', { email: 'd@a.com', password: 'pw12345678' }));
    const res = await post('/auth/logout', {}, { cookie: `${COOKIE_NAME}=${sid}` });
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect([...kv.store.keys()].some((k) => k === `sess:${sid}`)).toBe(false);
  });
});

describe('POST /auth/exchange', () => {
  it('turns an invite link into a session without the browser seeing a token', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await post('/auth/exchange', { token_hash: 'abc', type: 'invite' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(JSON.stringify(await res.json())).not.toContain('rt-456');
  });

  it('refuses an expired or invalid link', async () => {
    supabase = { ok: false, body: {} };
    expect((await post('/auth/exchange', { token_hash: 'stale', type: 'recovery' })).status).toBe(401);
  });

  it('refuses an unsupported link type', async () => {
    expect((await post('/auth/exchange', { token_hash: 'a', type: 'something-else' })).status).toBe(422);
  });
});

describe('POST /auth/set-password', () => {
  it('requires being signed in', async () => {
    expect((await post('/auth/set-password', { password: 'longenough1' })).status).toBe(401);
  });

  it('enforces a minimum length', async () => {
    supabase = { ok: true, body: goodSession };
    const sid = sidFrom(await post('/auth/login', { email: 'd@a.com', password: 'pw12345678' }));
    const res = await post('/auth/set-password', { password: 'short' }, { cookie: `${COOKIE_NAME}=${sid}` });
    expect(res.status).toBe(422);
  });

  it('passes Supabase\'s own reason through so the person can act on it', async () => {
    supabase = { ok: true, body: goodSession };
    const sid = sidFrom(await post('/auth/login', { email: 'd@a.com', password: 'pw12345678' }));
    supabase = { ok: false, body: { msg: 'This password has appeared in a data breach' }, status: 422 };
    const res = await post('/auth/set-password', { password: 'password123' }, { cookie: `${COOKIE_NAME}=${sid}` });
    expect((await res.json() as any).error).toContain('data breach');
  });

  it('refuses an email change — invite claim is email-match', async () => {
    supabase = { ok: true, body: goodSession };
    const sid = sidFrom(await post('/auth/login', { email: 'd@a.com', password: 'pw12345678' }));
    const before = calls.length;
    const res = await post(
      '/auth/set-password',
      { password: 'longenough1', email: 'other@sample.com' },
      { cookie: `${COOKIE_NAME}=${sid}` },
    );
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toMatch(/email cannot be changed/i);
    expect(calls.slice(before).some((c) => c.method === 'PUT' && String(c.url).includes('/auth/v1/user'))).toBe(false);
  });
});

describe('POST /auth/reset-request', () => {
  it('always answers ok, so it cannot be used to discover which emails have accounts', async () => {
    supabase = { ok: false, body: {} };
    const res = await post('/auth/reset-request', { email: 'whoever@acme.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('Google sign-in (server-side PKCE)', () => {
  const nav = (path: string, cookie?: string) =>
    worker.fetch(
      new Request(`https://api.truhq.co${path}`, {
        headers: { ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual',
      }), env, ctx,
    );

  it('start redirects to Supabase with a hashed one-time secret, not the secret itself', async () => {
    const res = await nav('/auth/google/start');
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location') ?? '';
    expect(loc).toContain('/auth/v1/authorize');
    expect(loc).toContain('provider=google');
    expect(loc).toContain('code_challenge_method=s256');
    expect(loc).toContain('redirect_to=');

    // The verifier goes in an httpOnly cookie; only its hash goes to Supabase.
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('hq_pkce=');
    expect(cookie).toContain('HttpOnly');
    const verifier = /hq_pkce=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect(verifier).toMatch(/^[0-9a-f]{56}$/);
    expect(loc).not.toContain(verifier);
  });

  it('a fresh secret each time, so two sign-ins cannot be crossed', async () => {
    const a = /hq_pkce=([^;]+)/.exec((await nav('/auth/google/start')).headers.get('Set-Cookie') ?? '')?.[1];
    const b = /hq_pkce=([^;]+)/.exec((await nav('/auth/google/start')).headers.get('Set-Cookie') ?? '')?.[1];
    expect(a).not.toBe(b);
  });

  it('callback with no secret cookie is refused — it did not start in this browser', async () => {
    const res = await nav('/auth/google/callback?code=abc');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('auth_error=link_expired');
  });

  it('callback with no code is refused, and says which half was missing', async () => {
    const res = await nav('/auth/google/callback', 'hq_pkce=deadbeef');
    expect(res.headers.get('Location')).toContain('auth_error=no_code');
  });

  it('callback with a code but no verifier is refused as an expired link', async () => {
    const res = await nav('/auth/google/callback?code=abc');
    expect(res.headers.get('Location')).toContain('auth_error=link_expired');
  });

  it('handles the user declining at Google', async () => {
    const res = await nav('/auth/google/callback?error=access_denied', 'hq_pkce=deadbeef');
    expect(res.headers.get('Location')).toContain('auth_error=google_declined');
  });

  it('exchanges code + secret for a session and sets the httpOnly cookie', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await nav('/auth/google/callback?code=real-code', 'hq_pkce=abcdef1234');
    expect(res.status).toBe(302);
    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('Set-Cookie') ?? ''];
    const joined = cookies.join(' | ');
    expect(joined).toContain(`${COOKIE_NAME}=`);   // session installed
    expect(joined).toContain('HttpOnly');
    expect(joined).toContain('hq_pkce=;');          // one-time secret discarded
  });

  it('always returns the user to OUR app, never to a url from the query string', async () => {
    supabase = { ok: true, body: goodSession };
    // An attacker-supplied redirect would be an open-redirect phishing vector.
    const res = await nav('/auth/google/callback?code=c&redirect_to=https://evil.io', 'hq_pkce=abc');
    expect(res.headers.get('Location')).not.toContain('evil.io');
    expect(res.headers.get('Location')).toContain('truhq.co');
  });

  it('a failed exchange does not create a session', async () => {
    supabase = { ok: false, body: {} };
    const res = await nav('/auth/google/callback?code=bad', 'hq_pkce=abc');
    expect(res.headers.get('Location')).toContain('auth_error=signin_failed');
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain(`${COOKIE_NAME}=h`);
  });
});

describe('POST /auth/signup', () => {
  it('creates a session when Supabase returns one', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await post('/auth/signup', { email: 'new@acme.com', password: 'longenough1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, confirm: false });
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
  });

  it('says "confirm your email" instead of pretending to be signed in', async () => {
    // Email confirmation on: Supabase answers 200 with a user and NO tokens.
    supabase = { ok: true, body: { user: { id: 'u2', email: 'new@acme.com' } } };
    const res = await post('/auth/signup', { email: 'new@acme.com', password: 'longenough1' });
    expect(await res.json()).toEqual({ ok: true, confirm: true });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('refuses a password shorter than 8 without calling Supabase', async () => {
    const res = await post('/auth/signup', { email: 'a@b.com', password: 'short' });
    expect(res.status).toBe(422);
    expect(calls.length).toBe(0);
  });

  it('passes Supabase\'s reason through so the person can act on it', async () => {
    supabase = { ok: false, status: 422, body: { msg: 'User already registered' } };
    const res = await post('/auth/signup', { email: 'taken@acme.com', password: 'longenough1' });
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toBe('User already registered');
  });

  it('refuses a signup from an origin we do not recognise', async () => {
    const res = await post('/auth/signup', { email: 'a@b.com', password: 'longenough1' },
      { origin: 'https://evil.io' });
    expect(res.status).toBe(403);
  });

  it('never returns a token in the body', async () => {
    supabase = { ok: true, body: goodSession };
    const res = await post('/auth/signup', { email: 'new@acme.com', password: 'longenough1' });
    expect(JSON.stringify(await res.json())).not.toContain('at-123');
  });
});

describe('acting as a team', () => {
  /** Sign in as the owner and return their session id. */
  async function ownerSid(): Promise<string> {
    supabase = { ok: true, body: goodSession };
    return sidFrom(await post('/auth/login', { email: 'owner@truhq.co', password: 'pw12345678' }));
  }

  /** admins table says yes, generate_link mints a hash, verify returns the team's session. */
  function adminFlow(isAdmin = true) {
    route = (url) => {
      if (url.includes('/rest/v1/admins')) return { ok: true, body: isAdmin ? [{ id: 'user-1' }] : [] };
      if (url.includes('generate_link')) return { ok: true, body: { properties: { hashed_token: 'h-1' } } };
      if (url.includes('/auth/v1/verify')) return {
        ok: true,
        body: { access_token: 'team-at', refresh_token: 'team-rt', expires_in: 3600,
                user: { id: 'team-user', email: 'lead@team.com' } },
      };
      return null;
    };
  }

  it('swaps the cookie to the team without handing the browser anything', async () => {
    const sid = await ownerSid();
    adminFlow();
    const res = await post('/auth/act-as', { email: 'lead@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` });
    expect(res.status).toBe(200);
    const newSid = sidFrom(res);
    expect(newSid).not.toBe(sid);
    // No token, and no owner credential, anywhere in the reply.
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('team-at');
    expect(body).not.toContain('at-123');
  });

  it('keeps the owner session alive so Exit can restore it', async () => {
    const sid = await ownerSid();
    adminFlow();
    const actRes = await post('/auth/act-as', { email: 'lead@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` });
    const teamSid = sidFrom(actRes);
    expect(kv.store.has(`sess:${sid}`)).toBe(true);

    route = null;
    const back = await post('/auth/act-as/return', {}, { cookie: `${COOKIE_NAME}=${teamSid}` });
    expect(await back.json()).toEqual({ ok: true, restored: true });
    expect(sidFrom(back)).toBe(sid);
    // The impersonated session is gone, not left lying around.
    expect(kv.store.has(`sess:${teamSid}`)).toBe(false);
  });

  it('refuses someone who is not in the admins table', async () => {
    const sid = await ownerSid();
    adminFlow(false);
    const res = await post('/auth/act-as', { email: 'lead@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` });
    expect(res.status).toBe(403);
  });

  it('refuses when nobody is signed in', async () => {
    adminFlow();
    const res = await post('/auth/act-as', { email: 'lead@team.com' });
    expect(res.status).toBe(401);
  });

  it('will not act as a team from inside another team', async () => {
    const sid = await ownerSid();
    adminFlow();
    const teamSid = sidFrom(await post('/auth/act-as', { email: 'a@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` }));
    const again = await post('/auth/act-as', { email: 'b@team.com' }, { cookie: `${COOKIE_NAME}=${teamSid}` });
    expect(again.status).toBe(409);
  });

  it('signs out cleanly if the owner session expired while they were away', async () => {
    const sid = await ownerSid();
    adminFlow();
    const teamSid = sidFrom(await post('/auth/act-as', { email: 'lead@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` }));
    kv.store.delete(`sess:${sid}`); // owner session aged out
    route = null;
    const back = await post('/auth/act-as/return', {}, { cookie: `${COOKIE_NAME}=${teamSid}` });
    expect(await back.json()).toEqual({ ok: true, restored: false });
    expect(back.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('signing out while acting as a team ends the owner session too', async () => {
    const sid = await ownerSid();
    adminFlow();
    const teamSid = sidFrom(await post('/auth/act-as', { email: 'lead@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` }));
    route = null;
    await post('/auth/logout', {}, { cookie: `${COOKIE_NAME}=${teamSid}` });
    expect(kv.store.has(`sess:${sid}`)).toBe(false);
    expect(kv.store.has(`sess:${teamSid}`)).toBe(false);
  });

  it('tells the app a way back exists', async () => {
    const sid = await ownerSid();
    adminFlow();
    const teamSid = sidFrom(await post('/auth/act-as', { email: 'lead@team.com' }, { cookie: `${COOKIE_NAME}=${sid}` }));
    route = null;
    supabase = { ok: true, body: { id: 'team-user', email: 'lead@team.com' } };
    const me = await get('/auth/me', `${COOKIE_NAME}=${teamSid}`);
    expect(await me.json()).toEqual({ user: { id: 'team-user', email: 'lead@team.com' }, canReturn: true });
  });
});
