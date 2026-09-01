// One-time contract approvals — the pure half. Ported verbatim from TRU OS's
// contractApprovalCore.mjs (typed, logic untouched). An approval is scoped to
// one actor, one action, one envelope, one immutable version, once, and every
// refusal carries its exact reason.

const ACTIONS = new Set(['send', 'void']);

export interface ApprovalScope {
  actorId: string;
  action: string;
  envelopeId: string;
  version: string;
}

export interface ApprovalRecord extends ApprovalScope {
  token: string;
  status: 'issued' | 'consumed';
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((key) => [key, canonical(obj[key])]));
  }
  return value;
}

export async function fingerprintEnvelope(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function validateScope(scope: Partial<ApprovalScope> | null | undefined): ApprovalScope {
  const actorId = required(scope?.actorId, 'actorId');
  const action = required(scope?.action, 'action');
  if (!ACTIONS.has(action)) throw new Error('action must be send or void.');
  return {
    actorId,
    action,
    envelopeId: required(scope?.envelopeId, 'envelopeId'),
    version: required(scope?.version, 'version'),
  };
}

export function issueApprovalRecord(
  scope: Partial<ApprovalScope> | null | undefined,
  token: string,
  now: number,
  ttlMs: number,
): ApprovalRecord {
  const normalized = validateScope(scope);
  const cleanToken = required(token, 'token');
  if (!Number.isFinite(now)) throw new Error('now is required.');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be positive.');
  return {
    ...normalized,
    token: cleanToken,
    status: 'issued',
    issuedAt: now,
    expiresAt: now + ttlMs,
    consumedAt: null,
  };
}

export type ConsumeResult =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; reason: 'not_found' | 'already_consumed' | 'invalid_status' | 'expired' | 'token_mismatch' | 'actor_mismatch' | 'action_mismatch' | 'envelope_mismatch' | 'version_mismatch' };

export function consumeApprovalRecord(
  record: ApprovalRecord | null | undefined,
  attempt: Partial<ApprovalRecord> | null | undefined,
  now: number,
): ConsumeResult {
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.status === 'consumed') return { ok: false, reason: 'already_consumed' };
  if (record.status !== 'issued') return { ok: false, reason: 'invalid_status' };
  if (!Number.isFinite(now) || now > record.expiresAt) return { ok: false, reason: 'expired' };
  if (attempt?.token !== record.token) return { ok: false, reason: 'token_mismatch' };
  if (attempt?.actorId !== record.actorId) return { ok: false, reason: 'actor_mismatch' };
  if (attempt?.action !== record.action) return { ok: false, reason: 'action_mismatch' };
  if (attempt?.envelopeId !== record.envelopeId) return { ok: false, reason: 'envelope_mismatch' };
  if (attempt?.version !== record.version) return { ok: false, reason: 'version_mismatch' };
  return { ok: true, record: { ...record, status: 'consumed', consumedAt: now } };
}
