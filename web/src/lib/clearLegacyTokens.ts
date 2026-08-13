// Erase what the old browser-token login left behind.
//
// Before the cookie cutover, supabase-js kept a live access + refresh token in
// localStorage under `sb-<project>-auth-token`, and acting-as-a-team kept the OWNER's
// token pair under `hq_admin_return`. Nothing reads either one now — the session lives
// on the server and the browser holds only an opaque cookie it cannot read.
//
// They are still worth deleting rather than leaving to rot. While one of these existed,
// Coach kept reading the database with it, which meant the app answered as whoever last
// signed in on that browser rather than the person actually signed in. That is fixed at
// the source, but a refresh token sitting in a shared or reused browser is a credential
// nobody is watching, and it renews itself for as long as it is left there.
//
// Matched by SHAPE, not by project id: the Supabase URL is deliberately no longer in
// this bundle, so there is nothing to build the exact key name from — and a hardcoded
// project ref here would be one more thing to get wrong.
export function clearLegacyTokens(): void {
  try {
    const doomed = Object.keys(localStorage).filter(
      (k) => (k.startsWith('sb-') && k.endsWith('-auth-token')) || k === 'hq_admin_return',
    );
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Private mode denies localStorage entirely. Nothing to clear, nothing to do.
  }
}
