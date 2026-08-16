import { describe, it, expect } from 'vitest';
import { gradeRecord, gradeFaults, SCENARIOS } from './records.js';

const ALL_FOUR = ['wrong_stage', 'weak_note', 'missing_task', 'ignored_activity'];

describe('gradeFaults — the diagnosis half of the repair', () => {
  it('passes only when every real fault is named', () => {
    expect(gradeFaults('avery-repair', ALL_FOUR).passed).toBe(true);
    expect(gradeFaults('avery-repair', ['wrong_stage', 'weak_note']).passed).toBe(false);
  });

  it('fails a learner who ticks every box instead of reading', () => {
    const sweep = gradeFaults('avery-repair', [...ALL_FOUR, 'no_owner', 'no_source']);
    expect(sweep.passed).toBe(false);
    expect(sweep.checks.find((c) => c.id === 'faults_precise')?.pass).toBe(false);
  });

  it('fails one wrong tick even when all four real faults are named', () => {
    expect(gradeFaults('avery-repair', [...ALL_FOUR, 'no_source']).passed).toBe(false);
  });

  it('never names the faults the learner missed', () => {
    const dumped = JSON.stringify(gradeFaults('avery-repair', [])).toLowerCase();
    for (const f of ALL_FOUR) expect(dumped).not.toContain(f);
  });

  it('returns an empty grade for a scenario with no fault set', () => {
    expect(gradeFaults('spoke-note', ALL_FOUR)).toMatchObject({ passed: false, max: 0 });
  });
});

describe('gradeRecord — marks the record, never the prose', () => {
  const spoke = {
    stage: 'Spoke with customer', stageSaved: true,
    note: 'x',
    task: { title: 'y', dueDate: '2026-08-20' },
  };

  it('passes a one-letter note', () => {
    expect(gradeRecord('spoke-note', spoke).passed).toBe(true);
  });

  it('accepts any task title, however terse', () => {
    const g = gradeRecord('noanswer-task', {
      stage: 'Attempted contact', stageSaved: true, note: 'x', task: { title: 'y', dueDate: '2026-08-20' },
    });
    expect(g.checks.find((c) => c.id === 'task')?.pass).toBe(true);
  });

  it('asks for no task on the stage-and-note scenario', () => {
    const g = gradeRecord('spoke-note', spoke);
    expect(g.checks.some((c) => c.id === 'task')).toBe(false);
  });

  it('asks for nothing but the stage on the first scenario', () => {
    const g = gradeRecord('set-appointment', { stage: 'Appointment set', stageSaved: true });
    expect(g.passed).toBe(true);
    expect(g.checks).toHaveLength(2);
  });

  it('never marks a note or a task on its wording', () => {
    const odd = gradeRecord('spoke-note', {
      ...spoke, note: 'zzzz', task: { title: 'zzzz', dueDate: '2026-08-20' },
    });
    expect(odd.passed).toBe(true);
  });

  it('still fails an empty note', () => {
    const g = gradeRecord('spoke-note', { ...spoke, note: '   ' });
    expect(g.checks.find((c) => c.id === 'note')?.pass).toBe(false);
  });

  it('still fails a task with no date', () => {
    const g = gradeRecord('noanswer-task', {
      stage: 'Attempted contact', stageSaved: true, note: 'x', task: { title: 'y' },
    });
    expect(g.checks.find((c) => c.id === 'task_date')?.pass).toBe(false);
  });

  it('fails a stage that was chosen but never saved', () => {
    const g = gradeRecord('spoke-note', { ...spoke, stageSaved: false });
    expect(g.checks.find((c) => c.id === 'stage_saved')?.pass).toBe(false);
  });

  it('rejects claiming a conversation when the call was not answered', () => {
    const g = gradeRecord('noanswer-task', {
      stage: 'Spoke with customer', stageSaved: true, note: 'x', task: { title: 'x', dueDate: '2026-08-16' },
    });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('rejects leaving it at Lead — the attempt did happen', () => {
    const g = gradeRecord('noanswer-task', {
      stage: 'Lead', stageSaved: true, note: 'x', task: { title: 'x', dueDate: '2026-08-16' },
    });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('accepts an unanswered call recorded as an attempt', () => {
    const g = gradeRecord('noanswer-task', {
      stage: 'Attempted contact', stageSaved: true, note: 'left a voicemail',
      task: { title: 'try again', dueDate: '2026-08-16' },
    });
    expect(g.passed).toBe(true);
  });

  it('is case- and spacing-insensitive about the stage', () => {
    const g = gradeRecord('spoke-note', { ...spoke, stage: '  SPOKE   WITH CUSTOMER ' });
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
    expect(gradeRecord('offer-accepted', done).passed).toBe(true);
  });

  it('fails when the stage moved but no deal was added', () => {
    const g = gradeRecord('offer-accepted', { ...done, deal: undefined });
    expect(g.passed).toBe(false);
    expect(g.checks.find((c) => c.id === 'deal')?.pass).toBe(false);
  });

  it('wants a price and a close date on the deal', () => {
    const g = gradeRecord('offer-accepted', { ...done, deal: { name: '456 Oak St' } });
    expect(g.checks.find((c) => c.id === 'deal_price')?.pass).toBe(false);
    expect(g.checks.find((c) => c.id === 'deal_close')?.pass).toBe(false);
  });

  it('asks for no deal on the scenarios that have none', () => {
    const g = gradeRecord('noanswer-task', {
      stage: 'Attempted contact', stageSaved: true, note: 'x', task: { title: 'x', dueDate: '2026-08-16' },
    });
    expect(g.checks.some((c) => c.id.startsWith('deal'))).toBe(false);
  });
});

// The last two exercises are the only ones where the situation does not name the
// stage. Both bait the learner toward a stage the facts do not support, so the
// bait failing is the thing worth locking down.
describe('the two judgement scenarios', () => {
  const worked = { stageSaved: true, note: 'x', task: { title: 'y', dueDate: '2026-08-20' } };

  it('repair: accepts moving the stage BACK when the call did not earn it', () => {
    expect(gradeRecord('avery-repair', { ...worked, stage: 'Spoke with customer' }).passed).toBe(true);
  });

  it('repair: rejects leaving the appointment the record already wrongly claims', () => {
    const g = gradeRecord('avery-repair', { ...worked, stage: 'Appointment set' });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('repair: rejects over-correcting all the way down to a bare attempt', () => {
    const g = gradeRecord('avery-repair', { ...worked, stage: 'Attempted contact' });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('offer: rejects the booked inspection as the stage', () => {
    const g = gradeRecord('offer-accepted', {
      ...worked, stage: 'Appointment set',
      deal: { name: '456 Oak St', price: '265000', closeDate: '2026-09-30' },
    });
    expect(g.checks.find((c) => c.id === 'stage')?.pass).toBe(false);
  });

  it('neither failure message hands over the stage it wanted', () => {
    for (const id of ['avery-repair', 'offer-accepted']) {
      const g = gradeRecord(id, { ...worked, stage: 'Lead' });
      const miss = g.checks.find((c) => c.id === 'stage')!.message.toLowerCase();
      for (const s of SCENARIOS[id].stage) expect(miss).not.toContain(s);
    }
  });
});
