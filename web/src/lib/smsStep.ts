import type { AgentSms } from './api';

/**
 * Should account creation ask this person about text messages, and with what?
 *
 * Extracted from SetPassword so the ORDER can be tested. It shipped once with
 * these two calls the other way round and the consequence was invisible: an
 * invite creates the auth user, but `agents.auth_id` is only set by
 * claim_agent(), which App runs later in its own effect. Read the SMS state
 * before that and the database looks up auth.uid(), finds no agent row, and
 * truthfully answers null — which reads as "not an agent" and skips the step.
 *
 * Every invited agent silently missed the consent question, and because a skip
 * writes nothing, there was no trace afterwards that it had happened. The only
 * symptom was an empty ledger, which looks identical to nobody having opted in.
 *
 * Returns the state to show the step with, or null to move straight into the
 * product. Null covers every case that is not "an agent we have not yet asked":
 * a leader or admin resetting their password, a dead network, an environment
 * without the migration. None of those are reasons to hold someone out of the
 * product they just made an account for — the card on Agent HQ's Home tab
 * catches anyone this skips.
 */
export async function resolveSmsStep(
  claim: () => Promise<unknown>,
  read: () => Promise<AgentSms | null>,
): Promise<AgentSms | null> {
  // Claim first. Always. See above.
  await claim().catch(() => undefined);
  const state = await read().catch(() => null);
  if (!state) return null;
  // Asked once, whatever they answered. A prompt that returns until you say yes
  // is not consent, it is a toll.
  if (state.prompted_at) return null;
  return state;
}
