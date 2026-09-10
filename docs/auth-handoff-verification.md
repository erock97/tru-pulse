# Invitation and reset handoff

The cookie-auth app consumes `#token_hash=...&type=invite|recovery` through
`/auth/exchange`. Sending Supabase's `action_link` instead consumes the token
before the app loads and returns implicit-flow access tokens. The app shows its
password screen but cannot resolve `linkEmail`, so Continue is disabled.

`mintAuthLink` now uses `hashed_token` to build the application fragment for both
invites and recovery. `APP_ORIGIN` selects the destination for local testing;
production defaults to `https://app.truhq.co`. Old issued links are not repaired.

## Automated verification

Run from worker/: `node node_modules/vitest/vitest.mjs run src` and
`node node_modules/typescript/bin/tsc --noEmit`.

The new link-generator tests fail against the old implementation for invite and
recovery. The handler integration tests follow each generated link through
exchange, authenticated identity, password save, logout, and fresh sign-in.
They assert that the old password and replayed links fail. Supabase and email
delivery are simulated at the outbound fetch boundary in these tests.

## Live acceptance before sending a client another link

Use a dedicated mock login with no customer memberships. Run the patched worker
locally with real Supabase credentials, a separate session store, and email
delivery captured locally. Point a build of the real web app at that worker.

1. Generate a new invitation. Open it in a signed-out browser. Verify the locked
   email matches the mock login and Continue is enabled. Set a password.
2. Sign out and sign in with that password.
3. Sign out, enter the mock email, and select Forgot password. Open the captured
   recovery link, set a different password, and sign out again.
4. Confirm the old password fails and the replacement works. Confirm reopening
   either used link displays a link error.

The local test panel and real-service runner prepared for this task remain
outside the repository because they use the operator's local configuration.
Live service verification passed on September 10, 2026 using an explicitly
authorized credential held in the local server memory. Both new invitation and
recovery established the correct session, saved a password, and allowed a fresh
login. The previous password and replayed links were rejected. Browser checks
confirmed both link types show the correct mock email and enabled Continue.
Full browser acceptance also passed: initial password form submission, fresh sign-in, Forgot password, recovery form submission, old-password rejection, and replacement-password sign-in. No operator acceptance step remains.
No production deployment or client email occurred.