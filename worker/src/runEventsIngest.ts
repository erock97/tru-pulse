// POST /coach/run-events — the Hermes laptop's sanitized failure-log push. Same
// door and secret as the coaching brief (COACH_INGEST_TOKEN, never ADMIN_TOKEN):
// a leaked ingest key can report pipeline incidents and nothing else. The
// admin-only Failure Logs tab (see failureLogsAdmin.ts) reads what lands here.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
import { validateRunEventsPush } from '../../shared/runEvents.js';

const MAX_BODY_BYTES = 1_000_000;

export async function handleRunEventsIngest(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  database: Db,
): Promise<Response | null> {
  if (url.pathname !== '/coach/run-events') return null;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors },
  });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Fail closed: an unset COACH_INGEST_TOKEN must never make ingest public.
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? ''; 
  if (!env.COACH_INGEST_TOKEN || !secretsMatch(token, env.COACH_INGEST_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'application/json required' }, 415);
  const reader = req.body?.getReader();
  let raw = '';
  let bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return json({ error: 'payload too large' }, 413); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } catch { return json({ error: 'invalid request body' }, 422); }
  finally { reader?.releaseLock(); }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 4xx on anything malformed, so the laptop's retry loop stops rather than
    // spins — same rule as the coach brief and Zillow ingests. Never log the
    // raw body: this route exists so a human never has to read one.
    return json({ error: 'body is not valid JSON' }, 422);
  }
  const v = validateRunEventsPush(parsed);
  if (!v.ok) return json({ error: 'invalid payload', details: v.errors }, 422);
  const push = v.push;

  try {
    const result = await database.rpc('ingest_coach_run_events', { p_push: push });
    return json({ ok: true, batchId: push.batchId, incidentsReceived: push.incidents.length, incidentsNew: result.incidentsNew });
  } catch {
    // Database errors can contain row values; never echo or log them.
    return json({ error: 'incident storage unavailable' }, 503);
  }
}

