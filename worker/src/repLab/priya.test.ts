import { describe, it, expect } from 'vitest';
import { gradePriya } from './priya.js';

const repairOk = {
  phase: 'repair' as const,
  contactName: 'Priya Shah — L03',
  stage: 'Spoke with customer',
  note: 'Tue 8/11 at 7:41 PM — Reached Priya. Comparing Puyallup homes with spouse; needs at least 3 bedrooms. Requested a Thu morning comparison of 406 and 422 Juniper Ln. Repeat views are context, not proof. Next: send the two-home comparison by 10:00 AM Thu 8/13.',
  task: { title: 'Send Priya Juniper Ln comparison', owner: 'learner', due: 'Thu Aug 13, 2026 at 10:00 AM PT' },
};

describe('gradePriya', () => {
  it('passes audit only when all four planted risks are named', () => {
    const miss = gradePriya({ phase: 'audit', contactName: 'Priya Shah', risks: ['wrong_stage', 'weak_note'] });
    expect(miss.passed).toBe(false);
    expect(miss.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([
      'risk_missing_task',
      'risk_ignored_activity',
    ]);

    const ok = gradePriya({
      phase: 'audit',
      contactName: 'Priya Shah',
      risks: ['wrong_stage', 'weak_note', 'missing_task', 'ignored_activity'],
    });
    expect(ok.passed).toBe(true);
  });

  it('passes a complete repair and fails Appointment Set as a critical miss', () => {
    expect(gradePriya(repairOk).passed).toBe(true);
    const bad = gradePriya({ ...repairOk, stage: 'Appointment set' });
    expect(bad.passed).toBe(false);
    expect(bad.critical).toBe(true);
    expect(bad.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('fails invented intent and never returns the expected record', () => {
    const bad = gradePriya({
      ...repairOk,
      note: repairOk.note + ' Activity proves she is ready to buy.',
    });
    expect(bad.passed).toBe(false);
    expect(bad.checks.find((c) => c.id === 'note_excludes_claims')?.pass).toBe(false);
    const dumped = JSON.stringify(bad);
    expect(dumped.toLowerCase()).not.toContain('appointment set');
    expect(dumped).not.toContain('Talked. Interested.');
  });

  it('fails the wrong contact as critical', () => {
    const bad = gradePriya({ ...repairOk, contactName: 'Maya Torres — L03' });
    expect(bad.passed).toBe(false);
    expect(bad.critical).toBe(true);
  });
});
