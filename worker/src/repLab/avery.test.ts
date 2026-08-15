import { describe, it, expect } from 'vitest';
import { gradeAvery } from './avery.js';

const ALL_FOUR = ['wrong_stage', 'weak_note', 'missing_task', 'ignored_activity'];

describe('gradeAvery — the diagnosis half', () => {
  it('passes only when all four planted faults are named', () => {
    const miss = gradeAvery({ phase: 'audit', risks: ['wrong_stage', 'weak_note'] });
    expect(miss.passed).toBe(false);
    expect(miss.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([
      'risk_missing_task',
      'risk_ignored_activity',
    ]);

    expect(gradeAvery({ phase: 'audit', risks: ALL_FOUR }).passed).toBe(true);
  });

  it('fails a learner who ticks every box instead of reading', () => {
    const sweep = gradeAvery({ phase: 'audit', risks: [...ALL_FOUR, 'no_owner', 'no_source'] });
    expect(sweep.passed).toBe(false);
    expect(sweep.checks.find((c) => c.id === 'overreach')?.pass).toBe(false);
  });

  it('fails one wrong tick even when all four real faults are named', () => {
    expect(gradeAvery({ phase: 'audit', risks: [...ALL_FOUR, 'no_source'] }).passed).toBe(false);
  });

  it('never returns the expected record or the planted note', () => {
    const dumped = JSON.stringify(gradeAvery({ phase: 'audit', risks: [] })).toLowerCase();
    expect(dumped).not.toContain('appointment set');
    expect(dumped).not.toContain('spoke with customer');
    expect(dumped).not.toContain('talked. interested.');
  });

  it('grades diagnosis no matter what else the browser sends', () => {
    const g = gradeAvery({ phase: 'repair', risks: ALL_FOUR, stage: 'Appointment set', note: 'anything' });
    expect(g.phase).toBe('audit');
    expect(g.passed).toBe(true);
  });
});
