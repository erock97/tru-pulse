/** Collection/review coverage, independent of response timing and findings. */
export interface ReportCoverage {
  schemaVersion: '1.0';
  scope: 'report_window';
  rosterComplete: boolean;
  contacts: Array<{
    leadId: string;
    leadName: string;
    agentName: string | null;
    status: 'reviewed' | 'unresolved';
    reason: 'collection_failed' | 'history_incomplete' | 'review_failed' | 'not_collected' | 'unknown' | null;
  }>;
}

export function validateReportCoverage(raw: unknown):
  { ok: true; value: ReportCoverage } | { ok: false; errors: string[] } {
  const fail = () => ({ ok: false as const, errors: ['coverage must match the report coverage 1.0 contract'] });
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, expected: string[]) =>
    Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
  const name = (v: unknown) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
  if (!object(raw) || !keys(raw, ['schemaVersion', 'scope', 'rosterComplete', 'contacts']) ||
      raw.schemaVersion !== '1.0' || raw.scope !== 'report_window' || typeof raw.rosterComplete !== 'boolean' ||
      !Array.isArray(raw.contacts) || raw.contacts.length > 10000) return fail();
  const seen = new Set<string>();
  for (const c of raw.contacts) {
    if (!object(c) || !keys(c, ['leadId', 'leadName', 'agentName', 'status', 'reason']) ||
        typeof c.leadId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(c.leadId) ||
        seen.has(c.leadId) || !name(c.leadName) || !(c.agentName === null || name(c.agentName))) return fail();
    seen.add(c.leadId);
    if (c.status === 'reviewed' ? c.reason !== null :
      c.status !== 'unresolved' || !['collection_failed', 'history_incomplete', 'review_failed', 'not_collected', 'unknown'].includes(c.reason as string)) return fail();
  }
  return { ok: true, value: structuredClone(raw) as unknown as ReportCoverage };
}

export function coverageState(coverage?: ReportCoverage): 'complete' | 'partial' | 'unknown' {
  if (!coverage) return 'unknown';
  return coverage.rosterComplete && coverage.contacts.every(c => c.status === 'reviewed') ? 'complete' : 'partial';
}

// Deployment and producer activation are separate decisions. Keep partial runs held.
export const PARTIAL_REPORT_PUBLISHING_ENABLED = false;
