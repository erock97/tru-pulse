// Server-held login sessions.
//
// The browser gets an opaque id in an httpOnly cookie and nothing else. The Supabase
// access and refresh tokens live in KV, where no script on the page can reach them —
// which is the whole point of the migration. Today those tokens sit in localStorage,
// so any injected script could read them and walk off with the login; worse, the
// refresh token mints new logins for a long time.
//
// KV rather than an encrypted cookie so a session can be REVOKED. Offboard an agent
// and their access ends immediately rather than whenever their token expires.
import type { Env } from './env.js';

export const COOKIE_NAME = 'hq_sid';

/** How long a session survives without use. Refresh extends it. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
/** Refresh the Supabase access token when it's within this of expiring. */
const REFRESH_SKEW_SECONDS = 120;

export interface SessionRecord {
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the ACCESS token expires (not the session). */
  expiresAt: number;
  createdAt: number;
}

/** 32 random bytes, base64url. Long enough that guessing is not a strategy. */
export function newSessionId(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const key = (sid: string) => `sess:${sid}`;

export async function createSession(env: Env, rec: Omit<SessionRecord, 'createdAt'>): Promise<string> {
  const sid = newSessionId();
  const full: SessionRecord = { ...rec, createdAt: Math.floor(Date.now() / 1000) };
  await env.SESSIONS.put(key(sid), JSON.stringify(full), { expirationTtl: SESSION_TTL_SECONDS });
  return sid;
}

export async function readSession(env: Env, sid: string | null): Promise<SessionRecord | null> {
  if (!sid) return null;
  const raw = await env.SESSIONS.get(key(sid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null; // corrupt record reads as no session rather than throwing
  }
}

export async function destroySession(env: Env, sid: string | null): Promise<void> {
  if (sid) await env.SESSIONS.delete(key(sid));
}

/**
 * Return a session with a usable access token, refreshing against Supabase if the
 * current one is about to expire. The browser never participates — which is what
 * removes today's tab-focus refresh behaviour as a category of problem, since that
 * was the browser being told its session had changed.
 *
 * Returns null if the refresh fails, i.e. the session is genuinely dead.
 */
export async function withFreshToken(env: Env, sid: string): Promise<SessionRecord | null> {
  const sess = await readSession(env, sid);
  if (!sess) return null;

  const now = Math.floor(Date.now() / 1000);
  if (sess.expiresAt - now > REFRESH_SKEW_SECONDS) return sess;

  const res = await fetch(
    env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/token?grant_type=refresh_token',
    {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refreshToken }),
    },
  );
  if (!res.ok) {
    // Supabase rotates refresh tokens; a rejected one means this session is over.
    await destroySession(env, sid);
    return null;
  }
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: string } }
    | null;
  if (!body?.access_token || !body.refresh_token) {
    await destroySession(env, sid);
    return null;
  }

  const updated: SessionRecord = {
    ...sess,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600),
  };
  await env.SESSIONS.put(key(sid), JSON.stringify(updated), { expirationTtl: SESSION_TTL_SECONDS });
  return updated;
}

/**
 * The cookie itself. Every flag here is load-bearing:
 *   HttpOnly  — no script can read it, which is the entire reason we're doing this
 *   Secure    — never sent over plain http
 *   SameSite=Lax — the browser won't attach it to requests started by another site,
 *                  which is the first line of defence now that it sends automatically.
 *                  app.truhq.co -> api.truhq.co is same-site (both under truhq.co),
 *                  so the app keeps working.
 *   Path=/    — every route
 * Host-only by default (no Domain attribute), so it is scoped to api.truhq.co alone
 * and never broadcast to other truhq.co subdomains.
 */
export function sessionCookie(sid: string, env?: Env): string {
  const parts = [
    `${COOKIE_NAME}=${sid}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (env?.AUTH_COOKIE_DOMAIN) parts.push(`Domain=${env.AUTH_COOKIE_DOMAIN}`);
  return parts.join('; ');
}

export function clearCookie(env?: Env): string {
  const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (env?.AUTH_COOKIE_DOMAIN) parts.push(`Domain=${env.AUTH_COOKIE_DOMAIN}`);
  return parts.join('; ');
}

/** Pull our session id out of a Cookie header without a cookie-parsing dependency. */
export function readCookie(req: Request, name = COOKIE_NAME): string | null {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
