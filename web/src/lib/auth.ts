// One front door for "who is signed in", used by every page.
//
// The Worker holds the session; the browser holds an opaque httpOnly cookie it cannot
// read. This module used to carry a second implementation behind VITE_AUTH_MODE, where
// supabase-js kept a token in localStorage. That path is gone, and with it the reason
// the browser needed a database key at all.
//
// There is deliberately no getToken() here and there never should be. If this module
// could hand a token to other code, we would have rebuilt the exact problem this
// design exists to remove.
import * as cookieAuth from './authClient';

const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

export interface AuthUser { id: string; email: string | null }
/** Shaped like a Supabase session so `userIdOf` reads it unchanged. */
export interface AuthState { user: AuthUser }

/** Set when a platform owner is acting as a team, so the UI can offer the way back.
 *  Answered by the Worker on /auth/me — the browser has nothing of its own to consult. */
let canReturn = false;
export function hasActAsReturn(): boolean {
  return canReturn;
}

const listeners = new Set<(s: AuthState | null) => void>();

/** Re-ask the Worker who we are and tell everyone listening. There is no event stream
 *  to subscribe to — the browser holds nothing to emit events about — so anything that
 *  changes the session calls this instead. */
export async function refreshAuth(): Promise<AuthState | null> {
  const res = await fetch(WORKER_URL + '/auth/me', { credentials: 'include' })
    .then((r) => r.json() as Promise<{ user: AuthUser | null; canReturn?: boolean }>)
    .catch(() => ({ user: null, canReturn: false }));
  canReturn = !!res.canReturn;
  const state = res.user ? { user: res.user } : null;
  for (const fn of listeners) fn(state);
  return state;
}

/**
 * Subscribe to who is signed in. Fires once with the current answer, then again on
 * every change. Returns an unsubscribe.
 */
export function onAuthChange(cb: (s: AuthState | null) => void): () => void {
  listeners.add(cb);
  void refreshAuth();
  return () => { listeners.delete(cb); };
}

/** Did this load arrive from a password-reset or invite link? Retained so App.tsx reads
 *  the same either way: the link is now read directly from the URL there, so nothing
 *  needs to fire here. */
export function onPasswordRecovery(_cb: () => void): () => void {
  return () => { /* the recovery link is parsed in App, not signalled from here */ };
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<AuthUser | null> {
  return cookieAuth.me();
}

export async function signIn(email: string, password: string): Promise<void> {
  await cookieAuth.login(email, password);
  await refreshAuth();
}

/** Returns true when the account still needs an email confirmation before sign-in. */
export async function signUp(email: string, password: string): Promise<{ confirm: boolean }> {
  const r = await cookieAuth.signup(email, password);
  if (!r.confirm) await refreshAuth();
  return r;
}

/** Google. This leaves the page: the Worker needs to receive the code itself, because
 *  the browser-only flow returns tokens in the URL and can never produce an httpOnly
 *  cookie. */
export async function signInWithGoogle(): Promise<void> {
  window.location.href = WORKER_URL + '/auth/google/start';
}

export async function requestPasswordReset(email: string): Promise<void> {
  return cookieAuth.requestReset(email);
}

export async function setPassword(password: string): Promise<void> {
  await cookieAuth.setPassword(password);
}

/** Turn an invite / reset link into a session. */
export async function exchangeLink(tokenHash: string, type: string): Promise<void> {
  await cookieAuth.exchange(tokenHash, type);
  await refreshAuth();
}

export async function signOut(): Promise<void> {
  // Clears the last remnant of the retired token path: an owner access AND refresh
  // token that acting-as used to stash in localStorage. Harmless if absent, and worth
  // keeping for a while so anyone still carrying one from before the cutover loses it.
  try { localStorage.removeItem('hq_admin_return'); } catch { /* private mode */ }
  await cookieAuth.logout().catch(() => undefined);
  canReturn = false;
  await refreshAuth();
}
