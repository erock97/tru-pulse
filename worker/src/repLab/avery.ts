/** Avery Morgan — the Day 1 repair exercise, diagnosis half.
 *
 * This file used to grade the repair as well, by looking for "Thursday", "3 bed"
 * and "Juniper" in the note. That is exactly the marking-on-phrasing that
 * records.ts exists to avoid, and it failed correct work: a learner who wrote a
 * perfectly good note in their own words was told it was wrong. The repair half
 * now goes through gradeRecord like every other exercise, which marks what is
 * true of the RECORD and leaves the prose alone.
 *
 * What is left here is the half that genuinely has a right answer: before the
 * record can be edited, the learner has to say what is wrong with it. Naming the
 * faults is the skill — the repair is mechanical once you have seen them.
 *
 * The expected set stays on the server. The browser is told which of its own
 * boxes were wrong, never which ones it should have ticked.
 */

export const AVERY_ID = 'avery-repair';

export const AVERY_RISKS = ['wrong_stage', 'weak_note', 'missing_task', 'ignored_activity'] as const;
export type AveryRisk = (typeof AVERY_RISKS)[number];

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

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

/** Diagnosis only. All four planted faults have to be named before editing opens. */
export function gradeAvery(sub: LabSubmission): LabGrade {
  const named = new Set((sub.risks ?? []).map((r) => norm(r).replace(/\s+/g, '_')));
  const checks: LabCheck[] = AVERY_RISKS.map((id) => {
    const pass = named.has(id);
    return {
      id: `risk_${id}`,
      pass,
      message: pass ? 'Risk named.' : 'A planted problem on this record is still unnamed.',
      required: true,
      critical: false,
    };
  });

  // Ticking all four boxes without reading is not diagnosis. There are more boxes
  // on screen than there are faults, so a full sweep is a wrong answer here.
  const overreach = [...named].filter((r) => !AVERY_RISKS.includes(r as AveryRisk));
  if (overreach.length) {
    checks.push({
      id: 'overreach',
      pass: false,
      message: 'You have flagged something this record does not actually get wrong. Ticking everything is not a diagnosis.',
      required: true,
      critical: false,
    });
  }

  const critical = checks.some((c) => c.critical && !c.pass);
  const requiredFail = checks.some((c) => c.required && !c.pass);
  return { passed: !critical && !requiredFail, phase: 'audit', checks, critical };
}
