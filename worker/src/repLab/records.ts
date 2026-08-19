/** Practice-record scenarios: several small situations on one shared contact.
 *
 * The learner operates a record rather than answering questions about one: pick
 * a stage and SAVE it, write a note, schedule a dated task, log a deal.
 *
 * GRADING IS DELIBERATELY DUMB, and that is Eric's call: if someone types one
 * letter in the note, it passes. We do not read their words and judge them.
 * Keyword matching on a note or a task title fails good work constantly — it
 * marks people on phrasing rather than on the thing being taught — and a learner
 * who cannot get past a screen they answered correctly simply stops.
 *
 * So we check only what is objectively true of the RECORD:
 *   - is the stage the honest one for what happened
 *   - was it actually saved (choosing is not saving)
 *   - is there a note at all
 *   - is there a task, and does it carry a date
 *   - for a contract: is there a deal, with a price and a close date
 *
 * What makes a note useful is taught in the slides, where it belongs. Expected
 * stages stay here on the server and never reach the browser.
 */

export type RecordSubmission = {
  stage?: string;
  stageSaved?: boolean;
  note?: string;
  task?: { title?: string; owner?: string; dueDate?: string; dueTime?: string };
  deal?: { name?: string; price?: string; closeDate?: string };
};

export type RecordCheck = {
  id: string;
  label: string;
  pass: boolean;
  /** Names what is missing. Must never give away the expected answer. */
  message: string;
};

export type RecordGrade = {
  passed: boolean;
  score: number;
  max: number;
  checks: RecordCheck[];
};

type Scenario = {
  id: string;
  /** Lower-cased stage labels that count as honest here. */
  stage: string[];
  /** Shown when the stage is wrong, WITHOUT naming the right one. */
  stageMiss: string;
  requireNote: boolean;
  requireTask: boolean;
  requireDeal: boolean;
  /** Default true. Day-close leaves the stage alone — saving it is not a step. */
  requireStageSave?: boolean;
};

// One new skill at a time, matching the order the slides teach them. Asking for a
// note on the card that follows the STAGES slides — before notes have been taught —
// is why this had to be rebuilt.
//
// The first three climb on VOLUME: one move, then two, then three. Each of them
// states the outcome plainly, because the skill being drilled is operating the
// controls, not reading a situation.
//
// The last two climb on JUDGEMENT instead, which is the only axis left worth
// climbing. Nothing tells the learner which stage is right; the situation has to be
// read for it, and in both cases the obvious answer is the wrong one. Making them
// merely longer would have been a fourth and fifth lap of the same three moves.
export const SCENARIOS: Record<string, Scenario> = {
  // 1. Stages only.
  'set-appointment': {
    id: 'set-appointment',
    stage: ['appointment set'],
    stageMiss: 'A booked day and time changes what this record should say.',
    requireNote: false, requireTask: false, requireDeal: false,
  },

  // 2. Stages + notes.
  'spoke-note': {
    id: 'spoke-note',
    stage: ['spoke with customer', 'spoke with'],
    stageMiss: 'You had a real conversation but nothing was booked. The stage should match that exactly.',
    requireNote: true, requireTask: false, requireDeal: false,
  },

  // 3. Stages + notes + tasks.
  'noanswer-task': {
    id: 'noanswer-task',
    stage: ['attempted contact'],
    stageMiss: 'You tried to reach them and did not get through. The stage should say exactly that, and no more.',
    requireNote: true, requireTask: true, requireDeal: false,
  },

  // 4. The repair. The record ALREADY claims an appointment, and the call it came
  //    from produced a plan the buyer never confirmed. "Thursday morning" said out
  //    loud is not a booking, so the honest move here is backwards down the ladder —
  //    the only exercise in the module that asks for that.
  'avery-repair': {
    id: 'avery-repair',
    stage: ['spoke with customer', 'spoke with'],
    stageMiss: 'Read what was actually agreed. A time somebody mentioned is not a time anybody confirmed, and this record is currently claiming more than the call earned.',
    requireNote: true, requireTask: true, requireDeal: false,
  },

  // 5. The deal Follow Up Boss never asks you for. The stage is deliberately not
  //    named in the situation, and "the inspection is booked" is there to pull an
  //    unwary learner toward an appointment stage.
  'offer-accepted': {
    id: 'offer-accepted',
    stage: ['under contract'],
    stageMiss: 'A signed contract outranks anything scheduled around it. The stage should say where the deal is, not what is on the calendar.',
    requireNote: true, requireTask: true, requireDeal: true,
  },

  // The Record Is the Job. Inherited file already claims a booking it never earned.
  'honest-stage': {
    id: 'honest-stage',
    stage: ['spoke with customer', 'spoke with'],
    stageMiss: 'Read what this file actually earned. A conversation is not a booking, and this record is currently claiming more than the last note supports.',
    requireNote: true, requireTask: true, requireDeal: false,
  },

  // The Record Is the Job. Stage is already honest — Appointment set fails.
  'day-close': {
    id: 'day-close',
    stage: ['spoke with customer', 'spoke with'],
    stageMiss: 'The stage was already honest. Do not claim more than this call earned.',
    requireNote: true, requireTask: true, requireDeal: false,
    requireStageSave: false,
  },
};

/**
 * The diagnosis half of the repair: what is actually wrong with the record.
 *
 * This is the one place a practice record has a right answer beyond the stage,
 * and it lives here — with the rest of the grading and behind the same
 * permission check — because it used to live on the live-sim endpoint instead.
 * That endpoint 403s anyone who is not an enrolled agent, so a leader walking
 * their own training got a silent failure and a gate that would not open.
 *
 * The browser is told which of ITS ticks were wrong, never which ones it missed.
 */
export const FAULT_SETS: Record<string, readonly string[]> = {
  'avery-repair': ['wrong_stage', 'weak_note', 'missing_task', 'ignored_activity'],
};

export function gradeFaults(scenarioId: string, picked: string[]): RecordGrade {
  const want = FAULT_SETS[scenarioId];
  if (!want) return { passed: false, score: 0, max: 0, checks: [] };

  const named = new Set(picked.map((r) => norm(r).replace(/\s+/g, '_')));
  const checks: RecordCheck[] = [{
    id: 'faults_found',
    label: 'Every real fault named',
    pass: want.every((w) => named.has(w)),
    message: want.every((w) => named.has(w))
      ? 'You found them all.'
      : 'Something wrong with this record is still unticked. Read it again before you change it.',
  }];

  // More boxes than faults, on purpose. A full sweep is not a diagnosis.
  const extra = [...named].filter((r) => !want.includes(r));
  checks.push({
    id: 'faults_precise',
    label: 'Nothing flagged that is actually fine',
    pass: extra.length === 0,
    message: extra.length === 0
      ? 'Nothing over-flagged.'
      : 'You have flagged something this record does not get wrong. Ticking everything is not a diagnosis.',
  });

  const score = checks.filter((c) => c.pass).length;
  return { passed: score === checks.length, score, max: checks.length, checks };
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const filled = (s?: string) => norm(s).length > 0;

export function gradeRecord(scenarioId: string, sub: RecordSubmission): RecordGrade {
  const sc = SCENARIOS[scenarioId];
  if (!sc) return { passed: false, score: 0, max: 0, checks: [] };

  const checks: RecordCheck[] = [];

  // ── the stage, and the step everyone misses: saving it ──
  const stageOk = sc.stage.includes(norm(sub.stage));
  checks.push({
    id: 'stage', label: 'The stage matches what happened', pass: stageOk,
    message: stageOk ? 'Right.' : sc.stageMiss,
  });
  if (sc.requireStageSave !== false) {
    checks.push({
      id: 'stage_saved', label: 'The stage was saved', pass: !!sub.stageSaved,
      message: sub.stageSaved ? 'Saved, and it stuck.' : 'Choosing a stage is not saving it — use the green check.',
    });
  }

  // ── a note exists. Its contents are not ours to mark. ──
  if (sc.requireNote) {
    const has = filled(sub.note);
    checks.push({
      id: 'note', label: 'A note is on the record', pass: has,
      message: has ? 'Left for the next person.' : 'There is no note on this record yet.',
    });
  }

  // ── a task exists, and carries a date ──
  if (sc.requireTask) {
    const has = filled(sub.task?.title);
    checks.push({
      id: 'task', label: 'A task is on the record', pass: has,
      message: has ? 'Scheduled.' : 'There is no task on this record yet.',
    });
    const dated = !!sub.task?.dueDate;
    checks.push({
      id: 'task_date', label: 'The task has a date', pass: dated,
      message: dated ? 'Dated.' : 'A promise with no date is not a next step.',
    });
  }

  // ── the deal FUB will never prompt you for ──
  if (sc.requireDeal) {
    const named = filled(sub.deal?.name);
    checks.push({
      id: 'deal', label: 'A deal is on the record', pass: named,
      message: named ? 'Logged.' : 'Moving the stage does not create the deal. Follow Up Boss will not ask you for it.',
    });
    const priced = filled(sub.deal?.price);
    checks.push({
      id: 'deal_price', label: 'The deal has a price', pass: priced,
      message: priced ? 'Recorded.' : 'The deal has no price on it.',
    });
    const closes = !!sub.deal?.closeDate;
    checks.push({
      id: 'deal_close', label: 'The deal has a close date', pass: closes,
      message: closes ? 'Dated.' : 'Without a close date the deal cannot be forecast.',
    });
  }

  const score = checks.filter((c) => c.pass).length;
  return { passed: score === checks.length, score, max: checks.length, checks };
}
