// Cookie-mode auth client.
//
// Talks to the Worker instead of Supabase, and holds nothing. There is deliberately no
// getToken() here and there never should be: if this module could hand a token to
// other code, we'd have rebuilt the problem the migration exists to remove.
//
// `credentials: 'include'` is what makes the browser send (and store) the httpOnly
// cookie on a cross-origin request to api.truhq.co. Without it the cookie is silently
// ignored and every call looks signed-out, which is the first thing to check if
// something appears broken after the cutover.
const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

/** 'cookie' once the cutover happens; 'token' keeps the existing supabase-js path. */
export const AUTH_MODE: 'cookie' | 'token' =
  (import.meta.env.VITE_AUTH_MODE as 'cookie' | 'token') ?? 'token';

export const isCookieAuth = AUTH_MODE === 'cookie';

export interface AuthUser { id: string; email: string | null }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(WORKER_URL + path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Something went wrong. Try again.');
  return body;
}

/** Who's signed in, or null. The app can no longer inspect a token, so it asks. */
export async function me(): Promise<AuthUser | null> {
  const { user } = await call<{ user: AuthUser | null }>('/auth/me', { method: 'GET' });
  return user;
}

export async function login(email: string, password: string): Promise<void> {
  await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

/** Create an account. `confirm` is true when the address still needs confirming,
 *  in which case no session exists yet and the caller must not pretend otherwise. */
export async function signup(email: string, password: string): Promise<{ confirm: boolean }> {
  const r = await call<{ confirm?: boolean }>('/auth/signup', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  return { confirm: !!r.confirm };
}

/** Platform owner: act as a team. The swap happens server-side; nothing comes back. */
export async function actAs(email: string): Promise<void> {
  await call('/auth/act-as', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Exit acting-as. `restored` is false when the owner's own session had expired,
 *  which means they are now signed out rather than back on their own HQ. */
export async function actAsReturn(): Promise<{ restored: boolean }> {
  const r = await call<{ restored?: boolean }>('/auth/act-as/return', {
    method: 'POST', body: '{}',
  });
  return { restored: !!r.restored };
}

/** Turn an invite / reset / act-as link into a session. */
export async function exchange(tokenHash: string, type: string): Promise<void> {
  await call('/auth/exchange', {
    method: 'POST', body: JSON.stringify({ token_hash: tokenHash, type }),
  });
}

export async function setPassword(password: string): Promise<void> {
  await call('/auth/set-password', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function requestReset(email: string): Promise<void> {
  await call('/auth/reset-request', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Ends the session server-side, so a copied cookie dies with it. */
export async function logout(): Promise<void> {
  await call('/auth/logout', { method: 'POST', body: '{}' });
}
