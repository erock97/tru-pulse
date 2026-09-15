export type AssessmentDraft = { submissionId: string; pAns: number[]; bAns: number[] };
const key = (agentId: string) => `tru-assessment-v1:${agentId}`;
const validAnswers = (v: unknown, max: number, minValue: number, maxValue: number): v is number[] =>
  Array.isArray(v) && v.length <= max && v.every(n => Number.isInteger(n) && n >= minValue && n <= maxValue);
export function readAssessmentDraft(agentId: string): AssessmentDraft | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(agentId)) ?? 'null');
    if (!v || typeof v.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.submissionId)
      || !validAnswers(v.pAns, 20, -3, 3) || !validAnswers(v.bAns, 32, 0, 5)
      || (v.bAns.length > 0 && v.pAns.length !== 20)) return null;
    return { submissionId: v.submissionId, pAns: v.pAns, bAns: v.bAns };
  } catch { return null; }
}
export function writeAssessmentDraft(agentId: string, draft: AssessmentDraft): boolean {
  try { localStorage.setItem(key(agentId), JSON.stringify(draft)); return true; } catch { return false; }
}
export function clearAssessmentDraft(agentId: string, submissionId: string): void {
  try { if (readAssessmentDraft(agentId)?.submissionId === submissionId) localStorage.removeItem(key(agentId)); } catch { /* A replay uses the same submission ID. */ }
}
