import { describe, it, expect, vi } from 'vitest';
import { resolveSmsStep } from './smsStep';
import type { AgentSms } from './api';

const fresh: AgentSms = {
  last_four: '', has_phone: false, consent_at: null,
  opt_out_at: null, prompted_at: null, reachable: false,
};

describe('resolveSmsStep', () => {
  it('claims the agent row BEFORE reading the SMS state', async () => {
    // The regression this file exists for. Shipped once the other way round: the
    // read ran while agents.auth_id was still null, the database correctly
    // answered "no such agent", and every invited agent silently skipped the
    // consent question with nothing recorded to show it.
    const order: string[] = [];
    const claim = vi.fn(async () => { order.push('claim'); });
    const read = vi.fn(async () => { order.push('read'); return fresh; });

    await resolveSmsStep(claim, read);

    expect(order).toEqual(['claim', 'read']);
  });

  it('returns the state for an agent who has never been asked', async () => {
    expect(await resolveSmsStep(async () => {}, async () => fresh)).toEqual(fresh);
  });

  it('skips someone already asked, whatever they answered', async () => {
    const asked = { ...fresh, prompted_at: '2026-08-25T00:00:00Z' };
    expect(await resolveSmsStep(async () => {}, async () => asked)).toBeNull();
  });

  it('skips anyone who is not an agent', async () => {
    // A leader or admin resetting their password. Null is the honest answer, not
    // an error — they have nothing to opt into.
    expect(await resolveSmsStep(async () => {}, async () => null)).toBeNull();
  });

  it('still reads the state when the claim throws', async () => {
    // An already-linked agent re-using a reset link: claim_agent has nothing left
    // to do and may fail. That must not cost them the question.
    const read = vi.fn(async () => fresh);
    const out = await resolveSmsStep(async () => { throw new Error('already claimed'); }, read);
    expect(read).toHaveBeenCalled();
    expect(out).toEqual(fresh);
  });

  it('never blocks account creation when the read fails', async () => {
    const out = await resolveSmsStep(async () => {}, async () => { throw new Error('offline'); });
    expect(out).toBeNull();
  });
});
