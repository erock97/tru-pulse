import { describe, it, expect, vi } from 'vitest';
import { redeemLink } from './redeemLink';

describe('redeemLink', () => {
  it('ends the current session BEFORE redeeming the link', async () => {
    // The regression this file exists for. Without the sign-out, an invite opened
    // on a laptop where the team leader is signed in can leave the leader's
    // session in place — and the set-password screen then writes to the leader's
    // account. Observed on the first real invite in production.
    const order: string[] = [];
    const out = await redeemLink(
      async () => { order.push('signOut'); },
      async () => { order.push('exchange'); },
    );
    expect(order).toEqual(['signOut', 'exchange']);
    expect(out).toBe(true);
  });

  it('still redeems when signing out fails', async () => {
    // No session to end, or the sign-out call itself failed. Neither is a reason
    // to refuse a valid invite.
    const exchange = vi.fn(async () => {});
    const out = await redeemLink(async () => { throw new Error('no session'); }, exchange);
    expect(exchange).toHaveBeenCalled();
    expect(out).toBe(true);
  });

  it('reports failure rather than falling through', async () => {
    // An expired or already-used link. The caller must show the sign-in screen
    // with a reason — never carry on into whatever was on screen before, which
    // is precisely how someone ends up inside another person's account.
    const out = await redeemLink(async () => {}, async () => { throw new Error('expired'); });
    expect(out).toBe(false);
  });

  it('leaves the session ended when the exchange fails', async () => {
    // Being signed out after a bad link is the correct resting place. This asserts
    // the sign-out is not conditional on the exchange succeeding.
    const signOut = vi.fn(async () => {});
    await redeemLink(signOut, async () => { throw new Error('expired'); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
