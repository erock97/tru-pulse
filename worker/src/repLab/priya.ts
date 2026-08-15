/** Priya Shah — Day 1 repair lab. Expected values stay on the server. */

export const PRIYA_ID = 'priya-repair';

export const PRIYA_RISKS = ['wrong_stage', 'weak_note', 'missing_task', 'ignored_activity'] as const;
export type PriyaRisk = (typeof PRIYA_RISKS)[number];

export type LabPhase = 'audit' | 'repair';

export interface LabSubmission {
  phase: LabPhase;
  contactName?: string;
  risks?: string[];
  stage?: string;
  note?: string;
  task?: { title?: string; owner?: string; due?: string };
  channel?: string;
}

export interface LabCheck {
  id: string;
  pass: boolean;
  /** Names the missing element. Must never contain the expected answer. */
  message: string;
  required: boolean;
  critical: boolean;
}

export interface LabGrade {
  passed: boolean;
  phase: LabPhase;
  checks: LabCheck[];
  critical: boolean;
  score?: number;
  max?: number;
}

const STAGE_OK = ['spoke with customer', 'spoke with'];
const CONTACT_OK = ['priya shah', 'priya'];

const NOTE_REQUIRED: Array<{ id: string; needles: string[]; missing: string }> = [
  { id: 'note_reached', needles: ['reached', 'spoke', 'talked'], missing: 'what happened on the call' },
  { id: 'note_need', needles: ['3 bed', 'three bed', '3-bed', 'bedroom'], missing: 'what the buyer needs' },
  { id: 'note_next', needles: ['comparison', '406', '422', 'juniper'], missing: 'the next action' },
  { id: 'note_when', needles: ['thu', 'thursday', '10', '8/13', 'aug 13'], missing: 'when the next action is due' },
];

const NOTE_FORBIDDEN: Array<{ id: string; needles: string[]; missing: string }> = [
  {
    id: 'note_excludes_claims',
    needles: ['ready to buy', 'must be serious', 'proves she is ready', 'views mean she', 'activity proves'],
    missing: 'a claim that Home Activity proves intent',
  },
];

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

export function gradePriya(sub: LabSubmission): LabGrade {
  const phase = sub.phase === 'repair' ? 'repair' : 'audit';
  if (phase === 'audit') return gradeAudit(sub);
  return gradeRepair(sub);
}

function gradeAudit(sub: LabSubmission): LabGrade {
  const named = new Set((sub.risks ?? []).map((r) => norm(r).replace(/\s+/g, '_')));
  const checks: LabCheck[] = PRIYA_RISKS.map((id) => {
    const pass = named.has(id);
    return {
      id: `risk_${id}`,
      pass,
      message: pass ? 'Risk named.' : 'A planted problem on this record is still unnamed.',
      required: true,
      critical: false,
    };
  });
  const contact = contactCheck(sub.contactName);
  checks.unshift(contact);
  return wrap('audit', checks);
}

function gradeRepair(sub: LabSubmission): LabGrade {
  const checks: LabCheck[] = [contactCheck(sub.contactName)];

  const stage = norm(sub.stage);
  const stageOk = STAGE_OK.includes(stage);
  const appointment = stage.includes('appointment');
  checks.push({
    id: 'stage',
    pass: stageOk,
    message: stageOk
      ? 'Stage matches what happened.'
      : appointment
        ? 'That stage needs a confirmed date and time. This call did not have one.'
        : 'The stage does not match what actually happened.',
    required: true,
    critical: appointment || (!stageOk && !!stage),
  });

  const note = norm(sub.note);
  for (const req of NOTE_REQUIRED) {
    const pass = hasAny(note, req.needles);
    checks.push({
      id: req.id,
      pass,
      message: pass ? 'Present in the note.' : `The note is missing ${req.missing}.`,
      required: true,
      critical: false,
    });
  }
  for (const ban of NOTE_FORBIDDEN) {
    const hit = hasAny(note, ban.needles);
    checks.push({
      id: ban.id,
      pass: !hit,
      message: hit
        ? 'The note treats a visible signal as proof. Keep activity as context only.'
        : 'No unsupported claim in the note.',
      required: true,
      critical: hit,
    });
  }

  const title = norm(sub.task?.title);
  const due = norm(sub.task?.due);
  const owner = norm(sub.task?.owner);
  const taskOk = hasAny(title, ['comparison', 'juniper', 'priya']) && !!due && !!owner;
  checks.push({
    id: 'task',
    pass: taskOk,
    message: taskOk
      ? 'Task has an action, an owner, and a time.'
      : 'The task needs a concrete action, an owner, and a date and time.',
    required: true,
    critical: false,
  });

  return wrap('repair', checks);
}

function contactCheck(name: string | undefined): LabCheck {
  const n = norm(name);
  const pass = !!n && CONTACT_OK.some((ok) => n.includes(ok));
  return {
    id: 'contact',
    pass,
    message: pass ? 'Correct record.' : 'This is not the assigned practice contact.',
    required: true,
    critical: !pass,
  };
}

function wrap(phase: LabPhase, checks: LabCheck[]): LabGrade {
  const critical = checks.some((c) => c.critical && !c.pass);
  const requiredFail = checks.some((c) => c.required && !c.pass);
  return { passed: !critical && !requiredFail, phase, checks, critical };
}
