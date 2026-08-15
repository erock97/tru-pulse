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
};

export const SCENARIOS: Record<string, Scenario> = {
  // One new skill at a time, matching the order the slides teach them. Asking
  // for a note on the card that follows the STAGES slides — before notes have
  // been taught — is why this had to be rebuilt.

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

  // 4. All three, unaided.
  'full-record': {
    id: 'full-record',
    stage: ['spoke with customer', 'spoke with'],
    stageMiss: 'They called and told you something, but no time was agreed. The stage should match that.',
    requireNote: true, requireTask: true, requireDeal: false,
  },

  // 5. The deal Follow Up Boss never asks you for.
  'avery-contract': {
    id: 'avery-contract',
    stage: ['under contract'],
    stageMiss: 'An accepted offer changes what this record should say.',
    requireNote: true, requireTask: true, requireDeal: true,
  },
};

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
  checks.push({
    id: 'stage_saved', label: 'The stage was saved', pass: !!sub.stageSaved,
    message: sub.stageSaved ? 'Saved, and it stuck.' : 'Choosing a stage is not saving it — use the green check.',
  });

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
