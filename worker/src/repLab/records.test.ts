import { describe, it, expect } from 'vitest';
import { gradeRecord, SCENARIOS } from './records.js';

const full = {
  stage: 'Appointment Set',
  stageSaved: true,
  note: 'EG — Spoke with Avery and confirmed Saturday at 11:00 AM. Next: send confirmation.',
  task: { title: 'EG confirm the appointment with Avery', owner: 'me', dueDate: '2026-08-21', dueTime: '09:00' },
};

describe('gradeRecord', () => {
  it('passes a complete appointment record', () => {
    const g = gradeRecord('avery-appointment', full);
    expect(g.passed).toBe(true);
    expect(g.score).toBe(g.max);
  });

  it('fails when the stage was chosen but never saved', () => {
    const g = gradeRecord('avery-appointment', { ...full, stageSaved: false });
    expect(g.passed).toBe(false);
    expect(g.checks.find((c) => c.id === 'stage_saved')?.pass).toBe(false);
  });

  it('never reveals the expected stage in the failure message', () => {
    const g = gradeRecord('avery-appointment', { ...full, stage: 'Lead' });
    const msg = g.checks.find((c) => c.id === 'stage')!.message.toLowerCase();
    expect(msg).not.toContain('appointment set');
  });

  it('rejects promoting a brand-new record past Lead', () => {
    const g = gradeRecord('avery-new', {
      stage: 'Spoke with Customer', stageSaved: true,
      task: { title: 'EG call Avery', dueDate: '2026-08-16' },
    });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('accepts a brand-new record left at Lead with a dated first attempt', () => {
    const g = gradeRecord('avery-new', {
      stage: 'Lead', stageSaved: true,
      task: { title: 'EG call Avery', dueDate: '2026-08-16' },
    });
    expect(g.passed).toBe(true);
  });

  it('does not ask a no-note scenario for note content', () => {
    const g = gradeRecord('avery-new', {
      stage: 'Lead', stageSaved: true, task: { title: 'EG call Avery', dueDate: '2026-08-16' },
    });
    expect(g.checks.some((c) => c.id.startsWith('note_'))).toBe(false);
  });

  it('wants initials on the note and the task', () => {
    const g = gradeRecord('avery-appointment', {
      ...full,
      note: 'Spoke with Avery and confirmed Saturday at 11:00 AM. Next: send confirmation.',
      task: { ...full.task, title: 'confirm the appointment with Avery' },
    });
    expect(g.checks.find((c) => c.id === 'note_initials')?.pass).toBe(false);
    expect(g.checks.find((c) => c.id === 'task_initials')?.pass).toBe(false);
  });

  it('fails an undated task', () => {
    const g = gradeRecord('avery-appointment', {
      ...full, task: { title: 'EG confirm the appointment with Avery' },
    });
    expect(g.checks.find((c) => c.id === 'task_date')?.pass).toBe(false);
  });

  it('flags a vague task title', () => {
    const g = gradeRecord('avery-spoke', {
      stage: 'Spoke with Customer', stageSaved: true,
      note: 'EG — talked with Avery, wants Olympia, 3 bedrooms. Next: send options.',
      task: { title: 'EG do the thing', dueDate: '2026-08-20' },
    });
    expect(g.checks.find((c) => c.id === 'task_title')?.pass).toBe(false);
  });

  it('returns an empty grade for an unknown scenario', () => {
    expect(gradeRecord('nope', full)).toMatchObject({ passed: false, max: 0 });
  });

  it('every scenario keeps its expected stage out of the miss message', () => {
    for (const sc of Object.values(SCENARIOS)) {
      for (const s of sc.stage) expect(sc.stageMiss.toLowerCase()).not.toContain(s);
    }
  });
});
