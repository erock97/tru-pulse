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
  createSession, destroySession, readCookie, readSession, withFreshToken,
  sessionCookie, clearCookie,
} from './session.js';
import { mintAuthLink, sendInviteEmail, authUserIdByEmail } from './invite.js';
import { db as serviceDb } from './db.js';


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
    // canReturn drives the "Exit — switch teams" control. It replaces the old test
    // of "is there a stashed owner token in localStorage", which the browser can no
    // longer answer because it holds nothing.
    return json(
      { user: { id: u.id, email: u.email }, canReturn: !!sess.returnSid },
      200,
      cors,
    );
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

    const code = url.searchParams.get('code');
    const verifier = readCookie(req, PKCE_COOKIE);
    // One line, no secrets, saying which of the three ways this can fail happened.
    // Without it a failed sign-in is indistinguishable from a page refresh, which is
    // exactly how long this took to diagnose the first time.
    console.log('auth/google/callback', JSON.stringify({
      hasCode: !!code,
      hasVerifier: !!verifier,
      googleError: url.searchParams.get('error') ?? null,
      params: [...url.searchParams.keys()],
    }));

    if (url.searchParams.get('error')) return fail('google_declined');
    // No verifier means this callback didn't start in this browser — refuse it.
    if (!code || !verifier) return fail(!code ? 'no_code' : 'link_expired');

    const res = await fetch(
      env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/token?grant_type=pkce',
      {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      },
    );
    if (!res.ok) {
      console.log('auth/google/callback exchange refused', res.status, (await res.text()).slice(0, 200));
      return fail('signin_failed');
    }
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

  // ── Create an account. ──
  // Answers `confirm: true` when Supabase withheld a session because the address
  // still needs confirming, which is the project's current setting. The caller shows
  // "check your email" for that and never assumes it is signed in.
  if (url.pathname === '/auth/signup' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
    const email = String(b?.email ?? '').trim().toLowerCase();
    const password = String(b?.password ?? '');
    if (!email || !password) return json({ error: 'email and password required' }, 422, cors);
    if (password.length < 8) return json({ error: 'use at least 8 characters' }, 422, cors);

    // Rate limited for the same reason login is: an open signup endpoint is a free
    // way to enumerate which addresses already have accounts, and to spray mail.
    const ip = req.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
    if (await tooManyAttempts(env, ip, email)) {
      return json({ error: 'too many attempts — wait a few minutes' }, 429, cors);
    }
    await noteAttempt(env, ip, email);

    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/signup', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      // Supabase explains the real problem (already registered, breached password,
      // too short); pass it through so the person can act on it.
      const err = (await res.json().catch(() => null)) as { msg?: string; message?: string } | null;
      return json({ error: err?.msg ?? err?.message ?? 'could not create that account' }, 422, cors);
    }
    const body = (await res.json()) as SupabaseSession;
    const newSid = await startSession(env, body);
    if (!newSid) return json({ ok: true, confirm: true }, 200, cors);
    await clearAttempts(env, ip, email);
    return json({ ok: true, confirm: false }, 200, { ...cors, 'Set-Cookie': sessionCookie(newSid, env) });
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
    const verified = (await res.json()) as SupabaseSession;
    const newSid = await startSession(env, verified);
    if (!newSid) return json({ error: 'could not start a session' }, 502, cors);
    // Return WHOSE link this was.
    //
    // The set-password screen used to name the account by asking "who am I?",
    // which answers with whatever session the browser is carrying. That is a
    // different question from "who is this link for", and when the two disagree
    // the screen confidently names the wrong person — and writes a password to
    // them. This is the authoritative answer, straight from the token that was
    // just verified, and the screen refuses to render if it disagrees with the
    // session it ends up holding.
    return json(
      { ok: true, email: verified.user?.email ?? null },
      200,
      { ...cors, 'Set-Cookie': sessionCookie(newSid, env) },
    );
  }

  // ── Set a password for the signed-in user (finishing an invite, or changing it). ──
  if (url.pathname === '/auth/set-password' && req.method === 'POST') {
    const sess = sid ? await withFreshToken(env, sid) : null;
    if (!sess) return json({ error: 'not signed in' }, 401, cors);
    const b = (await req.json().catch(() => null)) as { password?: string; email?: unknown } | null;
    // Invite claim is email-match. This route only sets a password on the minted
    // user — never a different address.
    if (b && 'email' in b && b.email != null) {
      return json({ error: 'email cannot be changed here' }, 422, cors);
    }
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
    // Supabase's own /recover sends the mail through Supabase's built-in SMTP,
    // which is capped at a couple of messages an hour for the whole project. On a
    // day when a team is onboarding, that cap is reached in minutes and every
    // reset after it fails with "email rate limit exceeded" — the agent sees
    // nothing arrive and concludes the account is broken. Mint the link with the
    // admin API (which sends no mail) and deliver it through Resend, exactly as
    // the invite does. No cap, and one sender to reason about.
    if (email) {
      await (async () => {
        const known = await authUserIdByEmail(env, email);
        if (!known) return; // never reveal whether an address has an account
        const { link } = await mintAuthLink(env, email, 'recovery');
        // Name their team if we know it, so the mail reads like the invite did.
        let orgName = 'TRU HQ';
        let name = email;
        const rows = await serviceDb(env).select(
          'agents', `email=ilike.${encodeURIComponent(email)}&select=name,orgs(name)&limit=1`,
        ).catch(() => [] as any[]);
        const hit = rows[0] as { name?: string; orgs?: { name?: string } | null } | undefined;
        if (hit) {
          name = String(hit.name ?? '').trim() || email;
          orgName = String(hit.orgs?.name ?? '').trim() || orgName;
        }
        await sendInviteEmail(env, { to: email, name, orgName, link, kind: 'agent' });
      })().catch(() => undefined);
    }
    return json({ ok: true }, 200, cors);
  }

  // ── Act as a team, and come back. ──────────────────────────────────────────
  // The old flow handed the browser a one-time token, then stashed the OWNER's
  // access AND refresh token in localStorage so "Exit" could restore them. That
  // stash was the single highest-privilege secret in the product sitting in the
  // place this migration exists to empty. Here the swap happens entirely in KV:
  // the owner's session simply stays alive under its own id, and the impersonated
  // session remembers that id. Nothing is copied and nothing is handed out.
  if (url.pathname === '/auth/act-as' && req.method === 'POST') {
    const sess = sid ? await withFreshToken(env, sid) : null;
    if (!sess) return json({ error: 'not signed in' }, 401, cors);
    // Never let an impersonated session start another one — that would build a chain
    // whose "Exit" no longer lands on the real owner.
    if (sess.returnSid) return json({ error: 'already acting as a team' }, 409, cors);

    const b = (await req.json().catch(() => null)) as { email?: string } | null;
    const email = String(b?.email ?? '').trim().toLowerCase();
    if (!email) return json({ error: 'email required' }, 422, cors);

    const rest = env.SUPABASE_URL.replace(/\/$/, '');
    const serviceHeaders = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    };

    // Same gate as /admin/*: listed in the admins table, checked server-side.
    const adminRes = await fetch(
      `${rest}/rest/v1/admins?id=eq.${encodeURIComponent(sess.userId)}&select=id`,
      { headers: serviceHeaders },
    );
    const admins = adminRes.ok ? ((await adminRes.json()) as unknown[]) : [];
    if (!admins.length) return json({ error: 'forbidden' }, 403, cors);

    const linkRes = await fetch(`${rest}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    const gl = (await linkRes.json().catch(() => null)) as
      | { properties?: { hashed_token?: string }; hashed_token?: string }
      | null;
    const hashed = gl?.properties?.hashed_token ?? gl?.hashed_token;
    if (!linkRes.ok || !hashed) return json({ error: 'could not start that session' }, 502, cors);

    const verifyRes = await fetch(`${rest}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_hash: hashed, type: 'magiclink' }),
    });
    if (!verifyRes.ok) return json({ error: 'could not start that session' }, 502, cors);

    const body = (await verifyRes.json()) as SupabaseSession;
    if (!body.access_token || !body.refresh_token || !body.user?.id) {
      return json({ error: 'could not start that session' }, 502, cors);
    }
    // The owner's session is deliberately NOT destroyed — it is what Exit returns to.
    const newSid = await createSession(env, {
      userId: body.user.id,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600),
      returnSid: sid ?? undefined,
    });
    return json({ ok: true }, 200, { ...cors, 'Set-Cookie': sessionCookie(newSid, env) });
  }

  // ── Exit: back to the owner's own session, or signed out if it has expired. ──
  if (url.pathname === '/auth/act-as/return' && req.method === 'POST') {
    const current = await readSession(env, sid);
    const ownerSid = current?.returnSid ?? null;
    const owner = ownerSid ? await readSession(env, ownerSid) : null;
    // Drop the impersonated session either way: leaving it alive would leave a live
    // credential for a team the owner has finished looking at.
    await destroySession(env, sid);
    if (!owner || !ownerSid) {
      return json({ ok: true, restored: false }, 200, { ...cors, 'Set-Cookie': clearCookie(env) });
    }
    return json({ ok: true, restored: true }, 200, { ...cors, 'Set-Cookie': sessionCookie(ownerSid, env) });
  }

  // ── Sign out. Kills the server-side session, not just the cookie, so a copied
  //    cookie is dead too. ──
  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    // Signing out while acting as a team must end the owner's session too. Otherwise
    // it survives in KV with nothing pointing at it — a live credential nobody can
    // see and nobody revoked.
    const current = await readSession(env, sid);
    if (current?.returnSid) await destroySession(env, current.returnSid);
    await destroySession(env, sid);
    return json({ ok: true }, 200, { ...cors, 'Set-Cookie': clearCookie(env) });
  }

  return json({ error: 'not found' }, 404, cors);
}
