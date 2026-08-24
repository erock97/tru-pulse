export type Stage = 'welcome' | 'assessment' | 'app';

/**
 * Where a signed-in agent belongs right now.
 *
 * `isNewAccount` is what keeps this from ambushing the people already using the
 * product: it comes from `agents.gated`, set true only when a FIRST invite is
 * minted from the cutover forward. Every row that existed before stays false and
 * lands straight in the app, exactly as it does today.
 *
 * A stored assessment satisfies the gate no matter which entrance produced it —
 * someone who took it through the old public link must never be sent through it
 * again.
 *
 * Text-message consent is deliberately NOT a stage here. It is asked once during
 * account creation (see SetPassword.tsx) and is available forever after from the
 * card on Home. Two places to be asked would mean two chances to be nagged, and
 * the campaign registration we file with the carrier says consent is collected at
 * account creation — so that had better be the only place it happens.
 */
export function agentStage(i: {
  hasAssessment: boolean; welcomeSeen: boolean; isNewAccount: boolean;
}): Stage {
  if (i.hasAssessment) return 'app';
  if (!i.isNewAccount) return 'app';
  return i.welcomeSeen ? 'assessment' : 'welcome';
}
