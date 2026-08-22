import { describe, expect, it } from 'vitest';

import { CADENCE_DAYS, cadenceEdge, cadenceMark, pastCadence, trackMark } from './deckMarks';

const coachAgent = (name: string, lastDays: number) => ({ id: name, name, lastDays });
const repAgent = (name: string, invited: boolean) => ({ id: name, name, invited });

describe('Coach — the cadence scale', () => {
  it('puts a person at the number of days since their 1:1', () => {
    const m = cadenceMark(coachAgent('Dana Cole', 9), 40);
    expect(m.value).toBe(9);
    expect(m.reading).toBe('9d');
  });

  it('pins never-met to the edge rather than to 99 days', () => {
    // The sentinel is 99. Read as a value it would land INSIDE somebody last
    // seen 120 days ago, which says the wrong thing about both of them.
    const edge = 40;
    const never = cadenceMark(coachAgent('Maria Lopez', 99), edge);
    expect(never.value).toBe(edge);
    expect(never.reading).toBe('never');
  });

  it('reads never as the worst state, not as a middling one', () => {
    expect(cadenceMark(coachAgent('Maria Lopez', 99), 40).tone).toBe('bad');
  });

  it('turns amber at the cadence line and ember at a month', () => {
    expect(cadenceMark(coachAgent('A', CADENCE_DAYS - 1), 40).tone).toBe('ok');
    expect(cadenceMark(coachAgent('B', CADENCE_DAYS), 40).tone).toBe('warn');
    expect(cadenceMark(coachAgent('C', 30), 40).tone).toBe('bad');
  });

  it('sizes the axis past the cadence line and past everybody real', () => {
    expect(cadenceEdge([{ lastDays: 3 }, { lastDays: 8 }])).toBe(CADENCE_DAYS + 6);
    expect(cadenceEdge([{ lastDays: 3 }, { lastDays: 42 }])).toBe(46);
  });

  it('does not let the never sentinel stretch the axis to 99', () => {
    expect(cadenceEdge([{ lastDays: 12 }, { lastDays: 99 }])).toBe(CADENCE_DAYS + 6);
  });
});

describe('Coach — asking for a tighter cadence', () => {
  // The leader can drag the cadence marker, so the tones have to be judged
  // against the cadence in force rather than against the default.
  it('re-tones everybody when the cadence is tightened', () => {
    const a = coachAgent('Dana Cole', 9);
    expect(cadenceMark(a, 40, 14).tone).toBe('ok');    // inside a fortnight
    expect(cadenceMark(a, 40, 7).tone).toBe('warn');   // past a week
    expect(cadenceMark(a, 40, 4).tone).toBe('bad');    // more than double it
  });

  it('still treats never as the worst state at any cadence', () => {
    expect(cadenceMark(coachAgent('Maria Lopez', 99), 40, 4).tone).toBe('bad');
    expect(cadenceMark(coachAgent('Maria Lopez', 99), 40, 60).tone).toBe('bad');
  });

  it('falls back to the standing cadence when none is given', () => {
    expect(cadenceMark(coachAgent('A', CADENCE_DAYS), 40).tone)
      .toBe(cadenceMark(coachAgent('A', CADENCE_DAYS), 40, CADENCE_DAYS).tone);
  });

  it('counts who is past the cadence being asked about', () => {
    const cohort = [coachAgent('A', 3), coachAgent('B', 9), coachAgent('C', 21), coachAgent('D', 99)];
    expect(pastCadence(cohort, 14)).toBe(2);   // C and never-met D
    expect(pastCadence(cohort, 7)).toBe(3);    // B joins them
    expect(pastCadence(cohort, 30)).toBe(1);   // only never-met D
  });

  it('does not let a tightened cadence rescale the axis', () => {
    // The axis is anchored on the DEFAULT so the marker cannot slide out from
    // under the cursor as it is dragged.
    const cohort = [{ lastDays: 3 }, { lastDays: 8 }];
    expect(cadenceEdge(cohort)).toBe(CADENCE_DAYS + 6);
  });
});

describe('Rep — the certification track', () => {
  it('places an agent at the modules they have actually cleared', () => {
    const m = trackMark(repAgent('Trevor Holland', true), 2, 4);
    expect(m.value).toBe(2);
    expect(m.reading).toBe('2 of 4');
    expect(m.tone).toBe('warn');
  });

  it('calls a full sweep certified, in the good tone', () => {
    const m = trackMark(repAgent('Dana Cole', true), 4, 4);
    expect(m.reading).toBe('certified');
    expect(m.tone).toBe('ok');
  });

  it('separates never-invited from stalled, though both sit at zero', () => {
    const stalled = trackMark(repAgent('Priya Nair', true), 0, 4);
    const noLogin = trackMark(repAgent('Sam Whitfield', false), 0, 4);

    expect(stalled.value).toBe(noLogin.value);   // same place on the axis
    expect(stalled.tone).toBe('bad');            // has begun and cleared nothing
    expect(noLogin.tone).toBe('none');           // was never able to begin
    expect(noLogin.reading).toBe('no login yet');
  });

  it('never reports someone with no login as having cleared anything', () => {
    // Progress rows can exist for an agent whose invite was later revoked.
    expect(trackMark(repAgent('Sam Whitfield', false), 3, 4).value).toBe(0);
  });

  it('does not call an empty programme certified', () => {
    const m = trackMark(repAgent('Jordan Blake', true), 0, 0);
    expect(m.reading).not.toBe('certified');
    expect(m.tone).toBe('bad');
  });
});
