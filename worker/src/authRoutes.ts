// Login, handled server-side so the browser never holds a token.
//
// Every route here is additive: the existing browser-side Supabase auth keeps working
// untouched until the web app is switched over with VITE_AUTH_MODE. Nothing in this
// file changes behaviour for anyone until then.
//
// Two rules apply to all of it:
//   1. No token is EVER returned in a response body. If one leaks into JSON we have
//      rebuilt the problem we're migrating away from.
//   2. Mutating routes require a browser Origin we recognise. Cookies are sent
//      automatically, so this is what stops another site driving them (CSRF).
import type { Env } from './env.js';
import {
  createSession, destroySession, readCookie, withFreshToken,
  sessionCookie, clearCookie,
} from './session.js';


// ── Google sign-in, server-side (PKCE) ──────────────────────────────────────
// The browser-only flow returns tokens in the URL fragment, which never reaches a
// server — so it cannot produce an httpOnly cookie. The code flow can: we send the
// user to Supabase with a hashed one-time secret, Supabase sends back a code, and we
// exchange code + secret for a session here.
//
// Endpoints and parameter names were read out of @supabase/auth-js rather than guessed:
//   authorize: /auth/v1/authorize?provider=google&redirect_to=..&code_challenge=..&code_challenge_method=s256
//   exchange:  POST /auth/v1/token?grant_type=pkce  { auth_code, code_verifier }
//   challenge: base64url(sha256(verifier)), method 's256'

/** The one-time secret. 56 hex chars, matching the library's own verifier length. */
function newVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function challengeFor(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let bin = '';
  for (const b of new Uint8Array(hash)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const PKCE_COOKIE = 'hq_pkce';

/** Short-lived, httpOnly. Binds the callback to the browser that started the sign-in,
 *  which is what stops someone else's code being redeemed in your session. */
function pkceCookie(verifier: string): string {
  return `${PKCE_COOKIE}=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=600`;
}
function clearPkce(): string {
  return `${PKCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=0`;
}

export interface AuthDeps {
  /** Is this Origin one of ours? Reuses the Worker's single allowlist. */
  originAllowed: (origin: string) => boolean;
  cors: Record<string, string>;
}

const json = (obj: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

/**
 * Brute force is the obvious attack on a login endpoint, so cap attempts per IP and
 * per email. Deliberately counts BOTH: per-IP alone lets someone spray one password
 * across many accounts from a botnet, and per-email alone lets one IP grind a
 * password list. KV with a TTL is enough — this doesn't need to be exact, it needs to
 * make the attempt uneconomic.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 900; // 15 minutes

async function tooManyAttempts(env: Env, ip: string, email: string): Promise<boolean> {
  const keys = [`rl:ip:${ip}`, `rl:em:${email}`];
  for (const k of keys) {
    const n = Number((await env.SESSIONS.get(k)) ?? '0');
    if (n >= MAX_ATTEMPTS) return true;
  }
  return false;
}
async function noteAttempt(env: Env, ip: string, email: string): Promise<void> {
  for (const k of [`rl:ip:${ip}`, `rl:em:${email}`]) {
    const n = Number((await env.SESSIONS.get(k)) ?? '0') + 1;
    await env.SESSIONS.put(k, String(n), { expirationTtl: WINDOW_SECONDS });
  }
}
async function clearAttempts(env: Env, ip: string, email: string): Promise<void> {
  await Promise.all([env.SESSIONS.delete(`rl:ip:${ip}`), env.SESSIONS.delete(`rl:em:${email}`)]);
}

/** Shape Supabase returns from a successful password grant or OTP verify. */
interface SupabaseSession {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

async function startSession(env: Env, body: SupabaseSession): Promise<string | null> {
  if (!body.access_token || !body.refresh_token || !body.user?.id) return null;
  return createSession(env, {
    userId: body.user.id,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600),
  });
}

/**
 * Returns a Response when this request belongs to auth, or null so the caller falls
 * through to its existing routes.
 */
export async function handleAuthRoutes(
  req: Request,
  env: Env,
  url: URL,
  deps: AuthDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/auth/')) return null;
  const { cors } = deps;
  const sid = readCookie(req);

  // ── Who am I? The app can no longer inspect a token, so it asks. ──
  if (url.pathname === '/auth/me' && req.method === 'GET') {
    const sess = sid ? await withFreshToken(env, sid) : null;
    if (!sess) return json({ user: null }, 200, cors);
    // Ask Supabase rather than trusting anything cached, so a deleted or banned user
    // stops resolving straight away.
    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + sess.accessToken },
    });
    if (!res.ok) {
      await destroySession(env, sid);
      return json({ user: null }, 200, { ...cors, 'Set-Cookie': clearCookie(env) });
    }
    const u = (await res.json()) as { id?: string; email?: string };
    return json({ user: { id: u.id, email: u.email } }, 200, cors);
  }


  // ── Start Google sign-in. A top-level navigation, so it answers with a redirect. ──
  if (url.pathname === '/auth/google/start' && req.method === 'GET') {
    const verifier = newVerifier();
    const challenge = await challengeFor(verifier);
    const callback = `${url.origin}/auth/google/callback`;
    const authorize =
      env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/authorize'
      + `?provider=google&redirect_to=${encodeURIComponent(callback)}`
      + `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=s256`;
    return new Response(null, {
      status: 302,
      headers: { ...cors, Location: authorize, 'Set-Cookie': pkceCookie(verifier) },
    });
  }

  // ── Google sends the user back here with a code. ──
  if (url.pathname === '/auth/google/callback' && req.method === 'GET') {
    // Where we send them afterwards is HARD-CODED, never taken from a query parameter —
    // an attacker-controlled redirect target is how open-redirect phishing works.
    const appUrl = env.APP_ORIGIN ?? 'https://app.truhq.co';
    const fail = (why: string) => new Response(null, {
      status: 302,
      headers: { ...cors, Location: `${appUrl}/?auth_error=${encodeURIComponent(why)}`, 'Set-Cookie': clearPkce() },
    });

    if (url.searchParams.get('error')) return fail('google_declined');
    const code = url.searchParams.get('code');
    const verifier = readCookie(req, PKCE_COOKIE);
    // No verifier means this callback didn't start in this browser — refuse it.
    if (!code || !verifier) return fail('link_expired');

    const res = await fetch(
      env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/token?grant_type=pkce',
      {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      },
    );
    if (!res.ok) return fail('signin_failed');
    const newSid = await startSession(env, (await res.json()) as SupabaseSession);
    if (!newSid) return fail('signin_failed');

    // Two Set-Cookie headers: install the session, discard the one-time secret.
    const headers = new Headers({ ...cors, Location: appUrl });
    headers.append('Set-Cookie', sessionCookie(newSid, env));
    headers.append('Set-Cookie', clearPkce());
    return new Response(null, { status: 302, headers });
  }

  // Everything below changes state, so it needs a browser origin we recognise.
  const origin = req.headers.get('Origin') ?? '';
  if (req.method === 'POST' && !deps.originAllowed(origin)) {
    return json({ error: 'origin not allowed' }, 403, cors);
  }

  // ── Sign in with a password. ──
  if (url.pathname === '/auth/login' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
    const email = String(b?.email ?? '').trim().toLowerCase();
    const password = String(b?.password ?? '');
    if (!email || !password) return json({ error: 'email and password required' }, 422, cors);

    const ip = req.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
    if (await tooManyAttempts(env, ip, email)) {
      return json({ error: 'too many attempts — wait a few minutes' }, 429, cors);
    }

    const res = await fetch(
      env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/token?grant_type=password',
      {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
    );
    if (!res.ok) {
      await noteAttempt(env, ip, email);
      // Deliberately vague: never reveal whether the address exists.
      return json({ error: 'invalid email or password' }, 401, cors);
    }
    const newSid = await startSession(env, (await res.json()) as SupabaseSession);
    if (!newSid) return json({ error: 'could not start a session' }, 502, cors);
    await clearAttempts(env, ip, email);
    return json({ ok: true }, 200, { ...cors, 'Set-Cookie': sessionCookie(newSid, env) });
  }

  // ── Exchange a one-time link for a session. ──
  // Backs the invite / password-reset / act-as flows, which today hand the browser a
  // token in the URL hash for supabase-js to swallow. Now the worker swallows it, so
  // the token never becomes something the page holds.
  if (url.pathname === '/auth/exchange' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { token_hash?: string; type?: string } | null;
    const tokenHash = String(b?.token_hash ?? '').trim();
    const type = String(b?.type ?? 'magiclink').trim();
    if (!tokenHash) return json({ error: 'token_hash required' }, 422, cors);
    if (!['magiclink', 'recovery', 'invite', 'email'].includes(type)) {
      return json({ error: 'unsupported type' }, 422, cors);
    }

    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_hash: tokenHash, type }),
    });
    if (!res.ok) return json({ error: 'that link is invalid or has expired' }, 401, cors);
    const newSid = await startSession(env, (await res.json()) as SupabaseSession);
    if (!newSid) return json({ error: 'could not start a session' }, 502, cors);
    return json({ ok: true }, 200, { ...cors, 'Set-Cookie': sessionCookie(newSid, env) });
  }

  // ── Set a password for the signed-in user (finishing an invite, or changing it). ──
  if (url.pathname === '/auth/set-password' && req.method === 'POST') {
    const sess = sid ? await withFreshToken(env, sid) : null;
    if (!sess) return json({ error: 'not signed in' }, 401, cors);
    const b = (await req.json().catch(() => null)) as { password?: string } | null;
    const password = String(b?.password ?? '');
    if (password.length < 8) return json({ error: 'use at least 8 characters' }, 422, cors);

    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      method: 'PUT',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + sess.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      // Supabase returns the real reason here (too short, breached, same as before);
      // pass it through so the person can act on it.
      const err = (await res.json().catch(() => null)) as { msg?: string; message?: string } | null;
      return json({ error: err?.msg ?? err?.message ?? 'could not update password' }, 422, cors);
    }
    return json({ ok: true }, 200, cors);
  }

  // ── Ask for a reset email. Always answers ok, so it can't be used to test which
  //    addresses have accounts. ──
  if (url.pathname === '/auth/reset-request' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { email?: string } | null;
    const email = String(b?.email ?? '').trim().toLowerCase();
    if (email) {
      await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/recover', {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => undefined);
    }
    return json({ ok: true }, 200, cors);
  }

  // ── Sign out. Kills the server-side session, not just the cookie, so a copied
  //    cookie is dead too. ──
  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    await destroySession(env, sid);
    return json({ ok: true }, 200, { ...cors, 'Set-Cookie': clearCookie(env) });
  }

  return json({ error: 'not found' }, 404, cors);
}
