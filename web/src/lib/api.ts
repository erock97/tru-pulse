import { supabase } from './supabase';

const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

/** ?demo=1 → render the dashboard with seeded data, no auth, no backend. */
export const isDemo =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}

/** RLS returns only the caller's org, so limit(1) is the user's org. */
export async function myOrg(): Promise<{ id: string; name: string; plan: string } | null> {
  const { data } = await supabase.from('orgs').select('id,name,plan').limit(1);
  return (data?.[0] as { id: string; name: string; plan: string }) ?? null;
}

export async function provisionOrg(
  orgName: string,
  teams: Array<{ name: string; fubKey: string; subdomain?: string }>,
): Promise<{ orgId: string; teamIds: string[] }> {
  const res = await fetch(WORKER_URL + '/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ orgName, teams }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; orgId?: string; teamIds?: string[] };
  if (!res.ok) throw new Error(body.error ?? 'Provisioning failed');
  return body as { orgId: string; teamIds: string[] };
}

export async function triggerSync(): Promise<unknown> {
  if (isDemo) return {};
  const res = await fetch(WORKER_URL + '/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await token()) },
  });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

/** Update the org's thresholds / audit math. Writes go through the Worker (RLS
 *  keeps the browser read-only), which patches org_settings with the service role. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (isDemo) return;
  const res = await fetch(WORKER_URL + '/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Save failed');
}

export interface LeadRow {
  team_id: string;
  assigned_to: string | null;
  flag: string | null;
  source_family: string | null;
  name?: string | null;
  stage?: string | null;
  fub_person_id?: number | null;
  fub_created?: string | null;
  pond?: string | null;
}
export interface AgentRow {
  name: string;
  email: string | null;
  phone: string | null;
}
export interface DealRow {
  team_id: string;
  stage: string | null;
  stage_class: string | null;   // offer | uc | closed | other
  price: number | null;
  commission: number | null;
  agent_name: string | null;
  projected_close: string | null;
  fub_created: string | null;
}
export interface CaseRow {
  assigned_to: string | null;
  status: string;
  opened_at: string;
}
export interface Settings {
  avg_gci: number;
  close_rate: number;
  window_hours: number;
  strike_limit: number;
  per_agent_capacity: number;
}
export interface DashboardData {
  teams: Array<{ id: string; name: string; fub_subdomain: string | null }>;
  settings: Settings | null;
  leads: LeadRow[];
  cases: CaseRow[];
  agents: AgentRow[];
  deals: DealRow[];
}

export async function loadDashboard(): Promise<DashboardData> {
  if (isDemo) return demoDashboard();
  const sinceIso = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [teams, settings, leads, cases, agents, deals] = await Promise.all([
    supabase.from('teams').select('id,name,fub_subdomain'),
    supabase.from('org_settings').select('avg_gci,close_rate,window_hours,strike_limit,per_agent_capacity').limit(1),
    supabase.from('leads').select('team_id,assigned_to,flag,source_family,name,stage,fub_person_id,fub_created,pond'),
    supabase.from('accountability_cases').select('assigned_to,status,opened_at').gte('opened_at', sinceIso),
    supabase.from('agents').select('name,email,phone'),
    // Degrades to [] until the deals table exists (supabase-js returns an error, not a throw).
    supabase.from('deals').select('team_id,stage,stage_class,price,commission,agent_name,projected_close,fub_created'),
  ]);
  return {
    teams: (teams.data as DashboardData['teams']) ?? [],
    settings: (settings.data?.[0] as Settings) ?? null,
    leads: (leads.data as LeadRow[]) ?? [],
    cases: (cases.data as CaseRow[]) ?? [],
    agents: (agents.data as AgentRow[]) ?? [],
    deals: (deals.data as DealRow[]) ?? [],
  };
}

// ── demo data (mirrors the mockup; aggregates to 543 / 21 / 67 / ~84%) ──────────
function demoDashboard(): DashboardData {
  const agentSpec: Array<[string, number, number, number, number, number]> = [
    ['Trevor Holland', 62, 8, 12, 42, 4],
    ['Jordan Blake', 58, 6, 14, 38, 3],
    ['Dana Cole', 71, 5, 9, 57, 2],
    ['Priya Nair', 49, 2, 6, 41, 1],
    ['Marcus Delgado', 55, 0, 8, 47, 1],
    ['Maria Lopez', 44, 0, 3, 41, 0],
    ['Sam Whitfield', 38, 0, 2, 36, 0],
    ['Unassigned', 166, 0, 13, 153, 0],
  ];
  const srcDist: Array<[string, number]> = [
    ['Zillow', 210],
    ['Realtor.com', 140],
    ['Homes.com', 80],
    ['Facebook', 70],
    ['Google', 28],
    ['Referrals', 15],
  ];
  const srcPool: string[] = [];
  srcDist.forEach(([name, n]) => {
    for (let i = 0; i < n; i++) srcPool.push(name);
  });
  let si = 0;
  const leads: LeadRow[] = [];
  const cases: CaseRow[] = [];
  for (const [name, paid, zero, stuck, , strikes] of agentSpec) {
    for (let i = 0; i < paid; i++) {
      const flag = i < zero ? 'zero_contact' : i < zero + stuck ? 'stuck' : 'worked';
      const ponded = name === 'Unassigned';
      leads.push({
        team_id: 'demo',
        assigned_to: ponded ? null : name,
        flag,
        source_family: srcPool[si++ % srcPool.length],
        pond: ponded ? 'New Buyer Pond' : null,
      });
    }
    for (let s = 0; s < strikes; s++) {
      cases.push({ assigned_to: name, status: 'open', opened_at: new Date(Date.now() - (s + 1) * 3 * 86400_000).toISOString() });
    }
  }
  // Demo deals: 27 closings (16 closed + 11 UC) off 543 leads ≈ 1:20, and
  // 54 offer-or-beyond ≈ 10% offer rate — the numbers the pitch tells.
  const dayMs = 86400_000;
  const deals: DealRow[] = [];
  const dealAgents = ['Trevor Holland', 'Jordan Blake', 'Dana Cole', 'Priya Nair', 'Marcus Delgado', 'Maria Lopez'];
  const mk = (n: number, cls: string, stage: string, closeInDays: number) => {
    for (let i = 0; i < n; i++) {
      deals.push({
        team_id: 'demo', stage, stage_class: cls,
        price: 380_000 + (i % 7) * 45_000, commission: 9_000 + (i % 5) * 1_800,
        agent_name: dealAgents[i % dealAgents.length],
        projected_close: new Date(Date.now() + closeInDays * dayMs - (i % 20) * dayMs).toISOString(),
        fub_created: new Date(Date.now() - (5 + (i % 22)) * dayMs).toISOString(),
      });
    }
  };
  mk(16, 'closed', 'Closed', -2);
  mk(11, 'uc', 'Pending', 18);
  mk(27, 'offer', 'Offer', 30);
  return {
    teams: [{ id: 'demo', name: 'Main office', fub_subdomain: null }],
    settings: { avg_gci: 10000, close_rate: 2, window_hours: 48, strike_limit: 3, per_agent_capacity: 20 },
    leads,
    cases,
    agents: [],
    deals,
  };
}
