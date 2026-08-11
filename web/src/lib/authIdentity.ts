// Who is signed in, reduced to a comparable string.
//
// supabase-js auto-refreshes its token whenever the tab regains visibility and
// emits an auth event carrying a BRAND-NEW session object for the same person.
// React sees a new object identity and re-runs anything keyed on the session —
// which used to blow away `org`, render App's spinner branch, and unmount Coach
// mid-1:1. Comparing user ids instead of object identity makes a token refresh
// the no-op it should always have been.

/** The signed-in user's id, or null when signed out / not a real session. */
export function userIdOf(session: { user?: { id?: string } | null } | null | undefined): string | null {
  return session?.user?.id ?? null;
}

/**
 * Should the app rebuild everything keyed to the signed-in user?
 *
 * `prev === undefined` means we had not resolved anyone yet, so the first
 * answer always counts as a change — including the first "nobody is signed in".
 */
export function identityChanged(prev: string | null | undefined, next: string | null): boolean {
  if (prev === undefined) return true;
  return prev !== next;
}
