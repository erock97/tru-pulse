// Server-held sessions. The security properties here are the entire point of the
// cookie migration, so they get pinned rather than assumed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COOKIE_NAME, newSessionId, createSession, readSession, destroySession,
  withFreshToken, sessionCookie, clearCookie, readCookie,
} from './session.js';
import type { Env } from './env.js';

/** In-memory stand-in for KV, including expirationTtl bookkeeping. */
function fakeKV() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    get: async (k: string) => store.get(k)?.value ?? null,
    put: async (k: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(k, { value, ttl: opts?.expirationTtl });
    },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace & { store: Map<string, { value: string; ttl?: number }> };
}

const SUPA = 'https://proj.supabase.co';
let kv: ReturnType<typeof fakeKV>;
let env: Env;

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  kv = fakeKV();
  env = { SESSIONS: kv, SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon' } as unknown as Env;
});

describe('session ids', () => {
  it('are long, url-safe and unguessable-by-construction', () => {
    const a = newSessionId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url, unpadded
    expect(a).not.toContain('+');
    expect(a).not.toContain('/');
    expect(a).not.toContain('=');
  });

  it('do not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(seen.size).toBe(200);
  });
});

describe('create / read / destroy', () => {
  it('round-trips a session and stores an expiry so it cannot live forever', async () => {
    const sid = await createSession(env, {
      userId: 'u1', accessToken: 'at', refreshToken: 'rt', expiresAt: now() + 3600,
    });
    const got = await readSession(env, sid);
    expect(got).toMatchObject({ userId: 'u1', accessToken: 'at', refreshToken: 'rt' });
    expect(kv.store.get(`sess:${sid}`)?.ttl).toBeGreaterThan(0);
  });

  it('an unknown or absent id reads as no session, never an error', async () => {
    expect(await readSession(env, 'not-a-real-id')).toBeNull();
    expect(await readSession(env, null)).toBeNull();
  });

  it('a corrupt record reads as no session rather than throwing', async () => {
    await kv.put('sess:broken', '{not json');
    expect(await readSession(env, 'broken')).toBeNull();
  });

  it('destroy makes the session unusable immediately — this is revocation', async () => {
    const sid = await createSession(env, {
      userId: 'u1', accessToken: 'at', refreshToken: 'rt', expiresAt: now() + 3600,
    });
    await destroySession(env, sid);
    expect(await readSession(env, sid)).toBeNull();
  });
});

describe('withFreshToken', () => {
  it('leaves a healthy session alone and does NOT call Supabase', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sid = await createSession(env, {
      userId: 'u1', accessToken: 'good', refreshToken: 'rt', expiresAt: now() + 3600,
    });
    const got = await withFreshToken(env, sid);
    expect(got?.accessToken).toBe('good');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token server-side and stores the rotated refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const sid = await createSession(env, {
      userId: 'u1', accessToken: 'old-at', refreshToken: 'old-rt', expiresAt: now() + 10,
    });
    const got = await withFreshToken(env, sid);
    expect(got?.accessToken).toBe('new-at');
    // Supabase rotates refresh tokens; keeping the old one would break the next refresh.
    expect(got?.refreshToken).toBe('new-rt');
    expect((await readSession(env, sid))?.accessToken).toBe('new-at');
  });

  it('kills the session when Supabase rejects the refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    const sid = await createSession(env, {
      userId: 'u1', accessToken: 'old', refreshToken: 'revoked', expiresAt: now() + 5,
    });
    expect(await withFreshToken(env, sid)).toBeNull();
    // and it's gone, so a stale cookie can't keep being retried
    expect(await readSession(env, sid)).toBeNull();
  });

  it('kills the session on a malformed refresh response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'a' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    const sid = await createSession(env, {
      userId: 'u1', accessToken: 'old', refreshToken: 'rt', expiresAt: now() + 5,
    });
    expect(await withFreshToken(env, sid)).toBeNull();
  });
});

describe('the cookie', () => {
  // Each flag is load-bearing; a silent regression here would undo the migration.
  it('is HttpOnly, so no script can read it — the entire point', () => {
    expect(sessionCookie('abc')).toContain('HttpOnly');
  });

  it('is Secure and SameSite=Lax', () => {
    const c = sessionCookie('abc');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
  });

  it('is host-only by default — not broadcast to other truhq.co subdomains', () => {
    expect(sessionCookie('abc')).not.toContain('Domain=');
  });

  it('carries the id and a lifetime', () => {
    const c = sessionCookie('abc123');
    expect(c).toContain(`${COOKIE_NAME}=abc123`);
    expect(c).toMatch(/Max-Age=\d+/);
  });

  it('clearing it expires immediately and keeps the same flags', () => {
    const c = clearCookie();
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
  });
});

describe('readCookie', () => {
  const withCookie = (v: string) => new Request('https://api.test/', { headers: { Cookie: v } });

  it('finds our cookie among others', () => {
    expect(readCookie(withCookie(`a=1; ${COOKIE_NAME}=xyz; b=2`))).toBe('xyz');
  });

  it('tolerates whitespace', () => {
    expect(readCookie(withCookie(`  ${COOKIE_NAME}=xyz  `))).toBe('xyz');
  });

  it('returns null with no cookie header, an empty value, or a different name', () => {
    expect(readCookie(new Request('https://api.test/'))).toBeNull();
    expect(readCookie(withCookie(`${COOKIE_NAME}=`))).toBeNull();
    expect(readCookie(withCookie('other=1'))).toBeNull();
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    expect(readCookie(withCookie(`not_${COOKIE_NAME}=nope`))).toBeNull();
  });
});
