// Agent prose is deliberately restricted to short, single-line operational summaries.
export const AGENT_BODY_BYTES = 8192;
export const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
export type AgentOperation = 'claim' | 'renew' | 'update' | 'release';
export interface AgentWrite {
  agentId: 'brian'; expectedVersion: number; leaseSeconds?: number;
  status?: 'investigating' | 'fixed' | 'needs-human'; diagnosis?: string;
  remediation?: string; nextStep?: string; filesChanged?: string[]; testsRun?: string[];
}
export function safeAgentText(value: unknown, max = 500): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return false;
  // No quoted evidence, dumps, markup, control characters, paths or credential material.
  if (/[\r\n\t<>`{}\\]|[\x00-\x1f\x7f]|["“”]/.test(value)) return false;
  if (/[^\s@]+@[^\s@]+|(?:\+?\d[\s().-]*){7,}|(?:[a-z]:[\\/]|(?:^|\s)\/|~\/)|\b(?:password|passwd|bearer|authorization|cookie|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]|\bBearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(value)) return false;
  if (/\b(?:password|passwd|bearer|authorization|cookie|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\b/i.test(value)) return false;
  if (/\b(?:console\.(?:log|error)|npm (?:test|run)|node \S+|PS [A-Z]:|exit code|PASS |FAIL |Test Files)|;\s*$|\b(?:class|function)\s+\w+\s*[(]/.test(value)) return false;
  if (/\b(?:customer|lead|contact)\s+(?:name|said|wrote|says)|\b(?:transcript|message body|coaching quot|stack trace|traceback)|\b(?:const|let|var|function|import|export)\s+\w+\s*[=(]|=>|\$\s|\b(?:stdout|stderr)\s*[:=]/i.test(value)) return false;
  // Reject name-like pairs anywhere, including unlabeled names, conservatively.
  if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(value)) return false;
  return true;
}
export function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && /^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*$/.test(value)
    && !value.split('/').some(p => p === '.' || p === '..') && !/\b(?:password|secret|credential|cookie)\b/i.test(value);
}
export function validateAgentWrite(raw: unknown, op: AgentOperation): { value?: AgentWrite; details: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { details: ['body'] };
  const b = raw as Record<string, unknown>;
  const allowed = new Set(['agentId', 'expectedVersion', ...(op === 'claim' || op === 'renew' ? ['leaseSeconds'] : op === 'release' ? ['diagnosis', 'nextStep'] : ['status', 'diagnosis', 'nextStep', 'remediation', 'filesChanged', 'testsRun'])]);
  const errors: string[] = [];
  // Unknown keys themselves could contain unsafe values: use a fixed field marker.
  if (Object.keys(b).some(k => !allowed.has(k))) errors.push('unknownField');
  if (b.agentId !== 'brian') errors.push('agentId');
  if (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 1 || Number(b.expectedVersion) > 2147483646) errors.push('expectedVersion');
  if (op === 'claim' || op === 'renew') {
    if (!Number.isInteger(b.leaseSeconds) || Number(b.leaseSeconds) < 300 || Number(b.leaseSeconds) > 3600) errors.push('leaseSeconds');
  }
  if (op === 'update' && !['investigating', 'fixed', 'needs-human'].includes(String(b.status))) errors.push('status');
  for (const key of ['diagnosis', 'nextStep', 'remediation']) {
    const required = op === 'update' && (key !== 'remediation' || b.status === 'fixed');
    if ((required || b[key] !== undefined) && !safeAgentText(b[key], key === 'nextStep' ? 300 : 500)) errors.push(key);
  }
  for (const key of ['filesChanged', 'testsRun']) {
    const a = b[key];
    if (op === 'update' && b.status === 'fixed' && a === undefined) errors.push(key);
    if (a !== undefined && (!Array.isArray(a) || a.length > 10 || a.some(v => key === 'filesChanged' ? !safeRelativePath(v) : !safeAgentText(v, 100)))) errors.push(key);
  }
  return errors.length ? { details: [...new Set(errors)].slice(0, 12) } : { value: b as unknown as AgentWrite, details: [] };
}
