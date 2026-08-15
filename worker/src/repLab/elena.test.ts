import { describe, it, expect } from 'vitest';
import { gradeElena } from './elena.js';

const ok = {
  phase: 'repair' as const,
  contactName: 'Elena Brooks — L03',
  stage: 'Spoke with customer',
  channel: 'phone',
  note: '4:46 PM — Reached Elena. Buying with sister; wants Olympia or Lacey, needs 3+ bedrooms, hopes to move before November. Asked for a side-by-side of 908 and 875 Alder Creek by Monday morning. Repeat views are context, not proof.',
  task: { title: 'Send Elena Alder Creek two-home summary', owner: 'learner', due: 'Mon Aug 17, 2026 at 9:30 AM PT' },
};

describe('gradeElena', () => {
  it('passes a complete record at 8 or better', () => {
    const g = gradeElena(ok);
    expect(g.critical).toBe(false);
    expect(g.score ?? 0).toBeGreaterThanOrEqual(8);
    expect(g.passed).toBe(true);
  });

  it('fails Appointment Set as critical even with a strong note', () => {
    const g = gradeElena({ ...ok, stage: 'Appointment set' });
    expect(g.passed).toBe(false);
    expect(g.critical).toBe(true);
  });

  it('fails the wrong contact as critical', () => {
    const g = gradeElena({ ...ok, contactName: 'Avery Morgan' });
    expect(g.passed).toBe(false);
    expect(g.critical).toBe(true);
  });
});
