// One front door for "who is signed in", used by every page.
//
// Two implementations live behind it. In cookie mode the Worker holds the session and
// the browser holds an opaque cookie it cannot read; in token mode supabase-js holds a
// token in localStorage, the way it always has. Pages call the same functions either
// way, so the cutover is a config change rather than an edit to every screen.
//
// There is deliberately no getToken() here. If this module could hand a token to other
// code, cookie mode would have rebuilt the exact problem it exists to remove.
import { supabase } from './supabase';
import { isCookieAuth } from './authClient';
import * as cookieAuth from './authClient';

const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

export interface AuthUser { id: string; email: string | null }
/** Shaped like a Supabase session so `userIdOf` reads either one unchanged. */
export interface AuthState { user: AuthUser }

/** Set in cookie mode when a platform owner is acting as a team, so the UI can
 *  offer the way back. In token mode the old localStorage stash answers this. */
let canReturn = false;
export function hasActAsReturn(): boolean {
  return isCookieAuth ? canReturn : legacyHasAdminReturn();
}

function legacyHasAdminReturn(): boolean {
  try { return !!localStorage.getItem('hq_admin_return'); } catch { return false; }
}

const listeners = new Set<(s: AuthState | null) => void>();

/** Re-ask the Worker who we are and tell everyone listening. Cookie mode has no
 *  event stream — the browser holds nothing to emit events about — so anything that
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
  if (isCookieAuth) {
    listeners.add(cb);
    void refreshAuth();
    return () => { listeners.delete(cb); };
  }
  supabase.auth.getSession().then(({ data }) => cb(data.session ? { user: toUser(data.session.user) } : null));
  const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
    cb(s ? { user: toUser(s.user) } : null);
  });
  return () => sub.subscription.unsubscribe();
}

/** Did this load arrive from a password-reset or invite link? */
export function onPasswordRecovery(cb: () => void): () => void {
  if (isCookieAuth) return () => { /* cookie mode reads the link directly, see App */ };
  const { data: sub } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') cb();
  });
  return () => sub.subscription.unsubscribe();
}

function toUser(u: { id: string; email?: string | null }): AuthUser {
  return { id: u.id, email: u.email ?? null };
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<AuthUser | null> {
  if (isCookieAuth) return cookieAuth.me();
  const { data } = await supabase.auth.getUser();
  return data.user ? toUser(data.user) : null;
}

export async function signIn(email: string, password: string): Promise<void> {
  if (isCookieAuth) {
    await cookieAuth.login(email, password);
    await refreshAuth();
    return;
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Returns true when the account still needs an email confirmation before sign-in. */
export async function signUp(email: string, password: string): Promise<{ confirm: boolean }> {
  if (isCookieAuth) {
    const r = await cookieAuth.signup(email, password);
    if (!r.confirm) await refreshAuth();
    return r;
  }
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return { confirm: !data.session };
}

/** Google. Cookie mode leaves the page: the Worker needs to receive the code itself,
 *  because the browser-only flow returns tokens in the URL and can never produce an
 *  httpOnly cookie. */
export async function signInWithGoogle(): Promise<void> {
  if (isCookieAuth) {
    window.location.href = WORKER_URL + '/auth/google/start';
    return;
  }
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (isCookieAuth) return cookieAuth.requestReset(email);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

export async function setPassword(password: string): Promise<void> {
  if (isCookieAuth) {
    await cookieAuth.setPassword(password);
    return;
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

/** Turn an invite / reset link into a session. */
export async function exchangeLink(tokenHash: string, type: string): Promise<void> {
  if (isCookieAuth) {
    await cookieAuth.exchange(tokenHash, type);
    await refreshAuth();
    return;
  }
  const { error } = await supabase.auth.verifyOtp({
    type: type as 'magiclink' | 'recovery' | 'invite' | 'email',
    token_hash: tokenHash,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  try { localStorage.removeItem('hq_admin_return'); } catch { /* private mode */ }
  if (isCookieAuth) {
    await cookieAuth.logout().catch(() => undefined);
    canReturn = false;
    await refreshAuth();
    return;
  }
  await supabase.auth.signOut();
}
