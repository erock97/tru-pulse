// Did a person actually work this lead, and when?
//
// This is the one judgement the speed-to-lead agents rest on. Get it wrong in
// one direction and a lead gets taken off an agent who had already called;
// wrong in the other and a paid lead sits. It is a pure function on purpose —
// no fetching, no clock of its own — so it can be tested exhaustively and
// replayed over history by the backtest without touching anything.
//
// It used to be much harder. Both this repo and the puller had it recorded that
// a Follow Up Boss text carries only id / personId / isIncoming / created /
// message, which would have meant inferring "this was the automated one" from it
// landing within a couple of seconds — a guess, on a paying client's leads.
//
// The probe (GET /admin/probe-activity) showed that was wrong. FUB marks its own
// automation, so this is a lookup:
//
//   leadFlowRouteId  set on the instant auto-response, null on anything a person
//                    sent. Verified on two teams with different route ids
//                    (Costigan 8; Signature 47 and 59) over 149 texts — every
//                    flagged text landed within 2 seconds, every unflagged one at
//                    11 minutes or later. The split was absolute.
//   actionPlanId     0 throughout that sample but modelled, so an action-plan
//                    text is marked here rather than having to be timed.
//
// Timing is deliberately NOT used as a fallback. A rule that sometimes reads a
// field and sometimes guesses from the clock is two rules, and the one that
// fires is whichever the data happens to trigger — which is exactly the kind of
// thing nobody can reason about at 7am when a lead has moved.

/** Only the fields this judgement uses. FUB sends ~24; the rest are not our business. */
export interface FubTextLite {
  isIncoming?: boolean | null;
  created?: string | null;
  /** Set when FUB's lead-flow automation sent it. The discriminator. */
  leadFlowRouteId?: number | null;
  /** Set when an action plan sent it. */
  actionPlanId?: number | null;
}

export interface FubCallLite {
  created?: string | null;
  isIncoming?: boolean | null;
  duration?: number | null;
}

export type Confidence = 'high' | 'low';

export interface ContactVerdict {
  /** True means leave this lead alone. */
  contacted: boolean;
  /** When the first human contact happened, if it did. ISO, from FUB. */
  at: string | null;
  /** Seconds from the clock start to that contact. Null when never contacted. */
  afterSeconds: number | null;
  /** Plain enough to put in a run log a person reads. */
  reason: string;
  /**
   * 'low' means we could not actually see the evidence — a failed fetch, an
   * unusable timestamp. A low-confidence verdict is always `contacted: true`,
   * and callers must never let one drive an action even in full-auto.
   */
  confidence: Confidence;
}

/** FUB sends 0 for "no automation", not null, so both have to count as absent. */
const isSet = (v: number | null | undefined): boolean =>
  typeof v === 'number' && v !== 0;

/** A text FUB sent by itself. Never evidence that a person did anything. */
export function isAutomatedText(t: FubTextLite): boolean {
  return isSet(t.leadFlowRouteId) || isSet(t.actionPlanId);
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export interface ContactInput {
  /**
   * When the clock starts — the moment the lead landed with an agent, not the
   * moment it entered FUB. A lead sitting in a pond is nobody's to answer yet.
   */
  assignedAt: string | null;
  /** Null means the read FAILED. Empty array means it succeeded and found none. */
  calls: FubCallLite[] | null;
  texts: FubTextLite[] | null;
}

/**
 * The asymmetry this is built around: reassigning a lead an agent had already
 * worked breaks trust with a paying client's agent and is visible to them
 * immediately. Missing one costs a few minutes and nobody notices. So every
 * uncertainty resolves to `contacted: true` — do nothing.
 */
export function isHumanContact(input: ContactInput): ContactVerdict {
  const startedAt = ms(input.assignedAt);

  if (input.calls === null || input.texts === null) {
    return {
      contacted: true, at: null, afterSeconds: null, confidence: 'low',
      reason: 'could not read this lead’s activity',
    };
  }
  if (startedAt === null) {
    // Without a clock start there is no elapsed time, so no threshold can be
    // applied honestly. Refusing here is better than measuring from a guess.
    return {
      contacted: true, at: null, afterSeconds: null, confidence: 'low',
      reason: 'no reliable time for when the lead reached an agent',
    };
  }

  const after = (iso: string | null): number | null => {
    const t = ms(iso);
    return t === null ? null : Math.round((t - startedAt) / 1000);
  };

  // A call is effort regardless of direction, length or outcome. FUB's own
  // automation does not dial, and an agent who rang and got voicemail has done
  // the thing we are asking for. Same rule the daily accountability pull has
  // used across four teams since 2026-07-08.
  const firstCall = input.calls
    .map((c) => c.created ?? null)
    .filter((x): x is string => !!ms(x))
    .sort()[0] ?? null;

  // The lead wrote back, so a real conversation is underway whoever started it.
  const firstReply = input.texts
    .filter((t) => t.isIncoming === true)
    .map((t) => t.created ?? null)
    .filter((x): x is string => !!ms(x))
    .sort()[0] ?? null;

  // An outbound text FUB did not send itself.
  const firstHumanText = input.texts
    .filter((t) => t.isIncoming !== true && !isAutomatedText(t))
    .map((t) => t.created ?? null)
    .filter((x): x is string => !!ms(x))
    .sort()[0] ?? null;

  const candidates: Array<{ at: string; why: string }> = [
    firstCall ? { at: firstCall, why: 'a call' } : null,
    firstReply ? { at: firstReply, why: 'the lead replied' } : null,
    firstHumanText ? { at: firstHumanText, why: 'a text from their agent' } : null,
  ].filter((x): x is { at: string; why: string } => x !== null);

  if (candidates.length === 0) {
    const autoOnly = input.texts.some((t) => t.isIncoming !== true && isAutomatedText(t));
    return {
      contacted: false, at: null, afterSeconds: null, confidence: 'high',
      reason: autoOnly ? 'only the automatic first text' : 'no call and no text',
    };
  }

  candidates.sort((a, b) => (ms(a.at) ?? 0) - (ms(b.at) ?? 0));
  const first = candidates[0];
  return {
    contacted: true,
    at: first.at,
    afterSeconds: after(first.at),
    reason: first.why,
    confidence: 'high',
  };
}

/**
 * Has this lead been sitting long enough to act on?
 *
 * A window rather than an instant, because the runner is a cron and a tick can
 * be missed. Re-offering the same lead on the next fourteen ticks is what makes
 * a stalled minute harmless; the run claim is what stops that becoming fourteen
 * texts. An instant would need the cron to be perfect, and it isn't.
 */
export function isDue(
  assignedAt: string | null,
  now: number,
  window: { fromSeconds: number; toSeconds: number },
): boolean {
  const t = ms(assignedAt);
  if (t === null) return false;
  const age = (now - t) / 1000;
  return age >= window.fromSeconds && age < window.toSeconds;
}

/** Warn the agent at ten minutes; hand the lead on at thirty. */
export const NUDGE_WINDOW = { fromSeconds: 10 * 60, toSeconds: 25 * 60 };
export const REASSIGN_WINDOW = { fromSeconds: 30 * 60, toSeconds: 45 * 60 };
