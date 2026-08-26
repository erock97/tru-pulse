/**
 * Redeem an invite or password-reset link.
 *
 * Extracted from App so the ORDER can be tested, because the order is the whole
 * point and the sign-out looks like a redundant call.
 *
 * Clicking one of these links is a claim about who you are, and it routinely
 * lands in a browser already signed in as somebody else — an agent opening their
 * invite on a laptop where their team leader is logged in.
 *
 * The first release exchanged the token without ending that session, and
 * swallowed any failure. So when the token verified but the session failed to
 * establish, the app carried on with the LEADER's session: the set-password
 * screen showed the leader's address and set the password on the leader's
 * account. It happened on the very first real invite.
 *
 * Signing out first collapses that into a safe failure. The worst case becomes
 * "the link did not work and you are signed out" — recoverable and obvious —
 * instead of "you silently changed someone else's password".
 *
 * Returns whether the link was redeemed. `false` means the caller must show the
 * sign-in screen with an explanation, NOT fall through to whatever was on screen
 * before.
 */
export async function redeemLink(
  endCurrentSession: () => Promise<unknown>,
  exchange: () => Promise<unknown>,
): Promise<boolean> {
  // Always first. A failure to sign out must not stop us trying — but it also
  // must not let the exchange be skipped.
  await endCurrentSession().catch(() => undefined);
  try {
    await exchange();
    return true;
  } catch {
    return false;
  }
}
