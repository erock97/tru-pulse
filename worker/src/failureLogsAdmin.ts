// Admin-only Failure Logs surface. GET lists fingerprint-grouped problems with
// the latest incident's full plain-language detail attached; PATCH updates one
// problem's resolution status/notes. Mounted inside index.ts's `/admin/` block,
// so it inherits the `admins`-table gate already applied there — this file
// assumes the caller is already authorized.
import type { Db } from './db.js';
import { readAgentBody, agentErrorStatus } from './agentRunEvents.js';
import { safeAgentText } from '../../shared/agentRunEvents.js';
import { FAILURE_LOG_STATUSES } from '../../shared/runEvents.js';

const SEVERITIES: ReadonlySet<string> = new Set(['nonfatal', 'fatal']);

interface IncidentRow {
  incident_id: string; batch_id: string; account_id: string; occurred_at: string; scope: string; code: string;
  explanation: string; impact: string; next_step: string; action: string;
  continued: boolean; position: number | null; total: number | null; technical: unknown;
}
interface ProblemRow {
  version: number; claim_agent: string | null; claimed_at: string | null; claim_expires_at: string | null;
  diagnosis: string | null; remediation: string | null; agent_next_step: string | null; files_changed: string[]; tests_run: string[];
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
  const history: any[] = [];
  if (problems.length) for (let offset = 0; ; offset += 1000) {
    const page = await database.select('coach_run_event_history', 'fingerprint=in.(' + problems.map(p => p.fingerprint).join(',') + ')&select=*&order=version.asc,id.asc&limit=1000&offset=' + offset);
    history.push(...page); if (page.length < 1000) break;
  }
  const byId = new Map(incidents.map((i) => [i.incident_id, i]));

  return json({
    problems: problems.map((p) => ({
      version: p.version,
      claim: p.claim_agent ? { agentId: p.claim_agent, claimedAt: p.claimed_at, expiresAt: p.claim_expires_at } : null,
      diagnosis: p.diagnosis, remediation: p.remediation, agentNextStep: p.agent_next_step,
      filesChanged: p.files_changed, testsRun: p.tests_run,
      history: history.filter(h => h.fingerprint === p.fingerprint).map(h => ({
        id: h.id, version: h.version, occurredAt: h.occurred_at, actor: h.actor, operation: h.operation,
        fromStatus: h.from_status, toStatus: h.to_status, detail: h.detail,
      })),
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
  const parsed = await readAgentBody(req);
  if (parsed.code) return json({ ok: false, code: parsed.code, details: ['body'] }, agentErrorStatus(parsed.code));
  const body = parsed.body as Record<string, unknown> | null;
  const details: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ code: 'VALIDATION_ERROR', details: ['body'] }, 422);
  if (Object.keys(body).some(k => !['fingerprint','expectedVersion','status','notes','releaseClaim'].includes(k))) details.push('unknownField');
  if (typeof body.fingerprint !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(body.fingerprint)) details.push('fingerprint');
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<1 || Number(body.expectedVersion)>2147483646) details.push('expectedVersion');
  if (body.status !== undefined && (typeof body.status !== 'string' || !FAILURE_LOG_STATUSES.has(body.status))) details.push('status');
  if (body.notes !== undefined && body.notes !== '' && !safeAgentText(body.notes,500)) details.push('notes');
  if (body.releaseClaim !== undefined && typeof body.releaseClaim !== 'boolean') details.push('releaseClaim');
  if (body.status === undefined && body.notes === undefined && body.releaseClaim !== true) details.push('operation');
  if (details.length) return json({ ok: false, code: 'VALIDATION_ERROR', details },422);
  const result = await database.rpc('coach_admin_mutate', { p_fingerprint: body.fingerprint, p_body: body });
  return json(result, result.code ? agentErrorStatus(result.code) : 200);
}
export async function handleFailureLogsRoutes(req: Request, url: URL, database: Db, json: (body: unknown, status?: number) => Response): Promise<Response | null> {
  if (url.pathname !== '/admin/failure-logs') return null;
  if (req.method === 'GET') return listFailureLogs(url,database,json);
  if (req.method === 'PATCH') return updateFailureLog(req,database,json);
  return json({ error: 'method not allowed' },405);
}