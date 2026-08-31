// MONEY — reads and writes TRU HQ's own billing tables, and calls Stripe
// directly. Ported from TRU Operating System's money.ts onto this worker's
// raw-PostgREST Db; the discipline is kept intact because each piece of it was
// earned in production:
//
//   - the server re-reads the billable preview before invoicing (a stale
//     browser tab must never decide what a broker is charged),
//   - only a `bills = true` broker is ever billed, and nobody billable means
//     REFUSE, never a guess (a fallback once sent a client's invoice to
//     Eric's own partner),
//   - the Stripe idempotency key is deterministic per team+close-month so a
//     double-tap cannot create a second draft,
//   - the draft's total must equal the approved preview total before anything
//     is recorded (two $0 invoices went out on 2026-08-16 without this),
//   - a voided invoice releases its closings so they are billable again.
//
// Approve-gate: the worker has no native dialog, so "authenticated admin +
// explicit POST" IS the approval, and the confirm sheet lives client-side
// before the fetch fires. Nothing here ever fires on its own.

import type { Env } from './env.js';
import type { Db } from './db.js';
import * as stripe from './stripeClient.js';

/* Billing month → close month. August bills July; January bills December. */
export function closeMonthFromBilling(year: number, month: number): { year: number; month: number; yyyyMm: string } {
  const closeYear = month === 1 ? year - 1 : year;
  const closeMonth = month === 1 ? 12 : month - 1;
  return {
    year: closeYear,
    month: closeMonth,
    yyyyMm: `${closeYear}-${String(closeMonth).padStart(2, '0')}`,
  };
}

const fmtUsd = (cents: number | null | undefined) =>
  typeof cents === 'number' ? `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TeamRow {
  id: string;
  name: string;
}

export interface RateRow {
  source: string;
  rate: number;
  threshold: number;
}

export interface TeamConfig extends TeamRow {
  retainer: number | null;
  defaultRate: number | null;
  configured: boolean;
  rates: RateRow[];
}

/* tru_list_teams, not a table SELECT: it is the one shape that carries the
 * rate card the screen shows, and it matches what TRU OS's UI consumed. */
export async function listTeams(database: Db): Promise<TeamConfig[]> {
  const data = await database.rpc('tru_list_teams', {});
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return rows
    .filter((r) => String(r.id || '').trim() && String(r.name || '').trim())
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      retainer: typeof r.retainer === 'number' ? r.retainer : null,
      defaultRate: typeof r.default_rate === 'number' ? r.default_rate : null,
      configured: r.configured === true,
      rates: (Array.isArray(r.rates) ? r.rates : []).map((x: Record<string, unknown>) => ({
        source: String(x.source || ''),
        rate: Number(x.rate) || 0,
        threshold: Number(x.threshold) || 0,
      })),
    }));
}

export async function resolveTeam(database: Db, name?: string): Promise<TeamRow | null> {
  if (!name) return null;
  const rows = await database.select('teams', `select=id,name&name=ilike.${encodeURIComponent(name)}`);
  const row = (rows as { id?: string; name?: string }[])[0];
  return row?.id ? { id: row.id, name: row.name || name } : null;
}

export interface BrokerRow {
  email: string | null;
  name: string | null;
}

/* Who gets BILLED, which is not everyone in the table.
 *
 * A team has several people on its money side. Only the leader is billed; the
 * rest are there for the monthly closing confirmations. That distinction is
 * `bills`, and it exists because a lookup that once took "the first broker
 * alphabetically" pointed all four teams at Eric's own partner and one real
 * invoice reached him.
 *
 * Nobody billable means null, never a guess. A wrong recipient is worse than a
 * refusal — the refusal is visible and stops at the screen. */
export async function fetchBroker(database: Db, teamId: string): Promise<BrokerRow | null> {
  const rows = await database.select(
    'brokers',
    `select=email,name&team_id=eq.${teamId}&bills=eq.true&order=email`,
  );
  const row = (rows as BrokerRow[])[0] || null;
  return row ? { email: row.email || null, name: row.name || null } : null;
}

/* Everyone on a team who confirms closings. A team has more than one, and
 * sending a month's list to just one of them is how a round stalls on
 * somebody's holiday. */
export async function listBrokers(database: Db, teamName: string): Promise<{ name: string | null; email: string }[]> {
  const team = await resolveTeam(database, teamName);
  if (!team) return [];
  const rows = await database.select('brokers', `select=name,email&team_id=eq.${team.id}&order=email`);
  return (rows as { name: string | null; email: string }[]).filter((b) => b.email);
}

/* Everyone on a team who is billed. Usually one. */
export async function listBillingContacts(database: Db, teamId: string): Promise<{ name: string | null; email: string }[]> {
  const rows = await database.select('brokers', `select=name,email&team_id=eq.${teamId}&bills=eq.true&order=email`);
  return (rows as { name: string | null; email: string }[]).filter((b) => b.email);
}

/* Remember a broker address for a team.
 *
 * Matched on the ADDRESS, not on the team: the table allows one row per team
 * per address, so setting an address already on file corrects it and setting a
 * new one adds a broker instead of replacing one. (The single-row assumption
 * once collided on a duplicate key and killed an invoice send before it
 * reached Stripe.) No name passed means the caller was only confirming the
 * address — writing null over the name on file would quietly erase who the
 * broker is. */
export async function setBrokerEmail(
  database: Db,
  { team, email, name }: { team?: string; email?: string; name?: string },
): Promise<{ team: string; email: string }> {
  if (!team) throw new Error('Which team?');
  const clean = String(email || '').trim();
  if (!EMAIL_RE.test(clean)) throw new Error('That does not look like an email address.');
  const teamRow = await resolveTeam(database, team);
  if (!teamRow) throw new Error(`No team called ${team}.`);

  const onFile = await database.select('brokers', `select=id,email&team_id=eq.${teamRow.id}`);
  const existing = (onFile as { id: string; email: string | null }[]).find(
    (b) => (b.email || '').trim().toLowerCase() === clean.toLowerCase(),
  );

  if (existing) {
    const patch: Record<string, unknown> = { email: clean, updated_at: new Date().toISOString() };
    if (name) patch.name = name;
    await database.update('brokers', `id=eq.${existing.id}`, patch);
  } else {
    await database.insert('brokers', { team_id: teamRow.id, email: clean, name: name || null });
  }
  return { team: teamRow.name, email: clean };
}

// ── Reads the screen is built from ─────────────────────────────────────────

export interface BillableItem {
  id: string;
  address: string;
  agentName: string;
  closeDate: string | null;
  source: string | null;
  feeCents: number;
  feeLabel: string;
}
export interface BillablePreview {
  items: BillableItem[];
  count: number;
  totalCents: number;
  totalLabel: string;
}

export async function previewBillable(database: Db, teamId: string, closeMonthYyyyMm: string): Promise<BillablePreview> {
  const data = await database.rpc('billable_closings', { p_team: teamId, p_close_month: `${closeMonthYyyyMm}-01` });
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const items: BillableItem[] = rows.map((r) => {
    const feeCents = Math.round((Number(r.earned_fee) || 0) * 100);
    return {
      id: String(r.id),
      address: (r.address as string) || '—',
      agentName: (r.agent_name as string) || '—',
      closeDate: (r.close_date as string) || null,
      source: (r.source as string) || null,
      feeCents,
      feeLabel: fmtUsd(feeCents),
    };
  });
  const totalCents = items.reduce((s, it) => s + it.feeCents, 0);
  return { items, count: items.length, totalCents, totalLabel: fmtUsd(totalCents) };
}

export interface MonthDeal {
  id: string;
  address: string | null;
  clientName: string | null;
  agentName: string | null;
  source: string | null;
  closeDate: string | null;
  status: string;
  locked: boolean;
  dealNumber: number | null;
  rate: number | null;
  thresholdDeals: number | null;
  unpriced: boolean;
  earned: number | null;
}
export interface MonthClosings {
  team: string;
  billingMonth: string;
  earningMonth: string;
  deals: MonthDeal[];
}

/* Every deal for one team's billing month, whatever its state — pending,
 * cancelled, locked to an invoice. The question this answers is usually "did
 * that closing ever come through". tru_month_closings takes the BILLING month
 * and applies the shift itself. */
export async function monthClosings(database: Db, teamName: string, year: number, month: number): Promise<MonthClosings> {
  const data = await database.rpc('tru_month_closings', { p_team_name: teamName, p_year: year, p_month: month });
  const o = (data || {}) as Record<string, unknown>;
  const rows = (Array.isArray(o.deals) ? o.deals : []) as Record<string, unknown>[];
  return {
    team: String(o.team || teamName),
    billingMonth: `${o.year}-${String(o.month).padStart(2, '0')}`,
    earningMonth: `${o.earning_year}-${String(o.earning_month).padStart(2, '0')}`,
    deals: rows.map((r) => ({
      id: String(r.id),
      address: (r.address as string) ?? null,
      clientName: (r.client_name as string) ?? null,
      agentName: (r.agent_name as string) ?? null,
      source: (r.source as string) ?? null,
      closeDate: (r.close_date as string) ?? null,
      status: String(r.status || 'pending'),
      locked: r.locked === true,
      dealNumber: typeof r.deal_number === 'number' ? r.deal_number : null,
      rate: typeof r.rate === 'number' ? r.rate : null,
      thresholdDeals: typeof r.threshold_deals === 'number' ? r.threshold_deals : null,
      unpriced: r.unpriced === true,
      earned: typeof r.earned === 'number' ? r.earned : null,
    })),
  };
}

/* The whole month at a glance — confirmed and projected, separately, in the
 * database's own words. The projection is NOT a fee: billable_closings is the
 * only thing that decides what anybody is charged. */
export async function moneyOverview(database: Db, year: number, month: number): Promise<Record<string, unknown>> {
  return (await database.rpc('tru_money_overview', { p_year: year, p_month: month })) as Record<string, unknown>;
}

// ── The rate card (feature TRU OS never had: editing an existing team) ─────

/* Whole dollars, and nothing that would land in the ledger as a surprise.
 * The columns are integers, so a decimal rate silently truncates on the way
 * in — better to refuse it and make Eric say which he meant. */
export function wholeDollars(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a positive amount.`);
  if (!Number.isInteger(n)) throw new Error(`${field} must be whole dollars — no cents.`);
  if (n > 1_000_000) throw new Error(`${field} looks wrong at $${n.toLocaleString('en-US')}.`);
  return n;
}

export interface TeamPayInput {
  teamId?: string;
  retainer?: number;
  defaultRate?: number | null;
  rates?: { source?: string; rate?: number; thresholdDeals?: number }[];
}

export async function saveTeamPay(database: Db, input: TeamPayInput): Promise<{ teamId: string; rates: number }> {
  const teamId = String(input.teamId || '');
  if (!UUID_RE.test(teamId)) throw new Error('Which team?');
  const retainer = wholeDollars(input.retainer ?? 0, 'The retainer');
  const defaultRate =
    input.defaultRate === null || input.defaultRate === undefined
      ? null
      : wholeDollars(input.defaultRate, 'The default rate');

  /* Deduped on the source before it reaches SQL — two "Zillow Preferred" rows
   * would fail the replace halfway. Last one typed wins, which is what a
   * person correcting themselves in the form expects. */
  const bySource = new Map<string, { source: string; rate: number; threshold_deals: number }>();
  for (const r of input.rates || []) {
    const source = String(r?.source || '').trim();
    if (!source) continue;
    bySource.set(source.toLowerCase(), {
      source,
      rate: wholeDollars(r?.rate ?? 0, `The ${source} rate`),
      threshold_deals: wholeDollars(r?.thresholdDeals ?? 0, `The ${source} threshold`),
    });
  }

  const out = await database.rpc('tru_save_team_pay', {
    p_team: teamId,
    p_retainer: retainer,
    p_default_rate: defaultRate,
    p_rates: [...bySource.values()],
  });
  return { teamId, rates: Number((out as Record<string, unknown>)?.rates) || 0 };
}

// ── Invoices ───────────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  teamId: string | null;
  teamName: string | null;
  closeMonth: string | null;
  invoiceKind: string;
  customerEmail: string | null;
  customerName: string | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  status: string;
  amountDueCents: number | null;
  amountDueLabel: string;
  dueDate: string | null;
  paidAt: string | null;
}

export async function listInvoices(database: Db, limit = 30): Promise<InvoiceRow[]> {
  const teamsById = new Map((await listTeams(database)).map((t) => [t.id, t.name]));
  const rows = await database.select(
    'invoices',
    'select=id,team_id,close_month,invoice_kind,customer_email,customer_name,stripe_invoice_id,hosted_invoice_url,status,amount_due_cents,due_date,paid_at' +
      `&order=created_at.desc&limit=${limit}`,
  );
  return (rows as Record<string, unknown>[]).map((inv) => {
    const teamId = (inv.team_id as string) ?? null;
    return {
      id: inv.id as string,
      teamId,
      teamName: (teamId && teamsById.get(teamId)) || null,
      closeMonth: (inv.close_month as string) ?? null,
      invoiceKind: (inv.invoice_kind as string) || 'closings',
      customerEmail: (inv.customer_email as string) ?? null,
      customerName: (inv.customer_name as string) ?? null,
      stripeInvoiceId: (inv.stripe_invoice_id as string) ?? null,
      hostedInvoiceUrl: (inv.hosted_invoice_url as string) ?? null,
      status: inv.status as string,
      amountDueCents: (inv.amount_due_cents as number) ?? null,
      amountDueLabel: fmtUsd(inv.amount_due_cents as number),
      dueDate: (inv.due_date as string) ?? null,
      paidAt: (inv.paid_at as string) ?? null,
    };
  });
}

/* Record an invoice just made in Stripe, and stamp its closings.
 *
 * Stamping matters: billable_closings excludes anything with an invoice_id, so
 * a closing that has been billed stops appearing as billable. Without this a
 * team would be invoiced twice for the same deal — the single worst bug
 * available in this file. */
async function recordInvoice(
  database: Db,
  {
    stripeInvoice,
    teamId,
    closeMonth,
    closingIds,
    brokerEmail,
    brokerName,
  }: {
    stripeInvoice: Record<string, unknown>;
    teamId: string;
    closeMonth: string;
    closingIds: string[];
    brokerEmail: string;
    brokerName?: string;
  },
): Promise<string> {
  const inserted = await database.insert('invoices', {
    team_id: teamId,
    close_month: closeMonth,
    stripe_invoice_id: String(stripeInvoice.id),
    stripe_customer_id: (stripeInvoice.customer as string) ?? null,
    hosted_invoice_url: (stripeInvoice.hosted_invoice_url as string) ?? null,
    invoice_pdf: (stripeInvoice.invoice_pdf as string) ?? null,
    status: (stripeInvoice.status as string) || 'draft',
    amount_due_cents: typeof stripeInvoice.amount_due === 'number' ? stripeInvoice.amount_due : null,
    due_date:
      typeof stripeInvoice.due_date === 'number'
        ? new Date((stripeInvoice.due_date as number) * 1000).toISOString().slice(0, 10)
        : null,
    invoice_kind: 'closings',
    customer_email: brokerEmail,
    customer_name: brokerName ?? null,
  });
  const invoiceId = (inserted as { id: string }).id;

  if (closingIds.length) {
    await database.update('closings', `id=in.(${closingIds.join(',')})`, { invoice_id: invoiceId });
  }
  return invoiceId;
}

async function invoiceRowById(database: Db, id: string): Promise<Record<string, unknown> | null> {
  const rows = await database.select(
    'invoices',
    `select=id,stripe_invoice_id,team_id,close_month,customer_email&id=eq.${id}`,
  );
  return (rows as Record<string, unknown>[])[0] || null;
}

/* Copy Stripe's answer back onto our row. Stripe is the authority on an
 * invoice's status, url and due date; our table is a record of it, never a
 * second opinion. */
async function syncInvoiceRow(database: Db, id: string, inv: Record<string, unknown>): Promise<void> {
  await database.update('invoices', `id=eq.${id}`, {
    status: (inv.status as string) || 'open',
    hosted_invoice_url: (inv.hosted_invoice_url as string) ?? null,
    invoice_pdf: (inv.invoice_pdf as string) ?? null,
    amount_due_cents: typeof inv.amount_due === 'number' ? inv.amount_due : null,
    due_date:
      typeof inv.due_date === 'number' ? new Date((inv.due_date as number) * 1000).toISOString().slice(0, 10) : null,
    updated_at: new Date().toISOString(),
  });
}

export type ToolResult = string | { error: true; text: string };

/* Bump this whenever the SHAPE of an invoice request to Stripe changes.
 *
 * Stripe pins an idempotency key to the exact parameters it first saw. These
 * keys are deterministic — team plus close month — so the same month always
 * reuses the same key, which is the point: a double-tap must not create a
 * second invoice. But changing the request body while keeping the key makes
 * Stripe reject every month ever attempted under the old shape. The version
 * segment is what lets the request shape change without stranding a month.
 *
 * v2 — 2026-08-16 (in TRU OS), invoice created before its lines rather than
 * after. Kept at v2 here: same Stripe account, and TRU HQ team ids differ
 * from TRU OS's, so the key namespaces cannot collide. */
const INVOICE_KEY_VERSION = 'v2';

export async function createInvoice(
  database: Db,
  env: Env,
  {
    teamId,
    teamLabel,
    closeMonth,
    brokerEmail,
    brokerName,
  }: {
    teamId: string;
    teamLabel?: string;
    closeMonth: string; // YYYY-MM, the CLOSE month
    brokerEmail?: string;
    brokerName?: string;
  },
): Promise<ToolResult> {
  if (!/^\d{4}-\d{2}$/.test(closeMonth)) return { error: true, text: 'A close month (YYYY-MM) is required.' };
  try {
    /* Bill exactly what the ledger says is billable, and nothing else.
     * Re-read here rather than trusted from the client: a stale browser tab
     * must never decide what a broker is charged. */
    const preview = await previewBillable(database, teamId, closeMonth);
    if (preview.count === 0) {
      return { error: true, text: 'Nothing billable for that team and month.' };
    }

    const email = brokerEmail || (await fetchBroker(database, teamId))?.email;
    // Refuse rather than fall back to anyone else on the team.
    if (!email) {
      return { error: true, text: 'Nobody on that team is marked as the one who gets billed — set that before invoicing.' };
    }

    const customer = await stripe.ensureCustomer(env, { email, name: brokerName || teamLabel });
    const invoice = await stripe.createDraftInvoice(env, {
      customerId: customer.id,
      lines: preview.items.map((it) => ({
        description: `${it.address} — ${it.agentName} · closed ${it.closeDate ?? '—'}${it.source ? ` · ${it.source}` : ''}`,
        amountCents: it.feeCents,
      })),
      description: `${teamLabel || teamId} — closings for ${closeMonth}`,
      metadata: { team_id: teamId, close_month: closeMonth },
      // One invoice per team per month, however many times the button is
      // pressed. A double-tap must not create a second draft.
      idempotencyKey: `tru:closings:${INVOICE_KEY_VERSION}:${teamId}:${closeMonth}`,
    });

    /* The draft must equal the number Eric approved. If Stripe's draft
     * disagrees with the preview, something between the two dropped money and
     * neither figure can be trusted. Checked before the row is recorded, so a
     * bad draft never becomes a sendable invoice. */
    const draftTotal = typeof invoice.total === 'number' ? (invoice.total as number) : null;
    if (draftTotal !== preview.totalCents) {
      return {
        error: true,
        text:
          `Stripe built that invoice at ${fmtUsd(draftTotal)}, but the approved total is ${preview.totalLabel}.` +
          ' Nothing was sent — the draft is in Stripe and can be voided there.',
      };
    }

    await recordInvoice(database, {
      stripeInvoice: invoice,
      teamId,
      closeMonth: `${closeMonth}-01`,
      closingIds: preview.items.map((it) => it.id),
      brokerEmail: email,
      brokerName,
    });

    const amountLabel =
      typeof invoice.amount_due === 'number' ? fmtUsd(invoice.amount_due as number) : preview.totalLabel;
    return `Draft invoice created for ${teamLabel || teamId}: ${preview.count} closing(s), ${amountLabel}. Review, then Send.`;
  } catch (err) {
    return { error: true, text: (err as Error).message };
  }
}

/* Send the copy Stripe will not send.
 *
 * Stripe emails the invoice to the customer and nobody else — its invoice API
 * has no CC field. So the people who must see an invoice without being the one
 * it bills get our own email carrying the same link: Adam as Eric's partner on
 * every one, plus any second billing contact on the team.
 *
 * Deliberately swallows its own failure. The invoice is already finalised and
 * in the client's inbox by the time this runs — reporting the whole send as
 * failed because a courtesy copy bounced would invite Eric to press the button
 * again and bill somebody twice. */
const INVOICE_ALWAYS_COPY = 'adamt@terrasonconsulting.com';

async function copyInvoiceTo(
  database: Db,
  env: Env,
  {
    teamId,
    billedTo,
    teamLabel,
    closeMonth,
    hostedUrl,
  }: {
    teamId?: string;
    billedTo?: string;
    teamLabel?: string;
    closeMonth?: string;
    hostedUrl: string | null;
  },
): Promise<string | null> {
  try {
    const from = env.MONEY_FROM || env.BRIEF_FROM;
    if (!env.RESEND_API_KEY || !from) return null;

    const billed = (billedTo || '').trim().toLowerCase();
    const others = teamId ? (await listBillingContacts(database, teamId)).map((b) => b.email) : [];
    const to = [...new Set([...others, INVOICE_ALWAYS_COPY].map((e) => e.trim().toLowerCase()))].filter(
      (e) => e && e !== billed,
    );
    if (!to.length) return null;

    const who = teamLabel || 'a team';
    const subject = `Copy — invoice for ${who}${closeMonth ? `, closings for ${closeMonth}` : ''}`;
    const html =
      `<p>A copy, for your records. The invoice itself was billed to ${billedTo || 'the team'}` +
      ` and Stripe has emailed it to them.</p>` +
      `<p><strong>${who}</strong>${closeMonth ? ` — closings for ${closeMonth}` : ''}</p>` +
      (hostedUrl ? `<p><a href="${hostedUrl}">View the invoice</a></p>` : '') +
      `<p>No action is needed on this email.</p>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
    return to.join(', ');
  } catch (err) {
    console.warn('[money] invoice copy failed:', (err as Error).message);
    return null;
  }
}

export async function sendInvoice(
  database: Db,
  env: Env,
  { invoiceId, teamLabel }: { invoiceId?: string; teamLabel?: string },
): Promise<ToolResult> {
  if (!invoiceId || !UUID_RE.test(invoiceId)) return { error: true, text: 'No invoice specified.' };
  try {
    const row = await invoiceRowById(database, invoiceId);
    if (!row?.stripe_invoice_id) return { error: true, text: 'That invoice has no Stripe record.' };
    const sent = await stripe.sendInvoice(env, String(row.stripe_invoice_id));
    await syncInvoiceRow(database, invoiceId, sent);
    const copied = await copyInvoiceTo(database, env, {
      teamId: row.team_id ? String(row.team_id) : undefined,
      billedTo: row.customer_email ? String(row.customer_email) : undefined,
      teamLabel,
      closeMonth: row.close_month ? String(row.close_month).slice(0, 7) : undefined,
      hostedUrl: sent.hosted_invoice_url ? String(sent.hosted_invoice_url) : null,
    });
    return (
      `Invoice sent${teamLabel ? ` to ${teamLabel}'s broker` : ''}.` +
      (copied ? ` Copy to ${copied}.` : '') +
      (sent.hosted_invoice_url ? ` ${sent.hosted_invoice_url}` : '')
    );
  } catch (err) {
    return { error: true, text: (err as Error).message };
  }
}

export async function voidInvoice(
  database: Db,
  env: Env,
  { invoiceId, teamLabel }: { invoiceId?: string; teamLabel?: string },
): Promise<ToolResult> {
  if (!invoiceId || !UUID_RE.test(invoiceId)) return { error: true, text: 'No invoice specified.' };
  try {
    const row = await invoiceRowById(database, invoiceId);
    if (!row?.stripe_invoice_id) return { error: true, text: 'That invoice has no Stripe record.' };
    const outcome = await stripe.voidInvoice(env, String(row.stripe_invoice_id));

    /* Release the closings so they can be billed again. A voided invoice must
     * hand its deals back to billable_closings, or the money silently
     * disappears from every screen and nobody is ever charged for it. */
    await database.update('invoices', `id=eq.${invoiceId}`, { status: outcome.deleted ? 'void' : outcome.status });
    await database.update('closings', `invoice_id=eq.${invoiceId}`, { invoice_id: null });
    return `Voided invoice${teamLabel ? ` (${teamLabel})` : ''} — its closings are billable again.`;
  } catch (err) {
    return { error: true, text: (err as Error).message };
  }
}

/* Preview + optionally create/send, speaking BILLING months.
 *
 * The screen speaks in billing months (August bills July); createInvoice
 * speaks in close months. Translated here so a tap on the team row cannot
 * bill the wrong month. This never deletes a closing. */
export async function previewForBillingMonth(
  database: Db,
  teamName: string,
  year: number,
  month: number,
): Promise<
  | { team: TeamRow; closeMonth: string; preview: BillablePreview; broker: BrokerRow | null }
  | { error: true; text: string }
> {
  if (!teamName || !year || !month) return { error: true, text: 'Which team and month?' };
  const team = await resolveTeam(database, teamName);
  if (!team) return { error: true, text: `No team named ${teamName}.` };
  const close = closeMonthFromBilling(year, month);
  const preview = await previewBillable(database, team.id, close.yyyyMm);
  const broker = await fetchBroker(database, team.id);
  return { team, closeMonth: close.yyyyMm, preview, broker };
}

export async function invoiceTeamBillingMonth(
  database: Db,
  env: Env,
  {
    team: teamName,
    year,
    month,
    send,
    brokerEmail,
  }: { team?: string; year?: number; month?: number; send?: boolean; brokerEmail?: string },
): Promise<ToolResult> {
  if (!teamName || !year || !month) return { error: true, text: 'Which team and month?' };
  const ready = await previewForBillingMonth(database, teamName, year, month);
  if ('error' in ready) return ready;
  const { team, closeMonth, preview, broker } = ready;
  if (preview.count === 0) {
    return {
      error: true,
      text: `Nothing billable for ${team.name} in ${closeMonth} — confirmed deals may already be invoiced, or still under the threshold.`,
    };
  }

  const created = await createInvoice(database, env, {
    teamId: team.id,
    teamLabel: team.name,
    closeMonth,
    brokerEmail: brokerEmail || broker?.email || undefined,
    brokerName: broker?.name || undefined,
  });
  if (typeof created === 'object' && created.error) return created;

  if (!send) return created;

  /* Find the draft to send from the invoice list rather than trusting a
   * returned id — the create contract returns a plain string. */
  const list = await listInvoices(database, 20);
  const mine = list.find(
    (i) =>
      i.teamId === team.id &&
      String(i.closeMonth || '').slice(0, 7) === closeMonth &&
      (i.status === 'draft' || i.status === 'open'),
  );
  if (!mine) {
    return `${created} Could not find the draft to send — open it from Recent invoices.`;
  }
  if (mine.status !== 'draft') {
    return `An invoice for ${team.name} ${closeMonth} is already ${mine.status}. Nothing new was sent.`;
  }
  return sendInvoice(database, env, { invoiceId: mine.id, teamLabel: team.name });
}
