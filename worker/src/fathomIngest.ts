// POST /fathom/webhook — Fathom's notetaker pushes a finished meeting here
// (summary + action items + transcript) the moment processing ends. We match
// which agent the 1:1 was with by invitee email, distill the notes into the
// shape the "Run this 1:1" form captures (wins / commitments / private note),
// and store a meeting_preps row the Coach drill-in offers as a pre-fill.
//
// This route NEVER logs a 1:1 — a check-in only exists when a leader presses
// "Log this 1:1". A prep is a suggestion sitting in a leader-only table.
//
// Authenticity is Fathom's webhook signature (HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` with the whsec_ secret, Svix-style), not a
// bearer token: the URL is registered in Fathom's settings where it can be
// read back, so the URL itself must carry no secret. Fail closed when
// FATHOM_WEBHOOK_SECRET is unset.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
import * as infisical from './infisical.js';

export const FATHOM_SECRETS_PATH = '/Fathom';

/** Vault first (mirrors stripeClient.getKey: rotate in Infisical, no deploy,
 *  no wrangler paste), env var as the fallback. Null = the ingest stays
 *  closed. */
export async function getWebhookSecret(env: Env): Promise<string | null> {
  if (infisical.isConfigured(env)) {
    const fromVault = await infisical.getSecret(env, 'FATHOM_WEBHOOK_SECRET', FATHOM_SECRETS_PATH).catch(() => null);
    if (fromVault) return fromVault;
  }
  return env.FATHOM_WEBHOOK_SECRET || null;
}

const MAX_BODY_BYTES = 8_000_000;
// Enough transcript for any real 1:1; a marathon recording gets truncated
// rather than blowing the model call. (~150k chars ≈ 40k tokens.)
const MAX_TRANSCRIPT_CHARS = 150_000;
const DISTILL_MODEL = 'claude-sonnet-5';

/* ── Fathom's payload (the fields we use; see developers.fathom.ai) ───────── */
interface FathomSpeaker { display_name?: string; matched_calendar_invitee_email?: string | null }
interface FathomTranscriptLine { speaker?: FathomSpeaker; text?: string; timestamp?: string }
interface FathomActionItem {
  description?: string;
  completed?: boolean;
  assignee?: { name?: string; email?: string | null };
}
interface FathomInvitee { name?: string; email?: string | null; is_external?: boolean }
export interface FathomMeeting {
  title?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  scheduled_start_time?: string;
  transcript?: FathomTranscriptLine[];
  default_summary?: { markdown_formatted?: string };
  action_items?: FathomActionItem[];
  calendar_invitees?: FathomInvitee[];
  recorded_by?: { name?: string; email?: string };
}

/* ── Signature verification (Fathom docs, "Verifying Webhooks") ───────────── */
export async function verifyFathomSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !ts || !sigHeader) return false;

  // Replay window: 5 minutes either side, per Fathom's own guidance.
  const timestamp = parseInt(ts, 10);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  // The key is the base64 payload AFTER the whsec_ prefix, decoded to bytes.
  const b64 = secret.includes('_') ? secret.slice(secret.indexOf('_') + 1) : secret;
  let keyBytes: Uint8Array;
  try {
    const bin = atob(b64);
    keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  ));
  let expected = '';
  for (const b of signed) expected += String.fromCharCode(b);
  expected = btoa(expected);

  // Header may carry several space-delimited `v1,<sig>` entries.
  return sigHeader.split(' ').some((entry) => {
    const parts = entry.split(',');
    const candidate = parts.length > 1 ? parts.slice(1).join(',') : parts[0];
    return secretsMatch(expected, candidate);
  });
}

/* ── Agent matching ───────────────────────────────────────────────────────── */
// PostgREST `or=(...)` treats commas/parens as syntax, so an address carrying
// one can't be filtered safely — skip it rather than build a broken filter.
const SAFE_EMAIL_RE = /^[^,()\s"]+@[^,()\s"]+$/;

export interface MatchedAgent { id: string; org_id: string; team_id: string; name: string; email: string }

/** The invitees who could be the agent: everyone except whoever recorded. */
export function candidateEmails(meeting: FathomMeeting): string[] {
  const recorder = (meeting.recorded_by?.email ?? '').toLowerCase();
  const seen = new Set<string>();
  for (const inv of meeting.calendar_invitees ?? []) {
    const email = (inv.email ?? '').trim().toLowerCase();
    if (!email || email === recorder || !SAFE_EMAIL_RE.test(email)) continue;
    seen.add(email);
  }
  return [...seen];
}

/** Exactly-one rule: one invitee matching one coached agent is a 1:1; two or
 *  more matches is a team meeting (no prefill target); zero is unmatched.
 *  Only `role = agent` rows count: team leads and admins live in the same
 *  table and sit on most 1:1 invites (a leader running the meeting), and
 *  they are never the person being coached. */
export async function matchAgent(database: Db, emails: string[]): Promise<MatchedAgent | null> {
  if (emails.length === 0) return null;
  const filter = emails.map((e) => `email.ilike.${e}`).join(',');
  const rows = await database.select(
    'agents', `select=id,org_id,team_id,name,email&excluded=eq.false&role=eq.agent&or=(${filter})`,
  ) as MatchedAgent[];
  // Same person can exist on two teams (re-provisioned) — dedupe by email
  // first, and only call it a 1:1 when ONE distinct person matched.
  const byEmail = new Map<string, MatchedAgent[]>();
  for (const r of rows) {
    const k = (r.email ?? '').toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), r]);
  }
  if (byEmail.size !== 1) return null;
  const same = [...byEmail.values()][0];
  // One person, several agent rows: ambiguous, don't guess a team.
  return same.length === 1 ? same[0] : null;
}

/* ── Distillation ─────────────────────────────────────────────────────────── */
export interface Distilled { wins: string[]; commitments: string[]; private_note: string }

export function transcriptText(meeting: FathomMeeting): string {
  const lines = (meeting.transcript ?? [])
    .map((l) => `${l.speaker?.display_name ?? 'Speaker'}: ${(l.text ?? '').trim()}`)
    .filter((l) => l.length > 0);
  const joined = lines.join('\n');
  return joined.length > MAX_TRANSCRIPT_CHARS ? joined.slice(0, MAX_TRANSCRIPT_CHARS) : joined;
}

// EXTRACTION ONLY, by design: this prompt pulls out what was actually said in
// the meeting. It must never judge the conversation, score the agent, or add
// coaching advice of its own — that is doctrine territory (docs/SALES_DOCTRINE.md)
// and it belongs to the leader running the 1:1, not to this pipeline.
export function distillPrompt(meeting: FathomMeeting, agentName: string): string {
  const summary = meeting.default_summary?.markdown_formatted ?? '(none)';
  const actions = (meeting.action_items ?? [])
    .map((a) => `- ${a.description ?? ''}${a.assignee?.name ? ` (assignee: ${a.assignee.name})` : ''}`)
    .join('\n') || '(none)';
  const transcript = transcriptText(meeting) || '(no transcript)';
  return [
    `A real-estate team leader just finished a one-on-one coaching meeting with their agent, ${agentName}. Below are the meeting notes from the recording tool. Extract ONLY what was actually said — do not invent, judge, or add advice.`,
    '',
    'Return ONLY a JSON object with exactly these keys:',
    `- "wins": array of short strings — specific things ${agentName} did well that were discussed (exact behaviors, not generic praise). Empty array if none came up.`,
    `- "commitments": array of short strings — the specific actions ${agentName} agreed to do before the next meeting, kept in the agent's own phrasing where possible, specific and countable when stated (e.g. "20 sphere conversations by Friday"). Only actions belonging to ${agentName}, not the leader. Empty array if none.`,
    `- "private_note": one short string for the leader's private record — context worth remembering that should NOT be shown to ${agentName} (personal circumstances mentioned, concerns the leader raised, confidence signals). Empty string if nothing qualifies.`,
    '',
    `Meeting title: ${meeting.title ?? meeting.meeting_title ?? '(untitled)'}`,
    '',
    `Recording tool's summary:\n${summary}`,
    '',
    `Recording tool's action items:\n${actions}`,
    '',
    `Transcript:\n${transcript}`,
  ].join('\n');
}

export function parseDistilled(raw: string): Distilled | null {
  // The model is asked for bare JSON but may fence it — take the first {...}.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<Distilled>;
    const strings = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : [];
    return {
      wins: strings(obj.wins),
      commitments: strings(obj.commitments),
      private_note: typeof obj.private_note === 'string' ? obj.private_note.trim() : '',
    };
  } catch {
    return null;
  }
}

async function callClaude(env: Env, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DISTILL_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

/** Runs after the webhook is ACKed (ctx.waitUntil): distill and stamp the row.
 *  A failure writes distill_error — the UI then shows Fathom's raw summary
 *  instead of pretending, and a Fathom redelivery retries the distill. */
export async function distillAndStore(
  env: Env, database: Db, prepId: string, meeting: FathomMeeting, agentName: string,
): Promise<void> {
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY unset');
    const distilled = parseDistilled(await callClaude(env, distillPrompt(meeting, agentName)));
    if (!distilled) throw new Error('model returned no parseable JSON');
    await database.update('meeting_preps', `id=eq.${prepId}`, {
      distilled, distill_error: null, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`fathom distill failed for prep ${prepId}:`, e);
    try {
      await database.update('meeting_preps', `id=eq.${prepId}`, {
        distill_error: e instanceof Error ? e.message : String(e),
        updated_at: new Date().toISOString(),
      });
    } catch { /* the row keeps distilled=null; a redelivery retries */ }
  }
}

/* ── The route ────────────────────────────────────────────────────────────── */
export async function handleFathomIngest(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  database: Db,
  ctx: ExecutionContext,
): Promise<Response | null> {
  if (url.pathname !== '/fathom/webhook') return null;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors },
  });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Fail closed: no secret in the vault or the env means the ingest is shut.
  const secret = await getWebhookSecret(env);
  if (!secret) return json({ error: 'unauthorized' }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413);
  if (!(await verifyFathomSignature(secret, req.headers, raw))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let meeting: FathomMeeting;
  try {
    meeting = JSON.parse(raw) as FathomMeeting;
  } catch {
    // 4xx so Fathom's retry loop stops rather than spins.
    return json({ error: 'body is not valid JSON' }, 422);
  }

  const dedupeKey = meeting.share_url || meeting.url || req.headers.get('webhook-id') || '';
  if (!dedupeKey) return json({ error: 'no meeting identity in payload' }, 422);

  // Redelivery of a meeting we already hold: never a duplicate row. If the
  // earlier distill died, this delivery is its retry.
  const existing = await database.select(
    'meeting_preps', `select=id,agent_id,distilled&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&limit=1`,
  ) as Array<{ id: string; agent_id: string | null; distilled: unknown }>;
  if (existing[0]) {
    if (existing[0].agent_id && !existing[0].distilled) {
      const agents = await database.select(
        'agents', `select=name&id=eq.${existing[0].agent_id}&limit=1`,
      ) as Array<{ name: string }>;
      ctx.waitUntil(distillAndStore(env, database, existing[0].id, meeting, agents[0]?.name ?? 'the agent'));
    }
    return json({ ok: true, duplicate: true });
  }

  const agent = await matchAgent(database, candidateEmails(meeting));

  const row = await database.insert('meeting_preps', {
    org_id: agent?.org_id ?? null,
    team_id: agent?.team_id ?? null,
    agent_id: agent?.id ?? null,
    source: 'fathom',
    dedupe_key: dedupeKey,
    title: meeting.title ?? meeting.meeting_title ?? null,
    recorded_by_email: meeting.recorded_by?.email ?? null,
    meeting_start: meeting.recording_start_time ?? meeting.scheduled_start_time ?? null,
    meeting_end: meeting.recording_end_time ?? null,
    invitees: (meeting.calendar_invitees ?? []).map((i) => ({
      name: i.name ?? null, email: i.email ?? null, is_external: i.is_external ?? null,
    })),
    summary_md: meeting.default_summary?.markdown_formatted ?? null,
    action_items: meeting.action_items ?? [],
  }) as { id: string };

  // ACK now, distill after — Fathom only needs the 2xx, and the model call can
  // outlive the response via waitUntil. Only a matched meeting is distilled:
  // an unmatched one has no 1:1 to pre-fill (the row still exists, so nothing
  // is lost if we later learn who it was).
  if (agent) ctx.waitUntil(distillAndStore(env, database, row.id, meeting, agent.name));

  // The response is Fathom-side only, but it's also the debugging trail:
  // whether we recognized the meeting as a 1:1 and with whom.
  return json({ ok: true, matched: agent ? agent.name : null });
}
