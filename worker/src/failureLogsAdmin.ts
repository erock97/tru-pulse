// Admin-only Failure Logs surface. GET lists fingerprint-grouped problems with
// the latest incident's full plain-language detail attached; PATCH updates one
// problem's resolution status/notes. Mounted inside index.ts's `/admin/` block,
// so it inherits the `admins`-table gate already applied there — this file
// assumes the caller is already authorized.
import type { Db } from './db.js';
import { FAILURE_LOG_STATUSES } from '../../shared/runEvents.js';

const SEVERITIES: ReadonlySet<string> = new Set(['nonfatal', 'fatal']);

interface IncidentRow {
  incident_id: string; batch_id: string; account_id: string; occurred_at: string; scope: string; code: string;
  explanation: string; impact: string; next_step: string; action: string;
  continued: boolean; position: number | null; total: number | null; technical: unknown;
}
interface ProblemRow {
  fingerprint: string; title: string; stage: string; severity: string;
  first_seen: string; last_seen: string; occurrence_count: number;
  affected_batch_ids: string[]; affected_account_ids: string[];
  status: string; resolution_notes: string | null; latest_incident_id: string;
}

function mapIncident(i: IncidentRow) {
  return {
    incidentId: i.incident_id,
    batchId: i.batch_id,
    accountId: i.account_id,
    occurredAt: i.occurred_at,
    scope: i.scope,
    code: i.code,
    explanation: i.explanation,
    impact: i.impact,
    nextStep: i.next_step,
    action: i.action,
    continued: i.continued,
    position: i.position,
    total: i.total,
    technical: i.technical,
  };
}

async function listFailureLogs(
  url: URL, database: Db, json: (b: unknown, s?: number) => Response,
): Promise<Response> {
  const filters: string[] = [];

  const status = url.searchParams.get('status');
  if (status) {
    if (!FAILURE_LOG_STATUSES.has(status)) return json({ error: 'invalid status filter' }, 422);
    filters.push(`status=eq.${status}`);
  }
  const severity = url.searchParams.get('severity');
  if (severity) {
    if (!SEVERITIES.has(severity)) return json({ error: 'invalid severity filter' }, 422);
    filters.push(`severity=eq.${severity}`);
  }
  const stage = url.searchParams.get('stage');
  if (stage) filters.push(`stage=eq.${encodeURIComponent(stage)}`);
  const accountId = url.searchParams.get('accountId');
  if (accountId && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(accountId)) return json({ error: 'invalid account filter' }, 422);
  if (accountId) filters.push(`affected_account_ids=cs.{${encodeURIComponent(accountId)}}`);
  const since = url.searchParams.get('since');
  if (since) {
    if (Number.isNaN(Date.parse(since))) return json({ error: 'invalid since' }, 422);
    filters.push(`last_seen=gte.${encodeURIComponent(since)}`);
  }
  const until = url.searchParams.get('until');
  if (until) {
    if (Number.isNaN(Date.parse(until))) return json({ error: 'invalid until' }, 422);
    filters.push(`last_seen=lte.${encodeURIComponent(until)}`);
  }
  const recurring = url.searchParams.get('recurring');
  if (recurring === '1') filters.push('occurrence_count=gt.1');
  if (recurring === '0') filters.push('occurrence_count=eq.1');

  const query = [...filters, 'select=*', 'order=last_seen.desc', 'limit=500'].join('&');
  const problems = await database.select('coach_run_event_problems', query) as ProblemRow[];

  const latestIds = [...new Set(problems.map((p) => p.latest_incident_id))];
  const incidents = latestIds.length
    ? await database.select('coach_run_event_incidents', `incident_id=in.(${latestIds.join(',')})&select=*`) as IncidentRow[]
    : [];
  const byId = new Map(incidents.map((i) => [i.incident_id, i]));

  return json({
    problems: problems.map((p) => ({
      fingerprint: p.fingerprint,
      title: p.title,
      stage: p.stage,
      severity: p.severity,
      status: p.status,
      resolutionNotes: p.resolution_notes,
      firstSeen: p.first_seen,
      lastSeen: p.last_seen,
      occurrenceCount: p.occurrence_count,
      affectedBatchIds: p.affected_batch_ids,
      affectedAccountIds: p.affected_account_ids,
      latest: byId.has(p.latest_incident_id) ? mapIncident(byId.get(p.latest_incident_id)!) : null,
    })),
  });
}

async function updateFailureLog(
  req: Request, database: Db, json: (b: unknown, s?: number) => Response,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { fingerprint?: string; status?: string; notes?: string } | null;
  const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint.trim() : '';
  if (fingerprint && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(fingerprint)) return json({ error: 'invalid fingerprint' }, 422);
  if (!fingerprint) return json({ error: 'fingerprint required' }, 422);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.status !== undefined) {
    if (!FAILURE_LOG_STATUSES.has(body.status)) {
      return json({ error: `status must be one of: ${[...FAILURE_LOG_STATUSES].join(', ')}` }, 422);
    }
    patch.status = body.status;
  }
  if (body?.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > 2000) return json({ error: 'notes must be at most 2000 characters' }, 422);
    patch.resolution_notes = body.notes;
  }
  if (Object.keys(patch).length === 1) return json({ error: 'nothing to update' }, 422);

  const existing = await database.select(
    'coach_run_event_problems', `fingerprint=eq.${encodeURIComponent(fingerprint)}&select=fingerprint&limit=1`,
  );
  if (!existing.length) return json({ error: 'not found' }, 404);

  await database.update('coach_run_event_problems', `fingerprint=eq.${encodeURIComponent(fingerprint)}`, patch);
  return json({ ok: true });
}

export async function handleFailureLogsRoutes(
  req: Request,
  url: URL,
  database: Db,
  json: (body: unknown, status?: number) => Response,
): Promise<Response | null> {
  if (url.pathname !== '/admin/failure-logs') return null;
  if (req.method === 'GET') return listFailureLogs(url, database, json);
  if (req.method === 'PATCH') return updateFailureLog(req, database, json);
  return json({ error: 'method not allowed' }, 405);
}
