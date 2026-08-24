// The fixtures here are shaped from real records the probe pulled off Costigan
// and Signature, not invented ones — including the exact leadFlowRouteId values
// those two teams use, because a rule that only works against made-up data is
// not evidence of anything.
import { describe, it, expect } from 'vitest';
import {
  isAutomatedText, isHumanContact, isDue, NUDGE_WINDOW, REASSIGN_WINDOW,
  type FubTextLite,
} from './contact.js';

const ASSIGNED = '2026-08-24T20:00:00Z';
const at = (secondsAfter: number) =>
  new Date(Date.parse(ASSIGNED) + secondsAfter * 1000).toISOString();

/** FUB's instant auto-response. Costigan's route is 8; Signature uses 47 and 59. */
const autoText = (routeId = 8, secondsAfter = 2): FubTextLite =>
  ({ isIncoming: false, created: at(secondsAfter), leadFlowRouteId: routeId, actionPlanId: 0 });

/** A text a person actually sent. No route id, and FUB sends 0 rather than null. */
const humanText = (secondsAfter: number): FubTextLite =>
  ({ isIncoming: false, created: at(secondsAfter), leadFlowRouteId: null, actionPlanId: 0 });

describe('telling FUB’s own text apart from a person’s', () => {
  it('recognises the auto-response on both teams’ route ids', () => {
    for (const route of [8, 47, 59]) expect(isAutomatedText(autoText(route))).toBe(true);
  });

  it('treats an action-plan text as automated too', () => {
    expect(isAutomatedText({ isIncoming: false, actionPlanId: 12, leadFlowRouteId: null })).toBe(true);
  });

  it('reads FUB’s 0 as "no automation", not as an id', () => {
    // This is the whole trap in the field: FUB sends 0 for absent, and 0 is a
    // number, so a naive truthiness check gets it right by accident and a
    // != null check gets it wrong every single time.
    expect(isAutomatedText({ leadFlowRouteId: 0, actionPlanId: 0 })).toBe(false);
    expect(isAutomatedText({ leadFlowRouteId: null, actionPlanId: null })).toBe(false);
    expect(isAutomatedText({})).toBe(false);
  });
});

describe('the automatic first text is not contact', () => {
  it('does not count it, however fast it arrived', () => {
    const v = isHumanContact({ assignedAt: ASSIGNED, calls: [], texts: [autoText()] });
    expect(v.contacted).toBe(false);
    expect(v.reason).toBe('only the automatic first text');
    expect(v.confidence).toBe('high');
  });

  it('says so differently when there was no text at all', () => {
    const v = isHumanContact({ assignedAt: ASSIGNED, calls: [], texts: [] });
    expect(v.contacted).toBe(false);
    expect(v.reason).toBe('no call and no text');
  });

  it('counts the agent’s own text that followed it', () => {
    // The real Costigan shape: auto-response at 2s, agent's own at 144s.
    const v = isHumanContact({
      assignedAt: ASSIGNED, calls: [], texts: [autoText(8, 2), humanText(144)],
    });
    expect(v.contacted).toBe(true);
    expect(v.afterSeconds).toBe(144);
    expect(v.reason).toBe('a text from their agent');
  });
});

describe('what counts as a person working the lead', () => {
  it('counts a call of any direction, length or outcome', () => {
    // FUB's automation does not dial, and an agent who rang and got voicemail
    // has done the thing we are asking for.
    for (const call of [
      { created: at(300), isIncoming: false, duration: 0 },
      { created: at(300), isIncoming: true, duration: 390 },
      { created: at(300), duration: null },
    ]) {
      const v = isHumanContact({ assignedAt: ASSIGNED, calls: [call], texts: [autoText()] });
      expect(v.contacted).toBe(true);
      expect(v.reason).toBe('a call');
    }
  });

  it('counts the lead writing back, whoever started it', () => {
    const v = isHumanContact({
      assignedAt: ASSIGNED, calls: [],
      texts: [autoText(8, 2), { isIncoming: true, created: at(90) }],
    });
    expect(v.contacted).toBe(true);
    expect(v.reason).toBe('the lead replied');
  });

  it('reports the EARLIEST contact, not the first one it happened to check', () => {
    const v = isHumanContact({
      assignedAt: ASSIGNED,
      calls: [{ created: at(600) }],
      texts: [autoText(8, 2), humanText(120)],
    });
    expect(v.afterSeconds).toBe(120);
    expect(v.reason).toBe('a text from their agent');
  });
});

describe('everything uncertain means do nothing', () => {
  // Reassigning a lead an agent had already worked breaks trust with a paying
  // client's agent and they see it immediately. Missing one costs a few minutes
  // and nobody notices. Every unknown resolves to "leave it alone".

  it('treats a failed activity read as contacted, and says it is not sure', () => {
    for (const bad of [
      { calls: null, texts: [] },
      { calls: [], texts: null },
      { calls: null, texts: null },
    ]) {
      const v = isHumanContact({ assignedAt: ASSIGNED, ...bad });
      expect(v.contacted).toBe(true);
      expect(v.confidence).toBe('low');
    }
  });

  it('refuses to measure from a timestamp it cannot read', () => {
    for (const bad of [null, '', 'not a date']) {
      const v = isHumanContact({ assignedAt: bad, calls: [], texts: [] });
      expect(v.contacted).toBe(true);
      expect(v.confidence).toBe('low');
    }
  });

  it('never returns low confidence together with "go ahead"', () => {
    // The invariant a caller depends on: it is safe to gate every action on
    // `!contacted`, because low confidence can never appear there.
    const cases = [
      { assignedAt: ASSIGNED, calls: null, texts: null },
      { assignedAt: null, calls: [], texts: [] },
      { assignedAt: ASSIGNED, calls: [], texts: [autoText()] },
      { assignedAt: ASSIGNED, calls: [], texts: [humanText(60)] },
    ];
    for (const c of cases) {
      const v = isHumanContact(c);
      if (v.confidence === 'low') expect(v.contacted).toBe(true);
    }
  });

  it('ignores a text whose own timestamp is unusable rather than crediting it', () => {
    const v = isHumanContact({
      assignedAt: ASSIGNED, calls: [],
      texts: [{ isIncoming: false, created: 'garbage', leadFlowRouteId: null }],
    });
    expect(v.contacted).toBe(false);
  });
});

describe('when a lead is due', () => {
  const now = Date.parse(ASSIGNED);
  const minsOld = (m: number) => now + m * 60_000;

  it('warns from ten minutes and hands off from thirty', () => {
    expect(isDue(ASSIGNED, minsOld(9), NUDGE_WINDOW)).toBe(false);
    expect(isDue(ASSIGNED, minsOld(10), NUDGE_WINDOW)).toBe(true);
    expect(isDue(ASSIGNED, minsOld(29), REASSIGN_WINDOW)).toBe(false);
    expect(isDue(ASSIGNED, minsOld(30), REASSIGN_WINDOW)).toBe(true);
  });

  it('stays due across many ticks, so one missed minute costs nothing', () => {
    // The window is what makes a stalled cron harmless: the same lead is
    // re-offered on every tick inside it. The run claim is what stops that
    // becoming fifteen texts.
    const due = [];
    for (let m = 0; m < 40; m++) if (isDue(ASSIGNED, minsOld(m), NUDGE_WINDOW)) due.push(m);
    expect(due[0]).toBe(10);
    expect(due[due.length - 1]).toBe(24);
    expect(due).toHaveLength(15);
  });

  it('is never due without a usable clock start', () => {
    for (const bad of [null, '', 'nope']) {
      expect(isDue(bad, minsOld(60), NUDGE_WINDOW)).toBe(false);
    }
  });
});

describe('replaying the real probe sample', () => {
  // Eleven leads with a human text, from Costigan and Signature. The point is
  // that the automated ones are excluded by their route id alone — no timing
  // rule anywhere — and the surviving times match what a person would call
  // "when the agent actually got to it".
  const sample: Array<{ auto: boolean; firstSec: number; humanSec: number | null }> = [
    { auto: true, firstSec: 2, humanSec: 144 },
    { auto: false, firstSec: 83, humanSec: 83 },
    { auto: true, firstSec: 1, humanSec: 65 },
    { auto: true, firstSec: 2, humanSec: 466 },
    { auto: false, firstSec: 6438, humanSec: 6438 },
    { auto: false, firstSec: 664, humanSec: 664 },
    { auto: true, firstSec: 1, humanSec: 3694 },
    { auto: true, firstSec: 1, humanSec: 1498 },
    { auto: false, firstSec: 863, humanSec: 863 },
    { auto: true, firstSec: 1, humanSec: 588 },
    { auto: true, firstSec: 2, humanSec: null },
  ];

  it('never mistakes the auto-response for the agent', () => {
    for (const s of sample) {
      const texts = [
        s.auto ? autoText(47, s.firstSec) : humanText(s.firstSec),
        ...(s.auto && s.humanSec !== null ? [humanText(s.humanSec)] : []),
      ];
      const v = isHumanContact({ assignedAt: ASSIGNED, calls: [], texts });
      const expected = s.auto ? s.humanSec : s.firstSec;
      expect(v.contacted).toBe(expected !== null);
      expect(v.afterSeconds).toBe(expected);
    }
  });

  it('would have left alone every lead worked inside ten minutes', () => {
    const worked = sample
      .map((s) => (s.auto ? s.humanSec : s.firstSec))
      .filter((x): x is number => x !== null);
    const insideTen = worked.filter((x) => x < NUDGE_WINDOW.fromSeconds);
    expect(insideTen.length).toBeGreaterThan(0);
    for (const secs of insideTen) {
      expect(isDue(ASSIGNED, Date.parse(ASSIGNED) + secs * 1000, NUDGE_WINDOW)).toBe(false);
    }
  });
});
