import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
import { validateCoachBrief, matchAgents } from '../../shared/coachBrief.js';
import { canonicalJson, parseReceiptJson, sha256 } from '../../shared/reportReceipt.js';
import { PARTIAL_REPORT_PUBLISHING_ENABLED } from '../../shared/reportCoverage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
type Client = { id: string; tokenHash: string; role: 'producer' | 'operator'; teamIds: string[] };
export async function handleReportReceipts(req: Request, env: Env, url: URL, cors: Record<string, string>, database: Db): Promise<Response | null> {
  const base = '/coach/weekly-report';
  if (![base, base + '/receipt', base + '/control'].includes(url.pathname)) return null;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
  const method = url.pathname.endsWith('/receipt') ? 'GET' : 'POST';
  if (req.method !== method) return json({ error: 'method_not_allowed' }, 405);
  if (method === 'GET' && (url.searchParams.size !== 2 || url.searchParams.getAll('teamId').length !== 1 || url.searchParams.getAll('runId').length !== 1)) return json({ error: 'invalid_lookup' }, 422);
  let clients: Client[];
  try {
    clients = JSON.parse(env.COACH_REPORT_CLIENTS ?? 'null');
    if (!Array.isArray(clients) || !clients.length || clients.some(c => !c || typeof c.id !== 'string' || !ID.test(c.id) || !/^[a-f0-9]{64}$/.test(c.tokenHash) || !['producer','operator'].includes(c.role) || !Array.isArray(c.teamIds) || !c.teamIds.length || c.teamIds.some(t => !UUID.test(t))) || new Set(clients.map(c => c.id)).size !== clients.length || new Set(clients.map(c => c.tokenHash)).size !== clients.length) throw Error();
  } catch { return json({ error: 'receipt_auth_not_configured' }, 503); }
  const token = (req.headers.get('Authorization') ?? '').match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json({ error: 'unauthorized' }, 401);
  const hash = await sha256(token);
  const client = clients.find(c => secretsMatch(c.tokenHash, hash));
  if (!client) return json({ error: 'unauthorized' }, 401);
  if (url.pathname.endsWith('/control') && client.role !== 'operator') return json({ error: 'operator_required' }, 403);
  let input: any;
  if (req.method === 'POST') {
    const reader = req.body?.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }); let size = 0, raw = '';
    try {
      if (reader) while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 4_000_000) { await reader.cancel(); return json({ error: 'payload_too_large' }, 413); } raw += decoder.decode(item.value, { stream: true }); }
      raw += decoder.decode(); input = parseReceiptJson(raw);
    } catch { await reader?.cancel().catch(() => {}); return json({ error: 'invalid_json' }, 422); }
    finally { reader?.releaseLock(); }
  }
  const submitting = url.pathname === base;
  const teamId = submitting ? input?.run?.teamId : method === 'GET' ? url.searchParams.get('teamId') : input?.teamId;
  const runId = submitting ? input?.run?.runId : method === 'GET' ? url.searchParams.get('runId') : input?.runId;
  if (typeof teamId !== 'string' || !UUID.test(teamId) || typeof runId !== 'string' || !ID.test(runId)) return json({ error: 'invalid_identity' }, 422);
  if (!client.teamIds.includes(teamId)) return json({ error: 'team_forbidden' }, 403);
  try {
    if (method === 'GET') {
      const receipt = await database.rpc('coach_receipt_lookup', { p_team: teamId, p_run: runId });
      return receipt ? json({ ok: true, receipt }) : json({ error: 'not_found' }, 404);
    }
    if (submitting) {
      const validated = validateCoachBrief(input);
      if (!validated.ok) return json({ error: 'invalid_payload', details: validated.errors }, 422);
      const roster = await database.select('agents', `team_id=eq.${teamId}&excluded=eq.false&select=id,name`);
      const result = await database.rpc('coach_receipt_accept', { p_team: teamId, p_run: runId, p_canonical: canonicalJson(input), p_payload: validated.brief, p_links: matchAgents(validated.brief.agents.map(a => a.agentName), roster).links, p_actor: client.id });
      return json({ ok: true, ...result }, result.replayed ? 200 : 201);
    }
    const keys = ['operationId','action','teamId','runId','expectedHash','expectedRevision','reason'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['release','withdraw','supersede'].includes(input.action)) return json({ error: 'invalid_control' }, 422);
    if (input.action === 'supersede') keys.push('replacement');
    const validRef = (v: any) => v && typeof v.runId === 'string' && ID.test(v.runId) && typeof v.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(v.expectedHash) && Number.isInteger(v.expectedRevision) && v.expectedRevision >= 1 && v.expectedRevision <= 2147483647;
    if (Object.keys(input).length !== keys.length || !keys.every(k => Object.hasOwn(input,k)) || !ID.test(input.operationId) || typeof input.operationId !== 'string' || !validRef(input) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 || /[\u0000-\u001f\u007f]/.test(input.reason) || (input.action === 'supersede' && (!validRef(input.replacement) || Object.keys(input.replacement).sort().join(',') !== 'expectedHash,expectedRevision,runId'))) return json({ error: 'invalid_control' }, 422);
    const result = await database.rpc('coach_receipt_control', { p_team: teamId, p_actor: client.id, p_command: input, p_canonical: canonicalJson(input), p_allow_partial: PARTIAL_REPORT_PUBLISHING_ENABLED });
    return json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = ['identity_conflict','payload_conflict','legacy_conflict','operation_conflict','revision_conflict','invalid_transition','partial_release_disabled','evidence_conflict'].find(c => message.includes(c));
    if (code) return json({ error: code }, 409);
    if (message.includes('receipt_not_found') || message.includes('team_unavailable')) return json({ error: 'not_found' }, 404);
    // No payload, source excerpt, token or DB diagnostics in public errors/logs.
    return json({ error: 'receipt_transaction_failed' }, 503);
  }
}
