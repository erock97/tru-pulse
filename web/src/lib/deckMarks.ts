/**
 * Placing a person on their page's scale.
 *
 * Pulse already had this: one dot per agent on one axis, with the line you
 * judge them against marked on it. Coach and Rep were carrying captions that
 * described a picture — "rings are 7, 14 and 30 days", "every dot is an agent,
 * every mark a module" — over an empty card, because the artwork those
 * sentences belonged to was cut and the words outlived it.
 *
 * They get the SAME instrument rather than a second and third kind of chart.
 * The gesture is identical on all three pages; only the unit changes:
 *
 *   Pulse  a rate      leads per contract, against your line
 *   Coach  elapsed     days since a 1:1, against your cadence
 *   Rep    a position  modules cleared, against the full programme
 *
 * These two functions are here rather than inline in the pages because each
 * encodes a distinction that is easy to lose and expensive to lose, and both
 * are worth a test.
 */

import type { ScaleMark } from '../components/scaleMarks';

/** Days after which a leader is drifting, and the line Coach marks. */
export const CADENCE_DAYS = 14;

type CheckinHistory = { lastDays: number; hasRecordedCheckin?: boolean };

/** Missing history has no measured position and must not be treated as overdue. */
export function cadenceMark(
  agent: CheckinHistory & { id: string; name: string },
  _edge: number,
  /** The cadence in force. A leader can move it on the page to ask what a
   *  tighter one would mean, so it cannot be read off the constant. */
  cadence: number = CADENCE_DAYS,
): ScaleMark {
  const recorded = agent.hasRecordedCheckin === true;
  return {
    key: agent.id,
    value: recorded ? agent.lastDays : null,
    label: agent.name,
    reading: recorded ? `${agent.lastDays}d` : 'No recorded 1:1',
    tone: !recorded ? 'none' : agent.lastDays >= cadence * 2 ? 'bad'
      : agent.lastDays >= cadence ? 'warn'
        : 'ok',
  };
}

/** Only recorded check-ins can be compared with the cadence. */
export function pastCadence(
  agents: readonly CheckinHistory[],
  cadence: number,
): number {
  return agents.filter((a) => a.hasRecordedCheckin === true && a.lastDays >= cadence).length;
}

/** The far end of Coach's axis: past the cadence line, and past everybody real.
 *  Anchored on the DEFAULT cadence rather than the live one — an axis that
 *  rescaled while you dragged the marker would slide it out from under the
 *  cursor and the control would feel like it was resisting you. */
export function cadenceEdge(agents: readonly CheckinHistory[]): number {
  const real = agents.filter(a => a.hasRecordedCheckin === true).map(a => a.lastDays);
  return Math.max(CADENCE_DAYS + 6, ...real.map((d) => d + 4));
}

/**
 * Rep — a person on the certification track.
 *
 * NEVER SENT A LOGIN IS NOT STALLED. They sit at zero like someone who has
 * started and cleared nothing, and the two look identical on the axis — so the
 * TONE is what separates them: the room's "no data" grey rather than the
 * "this is bad" ember. They have not failed to begin; they were never able to,
 * which is a different problem with a different fix, and averaging the two
 * together is exactly how that distinction gets lost.
 */
export function trackMark(
  agent: { id: string; name: string; invited: boolean },
  passed: number,
  modules: number,
): ScaleMark {
  return {
    key: agent.id,
    value: agent.invited ? passed : 0,
    label: agent.name,
    reading: !agent.invited ? 'no login yet'
      : modules > 0 && passed === modules ? 'all quizzes passed'
        : `${passed} of ${modules}`,
    tone: !agent.invited ? 'none'
      : modules > 0 && passed === modules ? 'ok'
        : passed === 0 ? 'bad'
          : 'warn',
  };
}
