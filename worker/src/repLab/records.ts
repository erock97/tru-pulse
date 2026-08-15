/** Practice-record scenarios: several small situations on one shared contact.
 *
 * The learner does not answer a multiple-choice question about the CRM — they
 * operate a record: pick a stage and SAVE it, write a note, schedule a dated
 * task. The point is to build the muscle without fear of breaking anything, so
 * every scenario is graded on the same three things a real record is judged on.
 *
 * Expected values live here, on the server, and never travel to the browser.
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

type NoteRule = { id: string; label: string; needles: string[]; missing: string };

type Scenario = {
  id: string;
  /** Lower-cased stage labels that count as honest here. */
  stage: string[];
  /** Shown when the stage is wrong, without naming the right one. */
  stageMiss: string;
  note: NoteRule[];
  /** Words that make a task title specific enough to act on. */
  taskNeedles: string[];
  taskMiss: string;
  requireTask: boolean;
  requireNote: boolean;
  /** Under contract means a deal has to exist. FUB does not prompt for it. */
  requireDeal?: boolean;
};

export const SCENARIOS: Record<string, Scenario> = {
  // 1. Nothing has happened yet. The temptation is to move the stage anyway.
  'avery-new': {
    id: 'avery-new',
    stage: ['lead'],
    stageMiss: 'Nothing has happened on this record yet. The stage should say so.',
    note: [],
    requireNote: false,
    taskNeedles: ['call', 'reach', 'contact', 'avery', 'ring', 'phone'],
    taskMiss: 'The task should name the first attempt you are going to make.',
    requireTask: true,
  },

  // 2. A real conversation, and a confirmed date and time.
  'avery-appointment': {
    id: 'avery-appointment',
    stage: ['appointment set'],
    stageMiss: 'A confirmed date and time changes what this record should say.',
    note: [
      { id: 'note_happened', label: 'What happened', needles: ['spoke', 'talked', 'called', 'reached', 'confirmed'], missing: 'what actually happened on the call' },
      { id: 'note_when', label: 'The date and time', needles: ['sat', 'saturday', '11', '11:00'], missing: 'the confirmed day and time' },
      { id: 'note_next', label: 'What happens next', needles: ['next', 'send', 'confirm', 'prep', 'bring', 'meet'], missing: 'what you will do before the appointment' },
    ],
    requireNote: true,
    taskNeedles: ['confirm', 'prep', 'send', 'avery', 'appointment', 'remind'],
    taskMiss: 'The task should name what you will do before the appointment.',
    requireTask: true,
  },

  // 3. A real conversation, no appointment. The classic over-promotion.
  'avery-spoke': {
    id: 'avery-spoke',
    stage: ['spoke with customer', 'spoke with'],
    stageMiss: 'You learned something real, but nothing was booked. The stage should match that exactly.',
    note: [
      { id: 'note_happened', label: 'What happened', needles: ['spoke', 'talked', 'called', 'reached'], missing: 'what actually happened on the call' },
      { id: 'note_need', label: 'What they need', needles: ['bed', 'olympia', 'lacey', 'budget', 'school', 'garage', 'want'], missing: 'what the buyer told you they need' },
      { id: 'note_next', label: 'What happens next', needles: ['next', 'send', 'follow', 'call'], missing: 'what you committed to do next' },
    ],
    requireNote: true,
    taskNeedles: ['send', 'call', 'follow', 'avery', 'option', 'home'],
    taskMiss: 'The task should name the thing you promised them.',
    requireTask: true,
  },

  // 4. The offer was accepted. The stage is the easy half; the deal is the half
  //    FUB never asks you for.
  'avery-contract': {
    id: 'avery-contract',
    stage: ['under contract'],
    stageMiss: 'An accepted offer changes what this record should say.',
    note: [
      { id: 'note_happened', label: 'What happened', needles: ['accept', 'offer', 'contract', 'under'], missing: 'that the offer was accepted' },
      { id: 'note_terms', label: 'The terms', needles: ['265', '456 oak', 'oak st', 'sept', '9/30', 'close'], missing: 'the price or the closing date' },
    ],
    requireNote: true,
    taskNeedles: ['inspection', 'earnest', 'deposit', 'lender', 'avery', 'schedule', 'order', 'confirm'],
    taskMiss: 'The task should name the next thing this contract needs.',
    requireTask: true,
    requireDeal: true,
  },
};

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const hasAny = (hay: string, needles: string[]) => needles.some((n) => hay.includes(n));

/** Initials, loosely: a leading "AB", "A.B.", "ab —" and so on. */
const startsWithInitials = (s: string) => /^[a-z]\.?\s?[a-z]\.?\b/i.test(s.trim());

export function gradeRecord(scenarioId: string, sub: RecordSubmission): RecordGrade {
  const sc = SCENARIOS[scenarioId];
  if (!sc) return { passed: false, score: 0, max: 0, checks: [] };

  const checks: RecordCheck[] = [];
  const stage = norm(sub.stage);
  const note = norm(sub.note);
  const title = norm(sub.task?.title);

  // ── the stage, and the step everyone misses: saving it ──
  const stageOk = sc.stage.includes(stage);
  checks.push({
    id: 'stage', label: 'Honest stage', pass: stageOk,
    message: stageOk ? 'The stage matches what happened.' : sc.stageMiss,
  });
  checks.push({
    id: 'stage_saved', label: 'Stage actually saved', pass: !!sub.stageSaved,
    message: sub.stageSaved ? 'Saved, and it stuck.' : 'Choosing a stage is not saving it.',
  });

  // ── the note ──
  if (sc.requireNote) {
    for (const rule of sc.note) {
      const ok = hasAny(note, rule.needles);
      checks.push({
        id: rule.id, label: rule.label, pass: ok,
        message: ok ? 'Covered.' : `The note does not say ${rule.missing}.`,
      });
    }
    checks.push({
      id: 'note_initials', label: 'Your initials on the note', pass: startsWithInitials(note),
      message: startsWithInitials(note)
        ? 'Signed.'
        : 'Start the note with your initials so the team knows whose work it is.',
    });
  }

  // ── the task ──
  if (sc.requireTask) {
    const titled = !!title && hasAny(title, sc.taskNeedles);
    checks.push({
      id: 'task_title', label: 'A specific task', pass: titled,
      message: titled ? 'Specific enough to act on.' : sc.taskMiss,
    });
    const dated = !!sub.task?.dueDate;
    checks.push({
      id: 'task_date', label: 'A real date on it', pass: dated,
      message: dated ? 'Dated.' : 'A promise with no date is not a next step.',
    });
    checks.push({
      id: 'task_initials', label: 'Your initials on the task', pass: startsWithInitials(title),
      message: startsWithInitials(title)
        ? 'Signed.'
        : 'Start the task with your initials too.',
    });
  }

  // ── the deal ──
  if (sc.requireDeal) {
    const named = !!norm(sub.deal?.name);
    checks.push({
      id: 'deal_created', label: 'A deal on the record', pass: named,
      message: named
        ? 'Logged.'
        : 'Moving the stage does not create the deal. Follow Up Boss will not ask you for it.',
    });
    const priced = !!sub.deal?.price && /\d/.test(String(sub.deal.price));
    checks.push({
      id: 'deal_price', label: 'The price', pass: priced,
      message: priced ? 'Recorded.' : 'The deal has no price on it.',
    });
    const closes = !!sub.deal?.closeDate;
    checks.push({
      id: 'deal_close', label: 'A close date', pass: closes,
      message: closes ? 'Dated.' : 'The deal has no close date, so it cannot be forecast.',
    });
  }

  const score = checks.filter((c) => c.pass).length;
  return { passed: score === checks.length, score, max: checks.length, checks };
}
