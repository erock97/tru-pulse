// TruSign (Contracts) client — ported from TRU Operating System's trusign.ts.
// The backstory it carries forward verbatim:
//
//   * TruSign (Desktop\truhq\sign) is its own Supabase project entirely —
//     not TRU HQ's, not TruTalk's.
//   * READ needs TRUSIGN_SUPABASE_SERVICE_KEY (service_role, SELECT-only
//     here) — a bare anon key reads as 200 + zero rows under TruSign's RLS
//     ('for select to authenticated using (org_id = clerk_org_id())'),
//     which must NEVER be reported as "TruSign has zero contracts".
//   * WRITE (send/void) does NOT touch TruSign's Supabase directly — it goes
//     through TruSign's OWN Worker API (POST /api/envelopes/:id/send|void),
//     which does real validation + Clerk identity snapshot + Resend email
//     dispatch server-side. Auth is the durable TRUSIGN_JARVIS_M2M_KEY sent
//     as the `X-Jarvis-Key` header (TruSign's requireOrg accepts it as a
//     pre-authorized org+user).
//   * One improvement over the TRU OS copy: envelopes.team and client_name
//     now exist live in TruSign (added 2026-08), so the list carries them
//     and the team filter can actually work here.
//
// HARD RULE (inherited): no fabricated envelopes, ever. fetchEnvelopes()
// returns null on ANY failure (network, bad key, non-2xx, or the "200 + zero
// rows from an anon key" RLS trap) so the caller renders an honest
// "not connected" state instead of a false "zero contracts".

import type { Env } from './env.js';
import * as infisical from './infisical.js';
import { fingerprintEnvelope } from './contractApprovalCore.js';
import { prepareDraftWithClient } from './trusignDraftCore.js';
import { whoseTurn } from './trusignTurn.js';

const TABLE = 'envelopes';
const TRUSIGN_INFISICAL_PATHS = ['/TruSign', '/Contracts'];

function clean(v: string | null | undefined): string | null {
  const normalized = v?.trim();
  return normalized && !normalized.toLowerCase().includes('xxxx') ? normalized : null;
}

// ── Read credentials (URL + service/anon key) ──────────────────────────────

interface KeyInfo {
  key: string;
  kind: 'service' | 'anon';
}

function envUrl(env: Env): string | null {
  const u = clean(env.TRUSIGN_SUPABASE_URL);
  return u ? u.replace(/\/+$/, '') : null;
}

function envKey(env: Env): KeyInfo | null {
  const svc = clean(env.TRUSIGN_SUPABASE_SERVICE_KEY);
  if (svc) return { key: svc, kind: 'service' };
  const anon = clean(env.TRUSIGN_SUPABASE_ANON_KEY);
  if (anon) return { key: anon, kind: 'anon' };
  return null;
}

// Sync, best-effort: "is it worth trying?". The real resolution happens fresh
// in resolveCreds() so a key added mid-session (env OR Infisical) is picked up
// without a redeploy.
export function isConfigured(env: Env): boolean {
  return !!(envUrl(env) && envKey(env)) || infisical.isConfigured(env);
}

interface ReadCreds {
  url: string;
  key: string;
  kind: 'service' | 'anon';
}

async function resolveCreds(env: Env): Promise<ReadCreds | null> {
  const fromEnvUrl = envUrl(env);
  const fromEnvKey = envKey(env);
  if (fromEnvUrl && fromEnvKey) return { url: fromEnvUrl, ...fromEnvKey };

  if (infisical.isConfigured(env)) {
    for (const p of TRUSIGN_INFISICAL_PATHS) {
      const [rawUrl, rawSvc, rawAnon] = await Promise.all([
        infisical.getSecret(env, 'TRUSIGN_SUPABASE_URL', p),
        infisical.getSecret(env, 'TRUSIGN_SUPABASE_SERVICE_KEY', p),
        infisical.getSecret(env, 'TRUSIGN_SUPABASE_ANON_KEY', p),
      ]);
      const url = clean(rawUrl);
      const svc = clean(rawSvc);
      const anon = clean(rawAnon);
      if (url && svc) return { url: url.replace(/\/+$/, ''), key: svc, kind: 'service' };
      if (url && anon) return { url: url.replace(/\/+$/, ''), key: anon, kind: 'anon' };
    }
  }
  return null;
}

export interface Envelope {
  id: string;
  title: string;
  status: string;
  senderName: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  version: string;
  team: string | null;
  clientName: string | null;
  /** Who the contract is currently blocked on. Empty unless it is out for signature. */
  waitingOn: Array<{ name: string; email: string }>;
  /** True when one of those people is Eric. */
  waitingOnYou: boolean;
}

// Eric's own addresses, so the tab can tell his contracts from everyone
// else's. Configurable because he signs as more than one address over time.
function ericEmails(env: Env): string[] {
  const raw = clean(env.ERIC_SIGNING_EMAILS) || 'eric@terrasonconsulting.com';
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

let rlsWarned = false;

// Recipients for a page of envelopes, keyed by envelope id. Read-only, same
// credentials as the envelope list.
async function fetchRecipients(
  creds: { url: string; key: string },
  envelopeIds: string[],
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const byEnvelope = new Map<string, Array<Record<string, unknown>>>();
  try {
    const endpoint =
      `${creds.url}/rest/v1/recipients` +
      `?select=envelope_id,name,email,role,routing_order,status` +
      `&envelope_id=in.(${envelopeIds.map((id) => `"${id}"`).join(',')})` +
      `&order=routing_order`;
    const res = await fetch(endpoint, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[trusign] recipients read failed (HTTP ${res.status}) — the list loses its waiting-on column.`);
      return byEnvelope;
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return byEnvelope;
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = String(row.envelope_id);
      const list = byEnvelope.get(id) ?? [];
      list.push(row);
      byEnvelope.set(id, list);
    }
  } catch (err) {
    console.warn('[trusign] recipients read errored:', (err as Error).message);
  }
  return byEnvelope;
}

// Returns { connected:true, keyKind, envelopes } or null on a hard failure —
// including the "200 + zero rows from an anon key" case, which must never be
// read as "TruSign genuinely has zero contracts" (see header).
export async function fetchEnvelopes(env: Env): Promise<{ connected: true; keyKind: 'service' | 'anon'; envelopes: Envelope[] } | null> {
  const creds = await resolveCreds(env);
  if (!creds) return null;
  const { url } = creds;

  const endpoint =
    `${url}/rest/v1/${TABLE}` +
    `?select=id,title,status,sender_name,sent_at,completed_at,created_at,expires_at,routing,team,client_name` +
    `&order=created_at.desc&limit=100`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}`, Accept: 'application/json' },
    });
  } catch (err) {
    console.warn('[trusign] network error reaching TruSign Supabase:', (err as Error).message);
    return null;
  }

  if (!res.ok) {
    console.warn(`[trusign] envelopes read failed (HTTP ${res.status}) — likely RLS or a bad key.`);
    return null;
  }

  let rows: unknown;
  try {
    rows = await res.json();
  } catch {
    console.warn('[trusign] envelopes response was not valid JSON.');
    return null;
  }

  if (!Array.isArray(rows)) return null;

  if (rows.length === 0 && creds.kind === 'anon') {
    // Cannot distinguish "genuinely zero envelopes" from "RLS filtered
    // everything out" with only an anon key and no Clerk session. Report as
    // not-connected.
    if (!rlsWarned) {
      rlsWarned = true;
      console.warn(
        '[trusign] envelopes read returned 200 with zero rows using the ANON key — RLS almost certainly filtered ' +
          'everything out. Needs TRUSIGN_SUPABASE_SERVICE_KEY before this can be trusted as real data.',
      );
    }
    return null;
  }

  // One extra read for the whole page of envelopes, so the list can say who it
  // is waiting on. A failure here costs the waiting-on column, not the list.
  const outstanding = (rows as Record<string, unknown>[]).filter((r) => String(r.status) === 'sent').map((r) => String(r.id));
  const recipientsByEnvelope = outstanding.length ? await fetchRecipients(creds, outstanding) : new Map();
  const mine = ericEmails(env);

  const envelopes = await Promise.all((rows as Record<string, unknown>[]).map(async (r) => {
    // team/client_name stay OUT of the fingerprint source: the version hash
    // must keep matching the review bundle's, which doesn't carry them.
    const versionSource = {
      id: String(r.id),
      title: (r.title as string) || 'Untitled envelope',
      status: (r.status as string) || '',
      senderName: (r.sender_name as string) || null,
      sentAt: (r.sent_at as string) || null,
      completedAt: (r.completed_at as string) || null,
      createdAt: (r.created_at as string) || null,
      expiresAt: (r.expires_at as string) || null,
    };
    const recipients = recipientsByEnvelope.get(String(r.id)) ?? [];
    const turn = whoseTurn({ status: versionSource.status, routing: String(r.routing || 'sequential') }, recipients);
    return {
      ...versionSource,
      version: await fingerprintEnvelope(versionSource),
      team: r.team ? String(r.team) : null,
      clientName: r.client_name ? String(r.client_name) : null,
      waitingOn: turn.map((person) => ({
        name: String(person.name || ''),
        email: String(person.email || ''),
      })),
      waitingOnYou: turn.some((person) => mine.includes(String(person.email || '').trim().toLowerCase())),
    } satisfies Envelope;
  }));

  return {
    connected: true,
    keyKind: creds.kind,
    envelopes,
  };
}

export interface ContractRecipientInput {
  name: string;
  email: string;
  role: 'signer' | 'cc' | 'approver';
}

export interface ContractDraftInput {
  title: string;
  client: string;
  team: string | null;
  contractType: string;
  templateId: string | null;
  durationDays: number | null;
  terms: string;
  fields: Record<string, string>;
  recipients: ContractRecipientInput[];
  summary: string;
  draftText: string;
}

export interface EnvelopeReview extends Envelope {
  nativeVersion: string;
  documents: Array<{ id: string; originalFilename: string; pageCount: number; position: number }>;
  recipients: Array<{ id: string; name: string; email: string; role: string; routingOrder: number; status: string }>;
  fields: Array<{ id: string; documentId: string; recipientId: string | null; page: number; x: number; y: number; w: number; h: number; type: string; required: boolean }>;
}

function shapeReviewBundle(raw: any, mine: string[] = []): Promise<EnvelopeReview> {
  const envelope = raw?.envelope || {};
  const documents = (Array.isArray(raw?.documents) ? raw.documents : []).map((document: any) => ({
    id: String(document.id),
    originalFilename: String(document.original_filename || 'document.pdf'),
    pageCount: Number(document.page_count || 0),
    position: Number(document.position || 0),
  })).sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  const recipients = (Array.isArray(raw?.recipients) ? raw.recipients : []).map((recipient: any) => ({
    id: String(recipient.id),
    name: String(recipient.name || ''),
    email: String(recipient.email || ''),
    role: String(recipient.role || ''),
    routingOrder: Number(recipient.routing_order || 0),
    status: String(recipient.status || ''),
  })).sort((a: { routingOrder: number }, b: { routingOrder: number }) => a.routingOrder - b.routingOrder);
  const fields = (Array.isArray(raw?.fields) ? raw.fields : []).map((field: any) => ({
    id: String(field.id),
    documentId: String(field.document_id),
    recipientId: field.recipient_id ? String(field.recipient_id) : null,
    page: Number(field.page || 0),
    x: Number(field.x || 0),
    y: Number(field.y || 0),
    w: Number(field.w || 0),
    h: Number(field.h || 0),
    type: String(field.type || ''),
    required: field.required !== false,
  })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  const versionSource = {
    id: String(envelope.id),
    title: String(envelope.title || 'Untitled envelope'),
    status: String(envelope.status || ''),
    senderName: envelope.sender_name ? String(envelope.sender_name) : null,
    sentAt: envelope.sent_at ? String(envelope.sent_at) : null,
    completedAt: envelope.completed_at ? String(envelope.completed_at) : null,
    createdAt: envelope.created_at ? String(envelope.created_at) : null,
    expiresAt: envelope.expires_at ? String(envelope.expires_at) : null,
    documents,
    recipients,
    fields,
  };
  const turn = whoseTurn({ status: versionSource.status, routing: String(raw?.envelope?.routing || 'sequential') }, recipients);
  return fingerprintEnvelope(versionSource).then((version) => ({
    ...versionSource,
    version,
    nativeVersion: String(raw?.version || ''),
    team: envelope.team ? String(envelope.team) : null,
    clientName: envelope.client_name ? String(envelope.client_name) : null,
    waitingOn: turn.map((person) => ({ name: String(person.name || ''), email: String(person.email || '') })),
    waitingOnYou: turn.some((person) => mine.includes(String(person.email || '').trim().toLowerCase())),
  }));
}

export async function fetchEnvelopeForReview(env: Env, envelopeId: string): Promise<EnvelopeReview | null> {
  const { key } = await resolveWriteKey(env);
  if (!key) return null;
  try {
    const raw = await callTruSignApi('GET', `${await resolveAppUrl(env)}/api/envelopes/${encodeURIComponent(envelopeId)}`, key, null);
    return await shapeReviewBundle(raw, ericEmails(env));
  } catch (err) {
    console.warn('[trusign] review bundle failed:', (err as Error).message);
    return null;
  }
}

// ── Write: send / void, via TruSign's OWN Worker API ────────────────────────
// Deliberately NOT a direct Supabase write — see this file's header.

// The durable TRU M2M key — sent as the `X-Jarvis-Key` header.
function envM2mKey(env: Env): string | null {
  return clean(env.TRUSIGN_JARVIS_M2M_KEY);
}

// Sync "worth trying?" gate. NOTE: true when Infisical is merely present,
// which is NOT proof a key exists — use the async isWriteConnected() for the
// real armed/not-armed state.
export function isWriteConfigured(env: Env): boolean {
  return !!envM2mKey(env) || infisical.isConfigured(env);
}

async function resolveWriteKey(env: Env): Promise<{ key: string | null; source: string | null }> {
  const fromEnv = envM2mKey(env);
  if (fromEnv) return { key: fromEnv, source: 'env' };
  if (infisical.isConfigured(env)) {
    for (const p of TRUSIGN_INFISICAL_PATHS) {
      const v = clean(await infisical.getSecret(env, 'TRUSIGN_JARVIS_M2M_KEY', p));
      if (v) return { key: v, source: `infisical:${p}` };
    }
  }
  return { key: null, source: null };
}

// Honest write state for the overview: actually resolves the M2M key (env OR
// Infisical). Only true when a real key is present, so SEND/VOID stay
// disabled until it's configured — never optimistic.
export async function isWriteConnected(env: Env): Promise<boolean> {
  try {
    const { key } = await resolveWriteKey(env);
    return !!key;
  } catch {
    return false;
  }
}

// Pure request-shape builder — unit-testable without a live key.
export function buildEnvelopeCall(appUrl: string, envelopeId: string, verb: 'send' | 'void'): { method: string; url: string; body: Record<string, never> } {
  const path = verb === 'send' ? 'send' : 'void';
  return { method: 'POST', url: `${appUrl}/api/envelopes/${encodeURIComponent(envelopeId)}/${path}`, body: {} };
}

async function callTruSignApi(method: string, url: string, key: string, body: unknown): Promise<any> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: isForm ? { 'X-Jarvis-Key': key } : { 'X-Jarvis-Key': key, 'Content-Type': 'application/json' },
    body: body == null ? undefined : isForm ? body as FormData : JSON.stringify(body),
  });
  const responseBody = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok) {
    throw new Error((responseBody && (responseBody.message || responseBody.error)) || `TruSign API ${method} ${url} -> ${res.status}`);
  }
  return responseBody;
}

// ── Templates ───────────────────────────────────────────────────────────────
// Contracts are stamped out of these rather than typed. A role carrying a
// fixed name and email is our own side (Eric, Adam) and is never asked for;
// only the other party is.

export interface TemplateRole {
  roleKey: string;
  /** May be left unfilled; its signature block stays blank on the contract. */
  optional: boolean;
  label: string;
  role: string;
  routingOrder: number;
  fixedName: string | null;
  fixedEmail: string | null;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  contractType: string;
  team: string | null;
  defaultDurationDays: number | null;
  roles: TemplateRole[];
}

export interface TemplateDetail extends TemplateSummary {
  /** The blanks in the document, in the order they appear. */
  placeholders: Array<{ key: string; required: boolean }>;
}

function shapeRole(raw: any): TemplateRole {
  return {
    roleKey: String(raw?.role_key || ''),
    label: String(raw?.label || raw?.role_key || ''),
    role: String(raw?.role || 'signer'),
    routingOrder: Number(raw?.routing_order || 0),
    optional: raw?.optional === true,
    fixedName: raw?.fixed_name ? String(raw.fixed_name) : null,
    fixedEmail: raw?.fixed_email ? String(raw.fixed_email) : null,
  };
}

function shapeTemplate(raw: any): TemplateSummary {
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || 'Untitled template'),
    description: raw?.description ? String(raw.description) : null,
    contractType: String(raw?.contract_type || ''),
    team: raw?.team ? String(raw.team) : null,
    defaultDurationDays: raw?.default_duration_days == null ? null : Number(raw.default_duration_days),
    roles: (Array.isArray(raw?.roles) ? raw.roles : []).map(shapeRole).sort((a: TemplateRole, b: TemplateRole) => a.routingOrder - b.routingOrder),
  };
}

export function roleNeedsAPerson(role: TemplateRole): boolean {
  return !(role.fixedName && role.fixedEmail);
}

export async function fetchTemplates(env: Env): Promise<TemplateSummary[] | null> {
  const { key } = await resolveWriteKey(env);
  if (!key) return null;
  try {
    const raw = await callTruSignApi('GET', `${await resolveAppUrl(env)}/api/templates`, key, null);
    return (Array.isArray(raw?.templates) ? raw.templates : []).map(shapeTemplate);
  } catch (err) {
    console.warn('[trusign] template list failed:', (err as Error).message);
    return null;
  }
}

export async function fetchTemplate(env: Env, templateId: string): Promise<TemplateDetail | null> {
  const { key } = await resolveWriteKey(env);
  if (!key) return null;
  try {
    const raw = await callTruSignApi('GET', `${await resolveAppUrl(env)}/api/templates/${encodeURIComponent(templateId)}`, key, null);
    // One entry per blank name: the same value can fill several boxes, and the
    // person filling the form should be asked for it once.
    const seen = new Map<string, boolean>();
    for (const field of Array.isArray(raw?.fields) ? raw.fields : []) {
      const placeholderKey = field?.placeholder_key ? String(field.placeholder_key) : '';
      if (!placeholderKey) continue;
      seen.set(placeholderKey, (seen.get(placeholderKey) ?? false) || field?.required !== false);
    }
    return {
      ...shapeTemplate(raw),
      placeholders: [...seen.entries()].map(([key, required]) => ({ key, required })),
    };
  } catch (err) {
    console.warn('[trusign] template read failed:', (err as Error).message);
    return null;
  }
}

/**
 * Pair the people the screen supplied to the roles that need one.
 *
 * `open` is every role needing a person, optional ones included. The screen
 * only sends people for the roles it actually asked about, so a template with
 * an optional second client signer offers two open roles but sends one
 * recipient. Zipping straight down `open` would read `recipients[1].name` on
 * undefined and the draft would throw before TruSign was ever called. Drop
 * optional roles from the end until the roles we fill match the people we
 * were handed, keeping order for the rest.
 */
export function pairRecipientsToRoles(
  open: readonly TemplateRole[],
  recipients: readonly ContractRecipientInput[],
): Record<string, { name: string; email: string }> {
  const filled = [...open];
  while (filled.length > recipients.length) {
    const lastOptional = filled.map((role) => role.optional === true).lastIndexOf(true);
    if (lastOptional === -1) break;
    filled.splice(lastOptional, 1);
  }
  return Object.fromEntries(filled.map((role, index) => {
    const person = recipients[index];
    if (!person) throw new Error(`No person was supplied for the ${role.label} line.`);
    return [role.roleKey, { name: person.name, email: person.email }];
  }));
}

export async function prepareEnvelopeDraft(env: Env, input: ContractDraftInput): Promise<EnvelopeReview> {
  const { key } = await resolveWriteKey(env);
  if (!key) throw new Error("TruSign draft preparation isn't connected — no M2M key at /TruSign in Infisical.");
  const appUrl = await resolveAppUrl(env);
  if (input.templateId) {
    const definition = await callTruSignApi('GET', `${appUrl}/api/templates/${encodeURIComponent(input.templateId)}`, key, null);
    const roles: TemplateRole[] = (Array.isArray(definition?.roles) ? definition.roles : []).map(shapeRole);
    // Only the parties we don't already know need supplying. Matching by
    // position would silently put the client's email on Eric's line the
    // moment a template gains a role. Optional roles are only asked for when
    // somebody was actually supplied for them, so a contract with one client
    // signer and one with two both come off the same template.
    const required = roles.filter((r) => roleNeedsAPerson(r) && !r.optional);
    const open = roles.filter(roleNeedsAPerson);
    if (input.recipients.length < required.length || input.recipients.length > open.length) {
      throw new Error(
        `${definition?.name || 'This template'} needs between ${required.length} and ${open.length} person(s) named — ${open.map((r) => r.label).join(', ') || 'none'} — but ${input.recipients.length} were supplied.`,
      );
    }
    const recipients = pairRecipientsToRoles(open, input.recipients);
    const raw = await callTruSignApi('POST', `${appUrl}/api/templates/${encodeURIComponent(input.templateId)}/instantiate`, key, {
      title: input.title,
      client: input.client,
      team: input.team,
      durationDays: input.durationDays,
      recipients,
      values: { client: input.client, team: input.team || '', duration_days: input.durationDays == null ? '' : String(input.durationDays), ...input.fields },
    });
    if (!raw?.envelope?.id || raw.envelope.status !== 'draft' || raw.sent !== false) throw new Error('TruSign template instantiation did not return a genuine review-only draft.');
    return shapeReviewBundle(raw, ericEmails(env));
  }
  return prepareDraftWithClient(input, {
    json: (method, path, body) => callTruSignApi(method, `${appUrl}${path}`, key, body),
    pdf: async (path, filename, bytes) => {
      const form = new FormData();
      form.set('file', new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' }), filename);
      return callTruSignApi('POST', `${appUrl}${path}`, key, form);
    },
    review: (envelopeId) => fetchEnvelopeForReview(env, envelopeId),
    uuid: () => crypto.randomUUID(),
  });
}

export interface ConsumedContractApproval {
  actorId: string;
  action: 'send' | 'void';
  envelopeId: string;
  version: string;
}

export async function executeApprovedEnvelope(
  env: Env,
  approval: ConsumedContractApproval,
): Promise<{ envelopeId: string; ok: true; notified?: number | null }> {
  const { key } = await resolveWriteKey(env);
  if (!key) throw new Error("TruSign mutation isn't connected — no M2M key.");
  const appUrl = await resolveAppUrl(env);
  const current = await fetchEnvelopeForReview(env, approval.envelopeId);
  if (!current || current.version !== approval.version || !current.nativeVersion) throw new Error('TruSign envelope changed or its native approval version is unavailable.');
  const nativeApproval = await callTruSignApi('POST', `${appUrl}/api/envelopes/${encodeURIComponent(approval.envelopeId)}/approvals`, key, {
    action: approval.action,
    version: current.nativeVersion,
  });
  if (!nativeApproval?.token) throw new Error('TruSign did not issue its native one-time approval.');
  const call = buildEnvelopeCall(appUrl, approval.envelopeId, approval.action);
  const result = await callTruSignApi(call.method, call.url, key, { approvalToken: nativeApproval.token, version: current.nativeVersion });
  return {
    envelopeId: approval.envelopeId,
    ok: true,
    ...(approval.action === 'send' ? { notified: result?.notified ?? null } : {}),
  };
}

export const requires =
  "TRUSIGN_SUPABASE_URL (TruSign's OWN Supabase project) plus TRUSIGN_SUPABASE_SERVICE_KEY (service_role — " +
  'bypasses RLS, used read-only/SELECT-only here). An anon key alone reads as zero rows — TruSign\'s RLS only ' +
  'grants SELECT to authenticated users carrying a Clerk org_id claim, which this worker does not hold. Set as ' +
  'worker secrets, or resolve via Infisical (/TruSign or /Contracts).';

export const requiresWrite =
  "TRUSIGN_JARVIS_M2M_KEY — the durable static key TruSign's requireOrg accepts as the X-Jarvis-Key header, " +
  'pre-authorized to Eric\'s org + Clerk user. Set as a worker secret, or resolve via Infisical (/TruSign or ' +
  '/Contracts). TRUSIGN_APP_URL points at the live app (default https://trusign.pages.dev).';

export const requiresApproval =
  "Contract actions are locked until Eric's explicit approval is durably verified for the exact action, envelope, and immutable version.";

function envAppUrl(env: Env): string | null {
  const u = clean(env.TRUSIGN_APP_URL);
  return u ? u.replace(/\/+$/, '') : null;
}

async function resolveAppUrl(env: Env): Promise<string> {
  const fromEnv = envAppUrl(env);
  if (fromEnv) return fromEnv;
  if (infisical.isConfigured(env)) {
    for (const p of TRUSIGN_INFISICAL_PATHS) {
      const v = clean(await infisical.getSecret(env, 'TRUSIGN_APP_URL', p));
      if (v) return v.replace(/\/+$/, '');
    }
  }
  return 'https://trusign.pages.dev';
}
