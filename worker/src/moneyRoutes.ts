// The Money admin surface — every route the Revenue page acts through.
//
// Mounted INSIDE index.ts's /admin/ gate (valid session + a row in `admins`),
// same pattern as handleAutomationRoutes: returns null for anything it does
// not own so the existing /admin routes are untouched. The caller has already
// refused impersonated sessions — invoicing while acting as a team is exactly
// the wrong state to bill from.
//
// Mutations return the ToolResult contract flattened to HTTP: success is
// { message } (a plain sentence), a refusal is { error } with a 4xx/5xx.

import type { Env } from './env.js';
import type { Db } from './db.js';
import * as money from './money.js';
import * as verification from './verification.js';
import { importClosings } from './closingsImport.js';

type Json = (body: unknown, status?: number) => Response;

function num(v: string | null): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toolResponse(result: money.ToolResult, json: Json): Response {
  if (typeof result === 'string') return json({ message: result });
  return json({ error: result.text }, 422);
}

export async function handleMoneyRoutes(
  req: Request,
  env: Env,
  url: URL,
  { database, json }: { database: Db; json: Json },
): Promise<Response | null> {
  if (!url.pathname.startsWith('/admin/money/')) return null;
  const path = url.pathname.slice('/admin/money'.length);
  const body =
    req.method === 'POST' ? ((await req.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (req.method === 'POST' && !body) return json({ error: 'invalid body' }, 422);

  try {
    // One call renders the whole page: totals, teams with rate cards, which
    // rounds are out, recent invoices.
    if (path === '/overview' && req.method === 'GET') {
      const year = num(url.searchParams.get('year'));
      const month = num(url.searchParams.get('month'));
      if (!year || !month || month > 12) return json({ error: 'year and month are required' }, 422);
      const [overview, teams, rounds, invoices] = await Promise.all([
        money.moneyOverview(database, year, month),
        money.listTeams(database),
        verification.listRounds(database, year, month),
        money.listInvoices(database, 30),
      ]);
      return json({ overview, teams, rounds, invoices });
    }

    if (path === '/team-month' && req.method === 'GET') {
      const team = String(url.searchParams.get('team') || '');
      const year = num(url.searchParams.get('year'));
      const month = num(url.searchParams.get('month'));
      if (!team || !year || !month || month > 12) return json({ error: 'team, year and month are required' }, 422);
      return json(await money.monthClosings(database, team, year, month));
    }

    if (path === '/team-pay' && req.method === 'POST') {
      const saved = await money.saveTeamPay(database, {
        teamId: String(body!.teamId || ''),
        retainer: body!.retainer as number,
        defaultRate: (body!.defaultRate ?? null) as number | null,
        rates: (body!.rates ?? []) as { source?: string; rate?: number; thresholdDeals?: number }[],
      });
      return json({ message: `Saved — ${saved.rates} rate row(s) on file.`, ...saved });
    }

    if (path === '/brokers' && req.method === 'GET') {
      const team = String(url.searchParams.get('team') || '');
      if (!team) return json({ error: 'which team?' }, 422);
      return json({ brokers: await money.listBrokers(database, team) });
    }

    if (path === '/broker-email' && req.method === 'POST') {
      return json(
        await money.setBrokerEmail(database, {
          team: String(body!.team || ''),
          email: String(body!.email || ''),
          name: body!.name ? String(body!.name) : undefined,
        }),
      );
    }

    if (path === '/send-verification' && req.method === 'POST') {
      const sent = await verification.sendVerification(database, env, {
        team: String(body!.team || ''),
        year: Number(body!.year),
        month: Number(body!.month),
        toEmail: body!.toEmail ? String(body!.toEmail) : undefined,
      });
      return json(sent);
    }

    if (path === '/confirm-deal' && req.method === 'POST') {
      const answered = await verification.adminRespond(database, {
        team: String(body!.team || ''),
        year: Number(body!.year),
        month: Number(body!.month),
        closingId: String(body!.closingId || ''),
        outcome: String(body!.outcome || ''),
        newYear: body!.newYear ? Number(body!.newYear) : undefined,
        newMonth: body!.newMonth ? Number(body!.newMonth) : undefined,
      });
      return json(answered);
    }

    if (path === '/preview-team' && req.method === 'GET') {
      const team = String(url.searchParams.get('team') || '');
      const year = num(url.searchParams.get('year'));
      const month = num(url.searchParams.get('month'));
      if (!team || !year || !month || month > 12) return json({ error: 'team, year and month are required' }, 422);
      const ready = await money.previewForBillingMonth(database, team, year, month);
      if ('error' in ready) return json({ error: ready.text }, 422);
      return json(ready);
    }

    if (path === '/invoice-team' && req.method === 'POST') {
      return toolResponse(
        await money.invoiceTeamBillingMonth(database, env, {
          team: String(body!.team || ''),
          year: Number(body!.year),
          month: Number(body!.month),
          send: body!.send === true,
          brokerEmail: body!.brokerEmail ? String(body!.brokerEmail) : undefined,
        }),
        json,
      );
    }

    if (path === '/invoice/send' && req.method === 'POST') {
      return toolResponse(
        await money.sendInvoice(database, env, {
          invoiceId: String(body!.invoiceId || ''),
          teamLabel: body!.teamLabel ? String(body!.teamLabel) : undefined,
        }),
        json,
      );
    }

    if (path === '/invoice/void' && req.method === 'POST') {
      return toolResponse(
        await money.voidInvoice(database, env, {
          invoiceId: String(body!.invoiceId || ''),
          teamLabel: body!.teamLabel ? String(body!.teamLabel) : undefined,
        }),
        json,
      );
    }

    if (path === '/import' && req.method === 'POST') {
      const result = await importClosings(database, {
        team: String(body!.team || ''),
        source: String(body!.source || ''),
        deals: (body!.deals ?? []) as { client_name?: string; close_date?: string }[],
      });
      return json(result);
    }

    return json({ error: 'not found' }, 404);
  } catch (err) {
    // Refusals thrown by the library and the database carry readable
    // sentences ("no team called X", "already sent this month") — hand those
    // to the screen instead of a generic failure.
    return json({ error: (err as Error).message || 'something went wrong' }, 422);
  }
}
