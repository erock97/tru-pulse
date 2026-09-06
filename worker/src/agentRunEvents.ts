import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
import { AGENT_BODY_BYTES, AGENT_ID_RE, validateAgentWrite, type AgentOperation } from '../../shared/agentRunEvents.js';

export async function readAgentBody(req: Request): Promise<{ body?: unknown; code?: string }> {
  if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return { code: 'VALIDATION_ERROR' };
  const reader = req.body?.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let raw = '', bytes = 0;
  try {
    if (reader) for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > AGENT_BODY_BYTES) { await reader.cancel(); return { code: 'PAYLOAD_TOO_LARGE' }; }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
    return { body: JSON.parse(raw) };
  } catch { return { code: 'VALIDATION_ERROR' }; }
  finally { reader?.releaseLock(); }
}
export function agentErrorStatus(code: string): number {
  return ({ UNAUTHORIZED: 401, INCIDENT_NOT_FOUND: 404, CLAIM_CONFLICT: 409, VERSION_CONFLICT: 409,
    CLAIM_EXPIRED: 409, INVALID_STATUS_TRANSITION: 409, PAYLOAD_TOO_LARGE: 413,
    VALIDATION_ERROR: 422, RATE_LIMITED: 429 } as Record<string, number>)[code] ?? 503;
}
export async function handleAgentRunEvents(req: Request, env: Env, url: URL, cors: Record<string, string>, database: Db): Promise<Response | null> {
  if (!url.pathname.startsWith('/coach/run-events/')) return null;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
  const error = (code: string, details?: string[]) => json({ ok: false, error: code, code, ...(details ? { details } : {}) }, agentErrorStatus(code));
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!env.COACH_INGEST_TOKEN || !secretsMatch(token, env.COACH_INGEST_TOKEN)) return error('UNAUTHORIZED');
  const queue = url.pathname === '/coach/run-events/agent-queue';
  const match = /^\/coach\/run-events\/([^/]+)(?:\/claim(?:\/(renew|release))?)?$/.exec(url.pathname);
  if (!queue && (!match || !AGENT_ID_RE.test(match[1]))) return error('INCIDENT_NOT_FOUND');
  const op: AgentOperation = match?.[2] as AgentOperation || (url.pathname.endsWith('/claim') ? 'claim' : 'update');
  if (req.method !== (queue ? 'GET' : op === 'update' ? 'PATCH' : 'POST')) return json({ ok: false, error: 'METHOD_NOT_ALLOWED', code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    if (!await database.rpc('coach_agent_rate_limit', { p_bucket: queue ? 'queue' : 'mutation' })) return error('RATE_LIMITED');
    if (queue) {
      const limit = url.searchParams.get('limit') ?? '1';
      if (!/^[1-5]$/.test(limit) || [...url.searchParams.keys()].some(k => k !== 'limit') || url.searchParams.getAll('limit').length > 1) return error('VALIDATION_ERROR', ['limit']);
      return json({ ok: true, tickets: await database.rpc('coach_agent_queue', { p_limit: Number(limit) }) });
    }
    if (url.search) return error('VALIDATION_ERROR', ['query']);
    const parsed = await readAgentBody(req);
    if (parsed.code) return error(parsed.code, parsed.code === 'VALIDATION_ERROR' ? ['body'] : undefined);
    const validated = validateAgentWrite(parsed.body, op);
    if (!validated.value) {
      const status = (parsed.body as Record<string, unknown> | null)?.status;
      if (op === 'update' && validated.details.length === 1 && validated.details[0] === 'status' && (status === 'open' || status === 'verified')) return error('INVALID_STATUS_TRANSITION');
      return error('VALIDATION_ERROR', validated.details);
    }
    const result = await database.rpc('coach_agent_mutate', { p_incident_id: match![1], p_operation: op, p_body: validated.value });
    return result.code ? error(result.code) : json(result);
  } catch { return error('SERVICE_UNAVAILABLE'); }
}
