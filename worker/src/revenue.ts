// Retainer + per-deal payout — Terrason Consulting's own billing, owned by
// this database. Ported from TRU Operating System (a separate app that used
// to run this); the fee math (threshold ramps, per-source rate cards) lives
// in the closing_ledger() SQL function, copied over verbatim rather than
// re-derived, since re-deriving it once already produced a real billing
// error there. This module only reads it.
import type { Env } from './env.js';
import type { Db } from './db.js';

export interface RevenueDeal {
  id: string;
  team_id: string;
  agent_name: string | null;
  address: string | null;
  source: string | null;
  close_date: string | null;
  payout_month: string | null;
  base_fee: number;
  earned_fee: number;
  under_threshold: boolean;
  status: string;
}

export interface RevenueTeam {
  team_id: string;
  team_name: string;
  retainer: number;
  deals: RevenueDeal[];
}

export async function fetchRevenue(env: Env, database: Db): Promise<RevenueTeam[]> {
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  const [teams, settings, ledgerRes] = await Promise.all([
    database.select('teams', 'select=id,name'),
    database.select('team_pay_settings', 'select=team_id,retainer'),
    // closing_ledger() takes no arguments; POSTing an empty object is the
    // standard PostgREST shape for calling a zero-arg RPC.
    fetch(`${base}/rpc/closing_ledger`, { method: 'POST', headers, body: '{}' }),
  ]) as [Array<{ id: string; name: string }>, Array<{ team_id: string; retainer: number }>, Response];

  if (!ledgerRes.ok) {
    throw new Error(`closing_ledger() call failed: ${ledgerRes.status} ${await ledgerRes.text()}`);
  }
  const deals = (await ledgerRes.json()) as RevenueDeal[];

  const retainerByTeam = new Map(settings.map((s) => [s.team_id, s.retainer]));
  const dealsByTeam = new Map<string, RevenueDeal[]>();
  for (const d of deals) dealsByTeam.set(d.team_id, [...(dealsByTeam.get(d.team_id) ?? []), d]);

  return teams
    .filter((t) => retainerByTeam.has(t.id) || dealsByTeam.has(t.id))
    .map((t) => ({
      team_id: t.id,
      team_name: t.name,
      retainer: retainerByTeam.get(t.id) ?? 0,
      deals: dealsByTeam.get(t.id) ?? [],
    }));
}
