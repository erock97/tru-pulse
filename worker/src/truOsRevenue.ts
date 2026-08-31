// Reads Terrason's own retainer + per-deal payout data straight out of TRU
// Operating System's Supabase project — a separate app and a separate
// database from this one. TRU OS already computes the correct payout per
// closing (threshold ramps, per-source rate cards) via its `closing_ledger()`
// function; this calls that directly rather than re-deriving the fee math a
// second time, which is exactly the kind of duplicate logic that produced a
// real billing error there before. This is READ-ONLY — nothing here ever
// writes back to TRU OS.
import type { Env } from './env.js';

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

export async function fetchRevenue(env: Env): Promise<RevenueTeam[] | null> {
  if (!env.TRU_OS_SUPABASE_URL || !env.TRU_OS_SUPABASE_SERVICE_ROLE_KEY) return null;
  const base = env.TRU_OS_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const headers = {
    apikey: env.TRU_OS_SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.TRU_OS_SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  const [teamsRes, settingsRes, ledgerRes] = await Promise.all([
    fetch(`${base}/teams?select=id,name`, { headers }),
    fetch(`${base}/team_pay_settings?select=team_id,retainer`, { headers }),
    // closing_ledger() takes no arguments; POSTing an empty object is the
    // standard PostgREST shape for calling a zero-arg RPC.
    fetch(`${base}/rpc/closing_ledger`, { method: 'POST', headers, body: '{}' }),
  ]);
  if (!teamsRes.ok || !settingsRes.ok || !ledgerRes.ok) {
    throw new Error(
      `TRU OS revenue fetch failed: teams=${teamsRes.status} settings=${settingsRes.status} ledger=${ledgerRes.status}`,
    );
  }

  const teams = (await teamsRes.json()) as Array<{ id: string; name: string }>;
  const settings = (await settingsRes.json()) as Array<{ team_id: string; retainer: number }>;
  const deals = (await ledgerRes.json()) as RevenueDeal[];

  const retainerByTeam = new Map(settings.map((s) => [s.team_id, s.retainer]));
  const dealsByTeam = new Map<string, RevenueDeal[]>();
  for (const d of deals) dealsByTeam.set(d.team_id, [...(dealsByTeam.get(d.team_id) ?? []), d]);

  return teams.map((t) => ({
    team_id: t.id,
    team_name: t.name,
    retainer: retainerByTeam.get(t.id) ?? 0,
    deals: dealsByTeam.get(t.id) ?? [],
  }));
}
