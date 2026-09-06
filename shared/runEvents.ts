// The Hermes laptop's failure-log push — the contract between its local incident
// pipeline (an authenticated POST to /coach/run-events) and the admin-only
// Failure Logs tab. Pure validation only, same reasoning as shared/coachBrief.ts
// and shared/zillowTargets.ts: the Worker (ingest) and the web app (rendering)
// read the same shape and can never drift.
//
// This is deliberately an ALLOWLIST at every level (payload, incident,
// technical). The laptop-side pipeline promises never to send credentials,
// cookies, raw HTML, lead names, message bodies, coaching quotes, or full
// stack traces — but a promise upstream is not a guard here. Any field this
// validator doesn't explicitly recognize is REJECTED, not silently dropped,
// so schema drift on the laptop side surfaces as a 422 instead of quietly
// landing something new in this table.

export type IncidentSeverity = 'nonfatal' | 'fatal';
export type IncidentScope = 'event' | 'contact' | 'team' | 'batch' | 'delivery';
export type FailureLogStatus = 'open' | 'investigating' | 'fixed' | 'needs-human' | 'verified';

export const FAILURE_LOG_STATUSES: ReadonlySet<string> =
  new Set(['open', 'investigating', 'fixed', 'needs-human', 'verified']);

export interface RunEventTechnical {
  stage: string;
  code: string;
  fingerprint: string;
  message: string;
}

export interface RunEventIncident {
  incidentId: string;
  fingerprint: string;
  batchId: string;
  accountId: string;
  occurredAt: string;
  severity: IncidentSeverity;
  scope: IncidentScope;
  stage: string;
  code: string;
  title: string;
  explanation: string;
  impact: string;
  nextStep: string;
  action: string;
  continued: boolean;
  position?: number;
  total?: number;
  technical?: RunEventTechnical;
}

export interface RunEventsPush {
  batchId: string;
  status: string;
  counts: { fatal: number; nonfatal: number };
  incidents: RunEventIncident[];
}

const MAX_INCIDENTS = 200;
const MAX_SHORT = 120;   // code, stage, action, accountId, batchId, incidentId, fingerprint, status
const MAX_TITLE = 200;
const MAX_TEXT = 1000;   // explanation, impact, nextStep
const MAX_TECH_MESSAGE = 1000;

const SEVERITIES: ReadonlySet<string> = new Set(['nonfatal', 'fatal']);
const SCOPES: ReadonlySet<string> = new Set(['event', 'contact', 'team', 'batch', 'delivery']);
// Deliberately no ':' — these ids ride in PostgREST `in.(...)` filters unquoted
// (see runEventsIngest.ts), and this charset needs no URL/filter escaping.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

// Crude but deliberate: this endpoint must never store what the laptop
// promises not to send. These are defense-in-depth, not the only guard — a
// promise upstream is not a control here.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const HTML_RE = /<\s*[a-z][\s\S]*>/i;

function looksUnsafe(s: string): string | null {
  if (/\b(?:bearer\s+\S+|(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|cookie|authorization|client[_ -]?secret)\s*[:=]\s*\S+)|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN .*PRIVATE KEY-----/i.test(s)) return 'contains credential material';
  if (/\b(?:[Ll]ead|[Cc]ontact|[Cc]ustomer)\s+(?:name\s*[:=]|[A-Z][a-z]+\s+[A-Z][a-z]+)|\b(?:transcript|message body|coaching quot(?:e|ation))\s*[:=]|[“”]/.test(s)) return 'contains private contact content';
  if (EMAIL_RE.test(s)) return 'looks like it contains an email address';
  if (PHONE_RE.test(s)) return 'looks like it contains a phone number';
  if (HTML_RE.test(s)) return 'looks like it contains raw HTML';
  if (/Traceback \(most recent call last\)|\n\s*(?:File \"|at )/.test(s)) return 'contains stack trace material';
  const stackFrames = s.match(/^\s*at\s+\S/gm);
  if (stackFrames && stackFrames.length >= 2) return 'looks like a full stack trace';
  return null;
}

type Raw = Record<string, unknown>;
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function extraKeys(o: Raw, allowed: ReadonlySet<string>): string[] {
  return Object.keys(o).filter((k) => !allowed.has(k));
}
function checkField(errors: string[], path: string, value: string, max: number): void {
  if (value.length > max) errors.push(`${path} exceeds ${max} characters`);
  const unsafe = looksUnsafe(value);
  if (unsafe) errors.push(`${path} ${unsafe} — never send credentials, PII, HTML, or stack traces`);
}

const PUSH_KEYS = new Set(['schemaVersion', 'batchId', 'status', 'counts', 'incidents']);
const COUNTS_KEYS = new Set(['fatal', 'nonfatal']);
const INCIDENT_KEYS = new Set([
  'schemaVersion', 'incidentId', 'fingerprint', 'batchId', 'accountId', 'occurredAt',
  'severity', 'scope', 'stage', 'code', 'title', 'explanation', 'impact', 'nextStep',
  'action', 'continued', 'position', 'total', 'technical',
]);
const TECHNICAL_KEYS = new Set(['stage', 'code', 'fingerprint', 'message']);

export type RunEventsValidation =
  | { ok: true; push: RunEventsPush }
  | { ok: false; errors: string[] };

function validateIncident(raw: unknown, i: number, errors: string[]): RunEventIncident | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`incidents[${i}] must be an object`);
    return null;
  }
  const o = raw as Raw;
  if (o.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (extraKeys(o, INCIDENT_KEYS).length) errors.push('unexpected field');

  const incidentId = asString(o.incidentId);
  if (!incidentId || !ID_RE.test(incidentId)) errors.push(`incidents[${i}].incidentId is required`);
  const fingerprint = asString(o.fingerprint);
  if (!fingerprint || !ID_RE.test(fingerprint)) errors.push(`incidents[${i}].fingerprint is required`);
  const batchId = asString(o.batchId);
  if (!batchId || !ID_RE.test(batchId)) errors.push(`incidents[${i}].batchId is required`);
  const accountId = asString(o.accountId);
  if (!accountId || !ID_RE.test(accountId)) errors.push(`incidents[${i}].accountId is required`);
  const occurredAt = asString(o.occurredAt);
  if (!occurredAt || (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(occurredAt) || Number.isNaN(Date.parse(occurredAt)))) errors.push(`incidents[${i}].occurredAt must be a valid timestamp`);
  const severity = asString(o.severity);
  if (!severity || !SEVERITIES.has(severity)) errors.push(`incidents[${i}].severity must be one of: ${[...SEVERITIES].join(', ')}`);
  const scope = asString(o.scope);
  if (!scope || !SCOPES.has(scope)) errors.push(`incidents[${i}].scope must be one of: ${[...SCOPES].join(', ')}`);
  const stage = asString(o.stage);
  if (!stage) errors.push(`incidents[${i}].stage is required`);
  else checkField(errors, `incidents[${i}].stage`, stage, MAX_SHORT);
  const code = asString(o.code);
  if (!code) errors.push(`incidents[${i}].code is required`);
  else checkField(errors, `incidents[${i}].code`, code, MAX_SHORT);
  const title = asString(o.title);
  if (!title) errors.push(`incidents[${i}].title is required`);
  else checkField(errors, `incidents[${i}].title`, title, MAX_TITLE);
  const explanation = asString(o.explanation);
  if (!explanation) errors.push(`incidents[${i}].explanation is required`);
  else checkField(errors, `incidents[${i}].explanation`, explanation, MAX_TEXT);
  const impact = asString(o.impact);
  if (!impact) errors.push(`incidents[${i}].impact is required`);
  else checkField(errors, `incidents[${i}].impact`, impact, MAX_TEXT);
  const nextStep = asString(o.nextStep);
  if (!nextStep) errors.push(`incidents[${i}].nextStep is required`);
  else checkField(errors, `incidents[${i}].nextStep`, nextStep, MAX_TEXT);
  const action = asString(o.action);
  if (!action) errors.push(`incidents[${i}].action is required`);
  else checkField(errors, `incidents[${i}].action`, action, MAX_SHORT);
  if (typeof o.continued !== 'boolean') errors.push(`incidents[${i}].continued must be a boolean`);
  const position = o.position !== undefined ? asFiniteNumber(o.position) : undefined;
  if (o.position !== undefined && (position === undefined || !Number.isInteger(position) || position < 0)) errors.push(`incidents[${i}].position must be a finite number`);
  const total = o.total !== undefined ? asFiniteNumber(o.total) : undefined;
  if (o.total !== undefined && (total === undefined || !Number.isInteger(total) || total < 0)) errors.push(`incidents[${i}].total must be a finite number`);

  if (position !== undefined && total !== undefined && position > total) errors.push('position exceeds total');
  let technical: RunEventTechnical | undefined;
  if (o.technical !== undefined) {
    if (!o.technical || typeof o.technical !== 'object' || Array.isArray(o.technical)) {
      errors.push(`incidents[${i}].technical must be an object`);
    } else {
      const t = o.technical as Raw;
      if (extraKeys(t, TECHNICAL_KEYS).length) errors.push('unexpected field');
      const tMessage = asString(t.message);
      if (!tMessage) errors.push(`incidents[${i}].technical.message is required when technical is present`);
      else checkField(errors, `incidents[${i}].technical.message`, tMessage, MAX_TECH_MESSAGE);
      for (const key of ['stage', 'code', 'fingerprint'] as const) {
        if (t[key] !== o[key]) errors.push('technical identifiers must match incident');
      }
      technical = {
        stage: asString(t.stage) ?? stage ?? '',
        code: asString(t.code) ?? code ?? '',
        fingerprint: asString(t.fingerprint) ?? fingerprint ?? '',
        message: tMessage ?? '',
      };
    }
  }

  if (!incidentId || !fingerprint || !batchId || !accountId || !occurredAt || !severity || !scope
    || !stage || !code || !title || !explanation || !impact || !nextStep || !action
    || typeof o.continued !== 'boolean') {
    return null;
  }
  return {
    incidentId, fingerprint, batchId, accountId, occurredAt,
    severity: severity as IncidentSeverity, scope: scope as IncidentScope,
    stage, code, title, explanation, impact, nextStep, action,
    continued: o.continued as boolean,
    ...(position !== undefined ? { position } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(technical ? { technical } : {}),
  };
}

export function validateRunEventsPush(raw: unknown): RunEventsValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }
  const o = raw as Raw;
  if (o.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (extraKeys(o, PUSH_KEYS).length) errors.push('unexpected field');

  const batchId = asString(o.batchId);
  if (!batchId || !ID_RE.test(batchId)) errors.push('batchId is required');
  const status = asString(o.status);
  if (!status) errors.push('status is required');
  else checkField(errors, 'status', status, MAX_SHORT);

  let counts = { fatal: 0, nonfatal: 0 };
  if (!o.counts || typeof o.counts !== 'object' || Array.isArray(o.counts)) {
    errors.push('counts is required and must be an object');
  } else {
    const c = o.counts as Raw;
    if (extraKeys(c, COUNTS_KEYS).length) errors.push('unexpected field');
    const fatal = asFiniteNumber(c.fatal);
    const nonfatal = asFiniteNumber(c.nonfatal);
    if (fatal === undefined || !Number.isInteger(fatal) || fatal < 0) errors.push('counts.fatal must be a non-negative number');
    if (nonfatal === undefined || !Number.isInteger(nonfatal) || nonfatal < 0) errors.push('counts.nonfatal must be a non-negative number');
    if (fatal !== undefined && nonfatal !== undefined) counts = { fatal, nonfatal };
  }

  const incidentsRaw = Array.isArray(o.incidents) ? o.incidents : null;
  if (!incidentsRaw) errors.push('incidents[] is required');
  if (incidentsRaw && incidentsRaw.length > MAX_INCIDENTS) errors.push(`incidents[] exceeds ${MAX_INCIDENTS}`);

  const seenIds = new Set<string>();
  const incidents: RunEventIncident[] = (incidentsRaw ?? []).flatMap((r, i) => {
    const incident = validateIncident(r, i, errors);
    if (!incident) return [];
    if (seenIds.has(incident.incidentId)) {
      errors.push(`incidents[${i}].incidentId "${incident.incidentId}" is duplicated within this push`);
      return [];
    }
    if (incident.batchId !== batchId) errors.push('incident batchId must match payload');
    seenIds.add(incident.incidentId);
    return [incident];
  });

  if (counts.fatal < incidents.filter(i => i.severity === 'fatal').length || counts.nonfatal < incidents.filter(i => i.severity === 'nonfatal').length) errors.push('counts must cover incidents');
  if (errors.length) return { ok: false, errors };
  return { ok: true, push: { batchId: batchId as string, status: status as string, counts, incidents } };
}
