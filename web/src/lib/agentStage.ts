export type Stage = 'welcome' | 'assessment' | 'sms' | 'app';

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
 * ── The SMS step is not a gate ───────────────────────────────────────────────
 *
 * Everything above this line is a gate: you cannot reach the product without
 * clearing it. `sms` is different and must stay different. Consent to be texted
 * has to be freely given, and a screen you cannot get past without agreeing is
 * not freely given — it is a toll. So the step appears once, offers a real "not
 * now", and `smsAsked` goes true either way. Asking again later is the Home
 * screen's job, not this function's.
 *
 * `smsAsked` undefined or null means the SMS feature does not exist yet in this
 * deployment (db/hq_sms_consent.sql has not been run). The step is skipped
 * entirely rather than shown against a save path that would fail.
 */
export function agentStage(i: {
  hasAssessment: boolean;
  welcomeSeen: boolean;
  isNewAccount: boolean;
  smsAsked?: boolean | null;
}): Stage {
  if (!i.isNewAccount) return 'app';
  if (!i.hasAssessment) return i.welcomeSeen ? 'assessment' : 'welcome';
  if (i.smsAsked === false) return 'sms';
  return 'app';
}
