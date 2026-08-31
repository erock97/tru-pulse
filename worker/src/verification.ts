// The broker confirmation round — start it, mail it, record it.
//
// Ported from TRU Operating System's verification.ts. This is the hinge of the
// whole billing month: closings arrive from a spreadsheet as claims; until the
// broker answers, they are numbers on a page. Eric: "if the broker doesn't
// confirm it, all it is is just numbers in a sheet. We're not actually getting
// paid."
//
// The email is a TRANSACTION, not correspondence. It carries a link, expects
// no written reply, and its content is generated from closings rather than
// written. One transport difference from TRU OS: this worker mails through
// Resend from an @truhq.co sender (Gmail lives with TRU OS's comms agent, not
// here). The broker_email_sends column is still called gmail_message_id — it
// records "the mailer's message id", and renaming a ported column is how
// drift starts.

import type { Env } from './env.js';
import type { Db } from './db.js';
import { closeMonthFromBilling, listBrokers } from './money.js';

const MONTHS = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function esc(s: unknown): string {
  return String(s ?? '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function fmtDate(s: string | null): string {
  if (!s) return '';
  const p = String(s).split('-');
  return p.length === 3 ? `${MONTHS[Number(p[1])]} ${Number(p[2])}` : s;
}

export interface Deal {
  id: string;
  address: string | null;
  client_name: string | null;
  source: string | null;
  close_date: string | null;
  status: string;
  locked: boolean;
}

/* The email itself.
 *
 * Table-based and inline-styled on purpose: this is opened in Outlook and on
 * phones, where a stylesheet is a coin flip and flexbox is worse. Plain,
 * short, and the button is the only thing to do.
 *
 * Only the still-outstanding deals are listed. Listing the whole month meant a
 * broker who answered honestly kept seeing their own "yes" reflected back on
 * the next round. If Eric answered it, the broker was never being asked about
 * it, so it isn't in the email at all. */
export function buildVerificationEmail({
  team,
  year,
  month,
  deals,
  link,
}: {
  team: string;
  year: number;
  month: number;
  deals: Deal[];
  link: string;
}): { subject: string; html: string } {
  const open = deals.filter((d) => d.status === 'pending' && !d.locked);
  const rows = open
    .map(
      (d) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #e6e9ee;font:14px -apple-system,Segoe UI,Roboto,sans-serif;color:#16202e">
          <strong>${esc(d.address || d.client_name || 'Closing')}</strong>
          <div style="color:#5b6b80;font-size:13px;margin-top:2px">
            ${[d.address && d.client_name ? esc(d.client_name) : '', fmtDate(d.close_date), esc(d.source || '')]
              .filter(Boolean)
              .join(' &middot; ')}
          </div>
        </td>
      </tr>`,
    )
    .join('');

  const subject = `${team} — please confirm ${MONTHS[month]} ${year} closings`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f5f6f8">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e6ec;border-radius:12px">
  <tr><td style="padding:26px 26px 8px">
    <div style="font:600 19px -apple-system,Segoe UI,Roboto,sans-serif;color:#16202e">
      ${esc(team)} — ${MONTHS[month]} ${year} closings
    </div>
    <div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5b6b80;margin-top:8px">
      Hi — ${open.length
        ? `could you confirm the ${open.length} ${MONTHS[month]} closing${open.length === 1 ? '' : 's'} still waiting on you?`
        : `everything for ${MONTHS[month]} is already answered — nothing needs you.`}
      It takes a tap each: closed, fell out, or closed in a different month.
    </div>
  </td></tr>
  <tr><td style="padding:6px 26px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
  </td></tr>
  <tr><td style="padding:22px 26px 28px">
    <a href="${esc(link)}" style="display:inline-block;background:#16202e;color:#ffffff;text-decoration:none;font:600 15px -apple-system,Segoe UI,Roboto,sans-serif;padding:13px 22px;border-radius:9px">
      ${open.length ? 'Confirm these closings' : 'View the list'}
    </a>
    <div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#8a97a8;margin-top:14px">
      Nothing is invoiced until you confirm it. If something looks wrong, just reply to this email.
    </div>
  </td></tr>
</table>
<div style="font:12px -apple-system,Segoe UI,Roboto,sans-serif;color:#8a97a8;text-align:center;margin-top:16px">
  Terrason Consulting Group
</div>
</body></html>`;

  return { subject, html };
}

export interface SendResult {
  team: string;
  to: string;
  deals: number;
  outstanding: number;
  link: string;
  messageId: string | null;
}

export interface RoundRow {
  team: string;
  sentAt: string;
  closedAt: string | null;
}

/* Which teams have already been asked, for a billing month.
 *
 * closing_verifications is the honest record: a row exists only because a
 * round was started, and a round is only started by a send, so its created_at
 * IS the sent time. closed_at is set when the broker finishes answering.
 * Takes the BILLING month and shifts it here — rounds are stored by CLOSE
 * month. */
export function roundAlreadyOut(
  rounds: { team: string; sentAt?: string | null }[] | null | undefined,
  team: string,
): boolean {
  const want = String(team || '').trim().toLowerCase();
  if (!want) return false;
  return (rounds || []).some((r) => r.sentAt && String(r.team || '').trim().toLowerCase() === want);
}

export async function listRounds(database: Db, year: number, month: number): Promise<RoundRow[]> {
  if (!year || !month) return [];
  const { year: closeYear, month: closeMonth } = closeMonthFromBilling(year, month);
  try {
    const rows = await database.select(
      'closing_verifications',
      `select=created_at,closed_at,teams(name)&close_year=eq.${closeYear}&close_month=eq.${closeMonth}&order=created_at.desc`,
    );
    const out: RoundRow[] = [];
    const seen = new Set<string>();
    for (const r of rows as { created_at: string; closed_at: string | null; teams: { name?: string } | null }[]) {
      const team = String(r.teams?.name || '');
      // Re-sends extend the same round; take the newest row per team so the
      // date shown is the last time it actually went out.
      if (!team || seen.has(team)) continue;
      seen.add(team);
      out.push({ team, sentAt: r.created_at, closedAt: r.closed_at ?? null });
    }
    return out;
  } catch (err) {
    console.warn('[verification] listRounds failed:', (err as Error).message);
    return [];
  }
}

async function sendViaResend(
  env: Env,
  { to, subject, html }: { to: string[]; subject: string; html: string },
): Promise<{ messageId: string | null }> {
  const from = env.MONEY_FROM || env.BRIEF_FROM;
  if (!env.RESEND_API_KEY || !from) {
    throw new Error('Email is not set up on this worker — RESEND_API_KEY and MONEY_FROM (or BRIEF_FROM) are required.');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`The email could not be sent (Resend ${res.status}).`);
  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  return { messageId: body?.id ?? null };
}

/* Start the round and send it.
 *
 * tru_start_verification is idempotent by design — calling it again for the
 * same team and month returns the SAME token and just extends its life. So a
 * re-send is a reminder, not a second round, and a broker who kept the first
 * email finds their link still works.
 *
 * The send is recorded in broker_email_sends before this returns, but a
 * failure to record never fails the send: the mail is already gone, and
 * pretending otherwise would have Eric send it twice. */
export async function sendVerification(
  database: Db,
  env: Env,
  { team, year, month, toEmail }: { team?: string; year?: number; month?: number; toEmail?: string },
): Promise<SendResult> {
  if (!team) throw new Error('Which team?');
  if (!year || !month) throw new Error('Which month?');

  /* Who gets it: everyone on the team who confirms closings. An explicit
   * address wins when one is passed — that is Eric sending a test to himself,
   * or covering for somebody new who is not on file yet. Otherwise the team's
   * brokers, all of them, because a list sitting in one inbox during a holiday
   * is a round that never closes. */
  const explicit = String(toEmail || '').trim();
  const recipients = explicit ? [explicit] : (await listBrokers(database, team)).map((b) => b.email);
  if (!recipients.length) throw new Error(`No broker on file for ${team}.`);
  for (const r of recipients) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) throw new Error(`"${r}" does not look like an email address.`);
  }
  const to = recipients.join(', ');

  const already = await listRounds(database, year, month);
  if (roundAlreadyOut(already, team)) {
    throw new Error(`${team} was already sent a confirmation for this month.`);
  }

  /* The two functions disagree about which month they are given, so this
   * translates. tru_month_closings takes the BILLING month; the round
   * functions take the CLOSE month directly. Passing the screen's value
   * straight through would ask brokers to confirm the wrong month's deals —
   * caught on a real round in TRU OS before a single email went out.
   * Translated here so every future caller inherits the fix. */
  const { year: closeYear, month: closeMonth } = closeMonthFromBilling(year, month);

  const started = (await database.rpc('tru_start_verification', {
    p_team_name: team,
    p_year: closeYear,
    p_month: closeMonth,
  })) as Record<string, unknown>;
  const token = String(started?.token || '');
  if (!token) throw new Error('Could not start a confirmation round.');

  const list = ((await database.rpc('tru_verify_list', { p_token: token }, 'anon')) || {}) as Record<string, unknown>;
  const deals = (Array.isArray(list.deals) ? list.deals : []) as Deal[];

  /* Nothing to ask about is not a send. A broker who gets an email listing a
   * month they already answered learns that these emails can be ignored,
   * which costs more than the send saves. */
  const outstanding = deals.filter((d) => d.status === 'pending' && !d.locked).length;
  if (!deals.length) throw new Error(`No closings uploaded for ${team} in ${MONTHS[month]} ${year}.`);

  /* One canonical origin, never a comma-joined CORS list: a broker link mailed
   * with a mangled host is unrecoverable once sent. */
  const base = String(env.APP_ORIGIN || 'https://app.truhq.co').split(',')[0].trim().replace(/\/$/, '');
  const link = `${base}/#/confirm?t=${encodeURIComponent(token)}`;

  const { subject, html } = buildVerificationEmail({
    team: String(list.team || team),
    year: Number(list.year || year),
    month: Number(list.month || month),
    deals,
    link,
  });

  const sent = await sendViaResend(env, { to: recipients, subject, html });

  /* Which team this went to. team_id is NOT NULL — a null once made every
   * insert here fail silently while four real rounds went out unrecorded. The
   * round itself is in closing_verifications either way; this table is the
   * record of WHO was mailed. */
  const teamRow = (await database.select('teams', `select=id&name=ilike.${encodeURIComponent(team)}`)) as {
    id?: string;
  }[];
  const teamId = teamRow[0]?.id ?? null;

  try {
    await database.insert('broker_email_sends', {
      team_id: teamId,
      close_year: Number(list.year || closeYear),
      close_month: Number(list.month || closeMonth),
      to_email: to,
      gmail_message_id: sent.messageId,
      status: 'sent',
    });
  } catch (e) {
    // The mail has already gone. Losing the record is a smaller problem than
    // reporting a failure that would have him send it again.
    console.warn('[verification] send not recorded:', (e as Error)?.message);
  }

  return {
    team: String(list.team || team),
    to,
    deals: deals.length,
    outstanding,
    link,
    messageId: sent.messageId,
  };
}

const ALLOWED_OUTCOMES = new Set(['confirmed', 'cancelled', 'moved']);

/* Locked or already-answered deals are real refusals. Anything else from the
 * broker-token path (expired round, deal uploaded after the email) is why
 * Eric hits Confirm himself, so those fall through to a direct write. */
export function isHardClosingRefusal(message: string): boolean {
  return /already invoiced|already (confirmed|cancelled|canceled|moved)/i.test(message);
}

/* Keep the day-of-month when a deal moves, clamped to the destination month.
 * February 31 is not a date; the last real day is. */
export function closeDateForMove(newYear: number, newMonth: number, fromDate?: string | null): string {
  const lastDay = new Date(newYear, newMonth, 0).getDate();
  const rawDay = fromDate && /^\d{4}-\d{2}-\d{2}/.test(fromDate) ? Number(fromDate.slice(8, 10)) : 1;
  const day = Number.isFinite(rawDay) && rawDay > 0 ? Math.min(rawDay, lastDay) : 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/* Eric's own write. The broker token path can expire, close, or omit a deal
 * uploaded after the email went out — and that is exactly when he reaches for
 * Confirm himself. Updates the closing row; never deletes. Invoiced deals stay
 * locked. */
async function writeClosingOutcome(
  database: Db,
  {
    closingId,
    outcome,
    newYear,
    newMonth,
  }: {
    closingId: string;
    outcome: string;
    newYear?: number;
    newMonth?: number;
  },
): Promise<{ ok: true; outcome: string; remaining: null; address: string | null }> {
  const rows = await database.select(
    'closings',
    `select=id,invoice_id,verify_status,close_date,address,client_name,team_id&id=eq.${closingId}`,
  );
  const closing = (rows as {
    id: string;
    invoice_id: string | null;
    verify_status: string | null;
    close_date: string | null;
    address: string | null;
    client_name: string | null;
    team_id: string;
  }[])[0];
  if (!closing) throw new Error("That deal is not on this team's month. Nothing was changed.");
  if (closing.invoice_id) throw new Error('That deal is already invoiced. Nothing was changed.');
  if (closing.verify_status && closing.verify_status !== 'pending') {
    throw new Error(`That deal is already ${closing.verify_status}. Nothing was changed.`);
  }

  const patch: Record<string, unknown> = {};
  if (outcome === 'moved') {
    if (!newYear || !newMonth) throw new Error('A moved deal needs the month it actually closed in.');
    patch.close_date = closeDateForMove(newYear, newMonth, closing.close_date);
    patch.verify_status = 'moved';
    patch.verified_at = new Date().toISOString();
  } else if (outcome === 'confirmed') {
    patch.verify_status = 'confirmed';
    patch.verified_at = new Date().toISOString();
  } else {
    patch.verify_status = 'cancelled';
  }

  await database.update('closings', `id=eq.${closingId}&team_id=eq.${closing.team_id}`, patch);

  return {
    ok: true,
    outcome,
    remaining: null,
    address: closing.address || closing.client_name || null,
  };
}

/* Eric answers a deal himself when the broker never used the email.
 *
 * Try the same verification round the email uses first — that keeps the
 * broker's page in sync. If that round cannot take the answer (expired,
 * finished, or the deal was uploaded after the email), write the closing
 * directly. The route above this is admin-gated, so the direct write runs
 * with the service role. Nothing here DELETEs. */
export async function adminRespond(
  database: Db,
  {
    team,
    year,
    month,
    closingId,
    outcome,
    newYear,
    newMonth,
  }: {
    team?: string;
    year?: number;
    month?: number;
    closingId?: string;
    outcome?: string;
    newYear?: number;
    newMonth?: number;
  },
): Promise<{ ok: true; outcome: string; remaining: number | null; address: string | null }> {
  if (!team) throw new Error('Which team?');
  if (!year || !month) throw new Error('Which month?');
  if (!closingId) throw new Error('Which deal?');
  const act = String(outcome || '');
  if (!ALLOWED_OUTCOMES.has(act)) throw new Error('Confirm, fell out, or moved — nothing else.');
  if (act === 'moved' && (!newYear || !newMonth)) {
    throw new Error('A moved deal needs the month it actually closed in.');
  }

  const close = closeMonthFromBilling(year, month);

  try {
    const started = (await database.rpc('tru_start_verification', {
      p_team_name: team,
      p_year: close.year,
      p_month: close.month,
    })) as Record<string, unknown>;
    const token = String(started?.token || '');
    if (!token) throw new Error("Could not open this team's confirmation round.");

    const listed = ((await database.rpc('tru_verify_list', { p_token: token }, 'anon')) || {}) as Record<string, unknown>;
    const deals = (Array.isArray(listed.deals) ? listed.deals : []) as Deal[];
    const deal = deals.find((d) => d.id === closingId);
    if (!deal) throw new Error("That deal is not on this team's month. Nothing was changed.");
    if (deal.locked) throw new Error('That deal is already invoiced. Nothing was changed.');
    if (deal.status !== 'pending') {
      throw new Error(`That deal is already ${deal.status}. Nothing was changed.`);
    }

    const answered = (await database.rpc(
      'tru_verify_respond',
      {
        p_token: token,
        p_closing_id: closingId,
        p_outcome: act,
        p_new_year: act === 'moved' ? newYear : null,
        p_new_month: act === 'moved' ? newMonth : null,
      },
      'anon',
    )) as Record<string, unknown>;

    const remaining = typeof answered?.remaining === 'number' ? (answered.remaining as number) : null;

    return {
      ok: true,
      outcome: act,
      remaining,
      address: deal.address || deal.client_name || null,
    };
  } catch (err) {
    const msg = (err as Error).message || '';
    if (isHardClosingRefusal(msg)) throw err;
    return writeClosingOutcome(database, { closingId, outcome: act, newYear, newMonth });
  }
}
