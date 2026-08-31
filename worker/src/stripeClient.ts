// Stripe, called directly. Ported from TRU Operating System's stripe.ts —
// same account, same discipline, same key resolution: Infisical first (the
// key lives at /Stripe there — one place Eric rotates without a deploy, one
// place to look when something 401s), the env var second as a fallback for
// local runs and the hour after a rotation.
//
// Null key means genuinely absent, and every caller must treat that as
// "cannot act" rather than "act with nothing".

import type { Env } from './env.js';
import * as infisical from './infisical.js';

export const STRIPE_SECRETS_PATH = '/Stripe';
const API = 'https://api.stripe.com/v1';

export async function getKey(env: Env): Promise<string | null> {
  if (infisical.isConfigured(env)) {
    const fromVault = await infisical.getSecret(env, 'STRIPE_SECRET_KEY', STRIPE_SECRETS_PATH).catch(() => null);
    if (fromVault) return fromVault;
  }
  const fromEnv = env.STRIPE_SECRET_KEY;
  return fromEnv && !fromEnv.includes('xxxx') ? fromEnv : null;
}

export async function isConfigured(env: Env): Promise<boolean> {
  return (await getKey(env)) !== null;
}

/* Stripe speaks form-encoding, including for nested objects.
 *
 * `{ metadata: { team: 'x' } }` has to go out as `metadata[team]=x`, and an
 * array as `expand[0]=...`. Getting this wrong produces a 400 that reads like a
 * missing parameter, which sends you looking in the wrong place. */
function encode(body: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...encode(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      out.push(...encode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

/* One request, with Stripe's own error message kept intact.
 *
 * Stripe explains its refusals well — "No such customer", "This invoice has
 * already been finalized" — and replacing that with a generic failure would
 * throw away the only useful thing in the response. */
async function call(
  env: Env,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = await getKey(env);
  if (!key) throw new Error('Stripe is not connected — no STRIPE_SECRET_KEY at /Stripe in Infisical, and none on this worker.');

  const isGet = method === 'GET';
  const qs = isGet && body ? `?${encode(body).join('&')}` : '';
  const res = await fetch(`${API}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Without this a retried request can create a second invoice. Callers
      // that mutate pass one; reads do not need it.
      ...(body?.idempotencyKey ? { 'Idempotency-Key': String(body.idempotencyKey) } : {}),
    },
    body: isGet || !body ? undefined : encode({ ...body, idempotencyKey: undefined }).join('&'),
  });

  const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = (parsed?.error || {}) as Record<string, unknown>;
    throw new Error((err.message as string) || `Stripe ${path} failed (HTTP ${res.status})`);
  }
  return parsed || {};
}

// ── Customers ──────────────────────────────────────────────────────────────

/* Find a customer by email, or make one.
 *
 * Searched rather than blindly created, because creating a second customer for
 * a broker who already exists splits their invoice history in two and neither
 * half tells the truth. */
export async function ensureCustomer(
  env: Env,
  { email, name }: { email: string; name?: string },
): Promise<{ id: string; created: boolean }> {
  const found = (await call(env, 'GET', '/customers', { email, limit: 1 })) as { data?: { id: string }[] };
  const existing = found.data?.[0];
  if (existing?.id) return { id: existing.id, created: false };

  const made = await call(env, 'POST', '/customers', { email, name: name || undefined });
  return { id: String(made.id), created: true };
}

// ── Invoices ───────────────────────────────────────────────────────────────

export interface DraftLine {
  description: string;
  amountCents: number;
}

/* A draft invoice with one line per closing.
 *
 * Draft, deliberately and always. Eric approves and sends; nothing in this
 * system finalises an invoice on its own.
 *
 * The invoice is created FIRST and every line is then attached to it by id.
 *
 * This used to write the lines first and let Stripe sweep them onto the next
 * invoice for that customer — the "pending invoice items" model. That sweep is
 * not guaranteed: it depends on the account's API version defaulting
 * pending_invoice_items_behavior to 'include', and when it does not, the lines
 * stay pending, the invoice totals ZERO, and finalising a zero invoice makes
 * Stripe mark it paid on the spot. On 2026-08-16 two live invoices went out
 * that way — each showing $0 to the client with the real fees left stranded as
 * pending items on the customer. Binding each line to an invoice id has no
 * such default to depend on.
 *
 * Every line carries its own idempotency key derived from the invoice's, so a
 * retry re-attaches the same lines instead of doubling them. */
export async function createDraftInvoice(
  env: Env,
  {
    customerId,
    lines,
    description,
    daysUntilDue = 15,
    metadata,
    idempotencyKey,
  }: {
    customerId: string;
    lines: DraftLine[];
    description?: string;
    daysUntilDue?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  },
): Promise<Record<string, unknown>> {
  if (!lines.length) throw new Error('Nothing to invoice — no line items.');

  const invoice = await call(env, 'POST', '/invoices', {
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: daysUntilDue,
    description: description || undefined,
    auto_advance: false,
    // Belt as well as braces: every line is attached by id below, so there
    // should be nothing pending to sweep. Saying so explicitly means a stray
    // pending item from an earlier failure cannot land on this invoice either.
    pending_invoice_items_behavior: 'exclude',
    metadata: metadata || undefined,
    idempotencyKey,
  });
  const invoiceId = String(invoice.id || '');
  if (!invoiceId) throw new Error('Stripe created no invoice id.');

  for (const [i, line] of lines.entries()) {
    await call(env, 'POST', '/invoiceitems', {
      customer: customerId,
      invoice: invoiceId,
      amount: Math.round(line.amountCents),
      currency: 'usd',
      description: line.description,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:line:${i}` : undefined,
    });
  }

  // Re-read so the caller sees the real total rather than the empty shell the
  // create call returned before any line existed. Recording that shell is what
  // wrote $0 into the invoices table once.
  return call(env, 'GET', `/invoices/${encodeURIComponent(invoiceId)}`);
}

/* Finalise and send. The only call in this file that reaches a human.
 *
 * Refuses a zero invoice, and refuses BEFORE finalising, because finalising is
 * the irreversible half: Stripe marks a $0 invoice paid the instant it is
 * finalised, and a paid invoice cannot be voided afterwards.
 *
 * A $0 invoice is never something Eric meant to send. Whatever the cause, the
 * right answer is to stop rather than to mail a client a bill for nothing. */
export async function sendInvoice(env: Env, invoiceId: string): Promise<Record<string, unknown>> {
  const before = await call(env, 'GET', `/invoices/${encodeURIComponent(invoiceId)}`);
  const total = typeof before.total === 'number' ? before.total : null;
  if (total === null) throw new Error('Stripe did not report a total for that invoice — not sending it.');
  if (total <= 0) {
    throw new Error(
      'Stripe has this invoice at $0, so it was not sent. Its line items did not attach — void it and invoice the month again.',
    );
  }

  await call(env, 'POST', `/invoices/${encodeURIComponent(invoiceId)}/finalize`, { auto_advance: 'true' });
  return call(env, 'POST', `/invoices/${encodeURIComponent(invoiceId)}/send`);
}

/* Void a finalised invoice, or delete one still in draft.
 *
 * Stripe refuses to void a draft — it has no invoice number and, as far as
 * anyone outside is concerned, never existed. Voiding is for something the
 * broker has already been shown, which is why it leaves a permanent record and
 * deleting does not. Calling the wrong one returns an error that reads like a
 * permissions problem and sends you hunting in the wrong place. */
export async function voidInvoice(env: Env, invoiceId: string): Promise<{ status: string; deleted: boolean }> {
  const inv = await call(env, 'GET', `/invoices/${encodeURIComponent(invoiceId)}`);

  if (inv.status === 'draft') {
    await call(env, 'DELETE', `/invoices/${encodeURIComponent(invoiceId)}`);
    return { status: 'deleted', deleted: true };
  }

  const voided = await call(env, 'POST', `/invoices/${encodeURIComponent(invoiceId)}/void`);
  return { status: String(voided.status || 'void'), deleted: false };
}

export async function getInvoice(env: Env, invoiceId: string): Promise<Record<string, unknown>> {
  return call(env, 'GET', `/invoices/${encodeURIComponent(invoiceId)}`);
}
