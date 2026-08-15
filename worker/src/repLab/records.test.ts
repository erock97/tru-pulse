import { describe, it, expect } from 'vitest';
import { gradeRecord, SCENARIOS } from './records.js';

describe('gradeRecord — marks the record, never the prose', () => {
  const spoke = {
    stage: 'Spoke with customer', stageSaved: true,
    note: 'x',
    task: { title: 'y', dueDate: '2026-08-20' },
  };

  it('passes a one-letter note', () => {
    expect(gradeRecord('avery-spoke', spoke).passed).toBe(true);
  });

  it('accepts any task title, however terse', () => {
    const g = gradeRecord('avery-spoke', { ...spoke, task: { title: 'y', dueDate: '2026-08-20' } });
    expect(g.checks.find((c) => c.id === 'task')?.pass).toBe(true);
  });

  it('never marks a note or a task on its wording', () => {
    const odd = gradeRecord('avery-spoke', {
      ...spoke, note: 'zzzz', task: { title: 'zzzz', dueDate: '2026-08-20' },
    });
    expect(odd.passed).toBe(true);
  });

  it('still fails an empty note', () => {
    const g = gradeRecord('avery-spoke', { ...spoke, note: '   ' });
    expect(g.checks.find((c) => c.id === 'note')?.pass).toBe(false);
  });

  it('still fails a task with no date', () => {
    const g = gradeRecord('avery-spoke', { ...spoke, task: { title: 'y' } });
    expect(g.checks.find((c) => c.id === 'task_date')?.pass).toBe(false);
  });

  it('fails a stage that was chosen but never saved', () => {
    const g = gradeRecord('avery-spoke', { ...spoke, stageSaved: false });
    expect(g.checks.find((c) => c.id === 'stage_saved')?.pass).toBe(false);
  });

  it('rejects promoting a brand-new record past Lead', () => {
    const g = gradeRecord('avery-new', {
      stage: 'Spoke with customer', stageSaved: true, task: { title: 'x', dueDate: '2026-08-16' },
    });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('accepts a new record left at Lead with a dated task, and asks for no note', () => {
    const g = gradeRecord('avery-new', {
      stage: 'Lead', stageSaved: true, task: { title: 'x', dueDate: '2026-08-16' },
    });
    expect(g.passed).toBe(true);
    expect(g.checks.some((c) => c.id === 'note')).toBe(false);
  });

  it('is case- and spacing-insensitive about the stage', () => {
    const g = gradeRecord('avery-spoke', { ...spoke, stage: '  SPOKE   WITH CUSTOMER ' });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(true);
  });

  it('never reveals the expected stage in a failure message', () => {
    for (const sc of Object.values(SCENARIOS)) {
      for (const s of sc.stage) expect(sc.stageMiss.toLowerCase()).not.toContain(s);
    }
  });

  it('returns an empty grade for an unknown scenario', () => {
    expect(gradeRecord('nope', spoke)).toMatchObject({ passed: false, max: 0 });
  });
});

describe('the contract scenario', () => {
  const done = {
    stage: 'Under contract', stageSaved: true,
    note: 'x',
    task: { title: 'y', dueDate: '2026-08-20' },
    deal: { name: '456 Oak St', price: '265000', closeDate: '2026-09-30' },
  };

  it('passes a contract with the deal logged', () => {
    expect(gradeRecord('avery-contract', done).passed).toBe(true);
  });

  it('fails when the stage moved but no deal was added', () => {
    const g = gradeRecord('avery-contract', { ...done, deal: undefined });
    expect(g.passed).toBe(false);
    expect(g.checks.find((c) => c.id === 'deal')?.pass).toBe(false);
  });

  it('wants a price and a close date on the deal', () => {
    const g = gradeRecord('avery-contract', { ...done, deal: { name: '456 Oak St' } });
    expect(g.checks.find((c) => c.id === 'deal_price')?.pass).toBe(false);
    expect(g.checks.find((c) => c.id === 'deal_close')?.pass).toBe(false);
  });

  it('asks for no deal on the scenarios that have none', () => {
    const g = gradeRecord('avery-new', {
      stage: 'Lead', stageSaved: true, task: { title: 'x', dueDate: '2026-08-16' },
    });
    expect(g.checks.some((c) => c.id.startsWith('deal'))).toBe(false);
  });
});
