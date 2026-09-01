// The Contracts admin surface — ported from TRU OS's contracts routes onto
// this worker's /admin/ gate. Everything here is a control panel over
// TruSign (the separate signing app): templates, drafts, review, and the
// two irreversible actions.
//
// The approval discipline is kept intact because it is the whole point:
// an authenticated POST is not itself approval. Sending or voiding requires
// a one-time token from the ContractApprovalLedger Durable Object, scoped to
// this actor, this action, this envelope, and the exact version that was on
// screen when Eric approved — and TruSign then requires its OWN native
// one-time token on top. Four layers, all of which must pass.
//
// Deliberately not ported: the delegate path (Cortana → local drafting
// agent). It depends on TRU OS's Hermes bus and an Ollama daemon on Eric's
// desk; if it moves, it moves as its own piece.

import type { Env } from './env.js';
import type { Db } from './db.js';
import * as trusign from './trusign.js';

type Json = (body: unknown, status?: number) => Response;

const APPROVAL_REQUIRED = trusign.requiresApproval;

function canPerform(action: 'send' | 'void', status: string): boolean {
  return action === 'send' ? status === 'draft' : status === 'draft' || status === 'sent';
}

function approvalLedger(env: Env, actorId: string): DurableObjectStub {
  return env.CONTRACT_APPROVALS.get(env.CONTRACT_APPROVALS.idFromName(`contracts:${actorId}`));
}

async function callLedger(env: Env, actorId: string, path: 'issue' | 'consume', body: unknown): Promise<Response> {
  return approvalLedger(env, actorId).fetch(`https://contract-approvals/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface ContractDraft {
  id: string;
  agentId: string;
  title: string;
  summary: string;
  draftText: string;
  envelopeId: string | null;
  createdAt: string;
  state: 'prepared';
  request: Omit<trusign.ContractDraftInput, 'draftText' | 'summary'>;
  review: trusign.EnvelopeReview;
}

function normalizeDraftInput(payload: any): trusign.ContractDraftInput {
  const required = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
    return value.trim();
  };
  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  if (!recipients.length) throw new Error('At least one recipient is required.');
  if (recipients.length > 4) throw new Error('At most four recipients can be prepared automatically.');
  const normalizedRecipients: trusign.ContractRecipientInput[] = recipients.map((recipient: any) => {
    const email = required(recipient?.email, 'Recipient email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid recipient email: ${email}`);
    const role = recipient?.role || 'signer';
    if (!['signer', 'cc', 'approver'].includes(role)) throw new Error(`Invalid recipient role: ${role}`);
    return { name: required(recipient?.name, 'Recipient name'), email, role } as trusign.ContractRecipientInput;
  });
  if (!normalizedRecipients.some((recipient) => recipient.role === 'signer' || recipient.role === 'approver')) {
    throw new Error('At least one signer or approver is required.');
  }
  const durationDays = payload?.durationDays == null || payload.durationDays === '' ? null : Number(payload.durationDays);
  if (durationDays != null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) {
    throw new Error('Duration must be a whole number from 1 to 3650 days.');
  }
  const rawFields = payload?.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields) ? payload.fields : {};
  const fields = Object.fromEntries(Object.entries(rawFields).map(([key, value]) => [key.trim(), String(value).trim()]).filter(([key]) => key));
  // A template already IS the document: its wording is fixed, and its title
  // comes from the template's own pattern. Only a free-text draft has to
  // carry a title, terms and a body.
  const templateId = typeof payload?.templateId === 'string' && payload.templateId.trim() ? payload.templateId.trim() : null;
  const optional = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return {
    title: templateId ? optional(payload?.title) : required(payload?.title, 'Title'),
    client: required(payload?.client, 'Client'),
    team: typeof payload?.team === 'string' && payload.team.trim() ? payload.team.trim() : null,
    contractType: required(payload?.contractType, 'Contract type'),
    templateId,
    durationDays,
    terms: templateId ? optional(payload?.terms) : required(payload?.terms, 'Terms'),
    fields,
    recipients: normalizedRecipients,
    summary: required(payload?.summary, 'Summary'),
    draftText: templateId ? optional(payload?.draftText) : required(payload?.draftText, 'Draft text'),
  };
}

// Prepared drafts live in the SESSIONS KV under their own prefix (this worker
// has one KV namespace; the keys can't collide with sessions or rate limits).
// 30-day TTL — a draft nobody sent in a month is stale by definition.
const DRAFT_TTL = 30 * 24 * 60 * 60;

async function listDrafts(env: Env): Promise<ContractDraft[]> {
  const listed = await env.SESSIONS.list({ prefix: 'contract:draft:' });
  const drafts = await Promise.all(listed.keys.map((key) => env.SESSIONS.get(key.name, 'json') as Promise<ContractDraft | null>));
  return drafts.filter((draft): draft is ContractDraft => !!draft).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The whole tab in one read — mirrors TRU OS's buildContractsSnapshot().
// Never throws; a broken credential renders as an honest not-connected state.
export async function buildContractsOverview(env: Env): Promise<Record<string, unknown>> {
  try {
    const writeConnected = await trusign.isWriteConnected(env);
    const approvalConnected = writeConnected && !!env.CONTRACT_APPROVALS;
    const drafts = await listDrafts(env).catch(() => []);
    const approvalState = {
      approvalConnected,
      requiresApproval: approvalConnected ? null : APPROVAL_REQUIRED,
    };
    if (!trusign.isConfigured(env)) {
      return { connected: false, requires: trusign.requires, envelopes: [], drafts, writeConnected, requiresWrite: trusign.requiresWrite, ...approvalState };
    }
    const read = await trusign.fetchEnvelopes(env);
    if (!read) {
      return { connected: false, requires: trusign.requires, envelopes: [], drafts, writeConnected, requiresWrite: trusign.requiresWrite, ...approvalState };
    }
    return {
      connected: true,
      requires: null,
      envelopes: read.envelopes,
      drafts,
      keyKind: read.keyKind,
      writeConnected,
      requiresWrite: writeConnected ? null : trusign.requiresWrite,
      ...approvalState,
    };
  } catch (err) {
    console.warn('[contracts] overview failed:', (err as Error).message);
    return { connected: false, requires: trusign.requires, envelopes: [], drafts: [], writeConnected: false, requiresWrite: trusign.requiresWrite, approvalConnected: false, requiresApproval: APPROVAL_REQUIRED };
  }
}

export async function handleContractsRoutes(
  req: Request,
  env: Env,
  url: URL,
  { userId, json }: { userId: string; database: Db; json: Json },
): Promise<Response | null> {
  if (!url.pathname.startsWith('/admin/contracts/')) return null;
  const path = url.pathname.slice('/admin/contracts'.length);

  if (path === '/overview' && req.method === 'GET') {
    return json(await buildContractsOverview(env));
  }

  // The template picker's two reads: what can be stamped out, and which
  // blanks one template needs filled.
  if (path === '/templates' && req.method === 'GET') {
    const templateId = url.searchParams.get('templateId');
    if (templateId) {
      const template = await trusign.fetchTemplate(env, templateId);
      if (!template) return json({ error: 'That template could not be read, or TruSign is not connected.' }, 502);
      return json({ template });
    }
    const templates = await trusign.fetchTemplates(env);
    if (!templates) return json({ error: 'TruSign template access is not connected.', requires: trusign.requiresWrite }, 502);
    return json({ templates });
  }

  if (path === '/review' && req.method === 'GET') {
    const envelopeId = url.searchParams.get('envelopeId');
    if (!envelopeId) return json({ error: 'No envelope specified.' }, 422);
    const envelope = await trusign.fetchEnvelopeForReview(env, envelopeId);
    if (!envelope) return json({ error: 'Envelope not found or TruSign is not connected.' }, 502);
    return json({ envelope });
  }

  if (path === '/prepare' && req.method === 'POST') {
    const payload = (await req.json().catch(() => ({}))) as any;
    try {
      const requestId = typeof payload.requestId === 'string' && payload.requestId.trim() ? payload.requestId.trim() : crypto.randomUUID();
      const requestKey = `contract:draft-request:${userId}:${requestId}`;
      const existingId = await env.SESSIONS.get(requestKey);
      if (existingId) {
        const existing = (await env.SESSIONS.get(`contract:draft:${existingId}`, 'json')) as ContractDraft | null;
        if (existing) return json({ ok: true, id: existing.id, envelope: existing.review, idempotent: true });
      }
      const input = normalizeDraftInput(payload);
      const review = await trusign.prepareEnvelopeDraft(env, input);
      const id = crypto.randomUUID();
      const { draftText, summary, ...request } = input;
      const draft: ContractDraft = {
        id,
        agentId: userId,
        title: input.title,
        summary,
        draftText,
        envelopeId: review.id,
        createdAt: new Date().toISOString(),
        state: 'prepared',
        request,
        review,
      };
      await env.SESSIONS.put(`contract:draft:${id}`, JSON.stringify(draft), { expirationTtl: DRAFT_TTL });
      await env.SESSIONS.put(requestKey, id, { expirationTtl: DRAFT_TTL });
      return json({ ok: true, id, envelope: review });
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }

  if (path === '/approvals' && req.method === 'POST') {
    const payload = (await req.json().catch(() => ({}))) as { action?: 'send' | 'void'; envelopeId?: string; version?: string };
    if (!payload.action || !payload.envelopeId || !payload.version) return json({ error: 'Incomplete approval scope.' }, 422);
    const envelope = await trusign.fetchEnvelopeForReview(env, payload.envelopeId);
    if (!envelope || envelope.version !== payload.version) return json({ error: 'Envelope changed — review it again before approving.' }, 409);
    if (!canPerform(payload.action, envelope.status)) return json({ error: `${payload.action.toUpperCase()} is not allowed for a ${envelope.status} envelope.` }, 409);
    const ledgerResponse = await callLedger(env, userId, 'issue', {
      actorId: userId,
      action: payload.action,
      envelopeId: payload.envelopeId,
      version: payload.version,
    });
    /* Re-emit through the caller's json() rather than passing the Durable
     * Object's response straight through: the DO's headers carry no CORS,
     * so the browser refused to READ a perfectly good approval — the token
     * was issued, the page said "could not reach the server", and the void
     * never fired. Found live on the first ZZ TEST void. */
    const issued = await ledgerResponse.json().catch(() => ({ error: 'The approval could not be issued.' }));
    return json(issued, ledgerResponse.status);
  }

  if (path === '/send' && req.method === 'POST') {
    return handleApprovedMutation(req, env, userId, 'send', json);
  }

  if (path === '/void' && req.method === 'POST') {
    return handleApprovedMutation(req, env, userId, 'void', json);
  }

  return json({ error: 'not found' }, 404);
}

async function handleApprovedMutation(
  req: Request,
  env: Env,
  userId: string,
  action: 'send' | 'void',
  json: Json,
): Promise<Response> {
  const payload = (await req.json().catch(() => ({}))) as { envelopeId?: string; version?: string; approvalToken?: string };
  if (!payload.envelopeId || !payload.version || !payload.approvalToken) return json({ error: APPROVAL_REQUIRED }, 422);

  const envelope = await trusign.fetchEnvelopeForReview(env, payload.envelopeId);
  if (!envelope || envelope.version !== payload.version) return json({ error: 'Envelope changed — approval was not consumed. Review it again.' }, 409);
  if (!canPerform(action, envelope.status)) return json({ error: `${action.toUpperCase()} is not allowed for a ${envelope.status} envelope.` }, 409);

  const ledgerResponse = await callLedger(env, userId, 'consume', {
    token: payload.approvalToken,
    actorId: userId,
    action,
    envelopeId: payload.envelopeId,
    version: payload.version,
  });
  if (!ledgerResponse.ok) return json({ error: 'Approval is invalid, expired, already used, or scoped to different contract state.' }, 409);

  try {
    const result = await trusign.executeApprovedEnvelope(env, {
      actorId: userId,
      action,
      envelopeId: payload.envelopeId,
      version: payload.version,
    });
    return json({
      message: action === 'send'
        ? `Sent "${envelope.title}"${result.notified != null ? ` — ${result.notified} recipient(s) notified` : ''}.`
        : `Voided "${envelope.title}".`,
    });
  } catch (err) {
    return json({ error: `${(err as Error).message} Approval was consumed; review again before retrying.` }, 502);
  }
}
