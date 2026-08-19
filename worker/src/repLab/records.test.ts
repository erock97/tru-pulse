import { describe, expect, it } from 'vitest';
import { gradeRecord, SCENARIOS } from './records.js';

describe('practice record scenarios', () => {
  it('still grades the five Day 1 packs', () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining([
      'set-appointment', 'spoke-note', 'noanswer-task', 'avery-repair', 'offer-accepted',
    ]));
  });

  it('adds honest-stage and day-close only', () => {
    expect(SCENARIOS['honest-stage']).toMatchObject({
      requireNote: true, requireTask: true, requireDeal: false,
    });
    expect(SCENARIOS['day-close']).toMatchObject({
      requireNote: true, requireTask: true, requireDeal: false, requireStageSave: false,
    });
    expect(SCENARIOS['honest-stage'].stage).toContain('spoke with customer');
    expect(SCENARIOS['day-close'].stage).toContain('spoke with customer');
  });

  it('passes honest-stage on Spoke with customer + note + dated task, and fails Appointment set', () => {
    const pass = gradeRecord('honest-stage', {
      stage: 'Spoke with customer',
      stageSaved: true,
      note: 'Inherited. Nothing on the calendar. Sending two times tomorrow.',
      task: { title: 'Send two times', dueDate: '2026-08-20' },
    });
    expect(pass.passed).toBe(true);

    const lie = gradeRecord('honest-stage', {
      stage: 'Appointment set',
      stageSaved: true,
      note: 'Inherited. Nothing on the calendar. Sending two times tomorrow.',
      task: { title: 'Send two times', dueDate: '2026-08-20' },
    });
    expect(lie.passed).toBe(false);
    expect(lie.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
    expect(lie.checks.some((c) => c.id === 'deal')).toBe(false);
  });

  it('passes day-close when the stage stays Spoke with customer without a save, and fails Appointment set', () => {
    const pass = gradeRecord('day-close', {
      stage: 'Spoke with customer',
      stageSaved: false,
      note: 'Buying with sister. Olympia or Lacey, 3+ beds, before November. Wants weekend options. No time picked.',
      task: { title: 'Send two times', dueDate: '2026-08-21' },
    });
    expect(pass.passed).toBe(true);
    expect(pass.checks.some((c) => c.id === 'stage_saved')).toBe(false);

    const upgraded = gradeRecord('day-close', {
      stage: 'Appointment set',
      stageSaved: true,
      note: 'Buying with sister. Olympia or Lacey, 3+ beds, before November. Wants weekend options. No time picked.',
      task: { title: 'Send two times', dueDate: '2026-08-21' },
    });
    expect(upgraded.passed).toBe(false);
    expect(upgraded.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('does not require a deal on either new pack', () => {
    const honest = gradeRecord('honest-stage', {
      stage: 'Spoke with customer', stageSaved: true, note: 'n', task: { title: 't', dueDate: '2026-08-20' },
    });
    const close = gradeRecord('day-close', {
      stage: 'Spoke with customer', note: 'n', task: { title: 't', dueDate: '2026-08-20' },
    });
    expect(honest.checks.some((c) => c.id.startsWith('deal'))).toBe(false);
    expect(close.checks.some((c) => c.id.startsWith('deal'))).toBe(false);
  });
});
