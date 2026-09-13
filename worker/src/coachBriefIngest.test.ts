// Preserve the current authenticated team-directory contract beside the restored receipt routes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import { handleCoachBriefIngest } from './coachBriefIngest.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

const SYNERGY_ID = '213f7da9-6c3d-425e-86e6-a32d16db32a3';
const SB_REALTY_ID = 'df216d4d-b05e-4ddf-a84e-0d685182d692';
const SB_REALTY_DUPLICATE_ID = '44c29c54-1814-4730-afb7-f0eab46a2e88';

let env: Env;
let ctx: ExecutionContext;
/** Every PostgREST request the Worker made: [method, path+search, body]. */
let calls: Array<{ method: string; path: string; body: unknown }>;
/** The fake `teams` table — filtered by the mock like PostgREST would filter it. */
let teamsTable: Array<{ id: string; org_id: string; name: string; report_slug: string | null; is_active?: boolean; fub_subdomain?: string }>;
let rosterRows: Array<{ id: string; name: string }>;
let heldRows: Array<Record<string, unknown>>;
let connectionRows: Array<{ team_id: string }>;

beforeEach(() => {
  env = {
    SUPABASE_URL: SUPA,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ADMIN_TOKEN: 'ops',
    COACH_INGEST_TOKEN: 'brief-secret',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  calls = [];
  teamsTable = [
    { id: 'aaaaaaaa-1111-4111-8111-111111111111', org_id: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'Costigan', report_slug: 'costigan' },
    { id: '3a84fd98-13f2-46e7-83a2-a1ed3aeadab7', org_id: '100630b4-4bd0-4f74-bf70-4bf798f7ef9c', name: 'Signature Realty', report_slug: 'signature' },
    { id: '8b61c008-c8b1-4fb6-9de7-093b21a09a22', org_id: '9e61053e-196d-47c1-af69-3d1573e5734f', name: 'Scott Moore Group', report_slug: 'scott-moore' },
    { id: '96ddb98f-1fb6-4d99-80f6-20ef615dec34', org_id: 'fed61cea-31cd-4d26-a195-9772a8ecfc9c', name: 'Woosley Group', report_slug: 'woosley' },
    { id: SYNERGY_ID, org_id: 'aecd859e-20bf-4648-9526-1d9904a794c4', name: 'The Synergy Group NJ', report_slug: null },
    { id: SB_REALTY_ID, org_id: '1ce65a99-c7d1-45f0-8140-ed387c2f6359', name: 'SB Realty', report_slug: null },
    { id: SB_REALTY_DUPLICATE_ID, org_id: 'e4044210-945e-4920-9bdf-cc5d7cf0a8d8', name: 'Sb Realty', report_slug: null },
  ];
  rosterRows = [
    { id: 'cccccccc-3333-4333-8333-333333333333', name: 'Adam Walters' },
    { id: 'dddddddd-4444-4444-8444-444444444444', name: 'Jordan Blake' },
  ];
  heldRows = [];
  connectionRows = [{ team_id: SB_REALTY_ID }];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (u.pathname === '/rest/v1/teams') {
      const idFilter = u.searchParams.get('id');
      const slugFilter = u.searchParams.get('report_slug');
      const activeTeams = teamsTable.filter(t => u.searchParams.get('is_active') !== 'eq.true' || t.is_active !== false);
      if (idFilter) return ok(activeTeams.filter((t) => idFilter === `eq.${t.id}`));
      if (slugFilter) return ok(activeTeams.filter((t) => slugFilter === `eq.${t.report_slug}`));
      return ok(activeTeams); // GET /coach/teams: select=id,name&is_active=eq.true
    }
    if (u.pathname === '/rest/v1/fub_connections') return ok(connectionRows);
    if (u.pathname === '/rest/v1/orgs') return ok([{ id: '1ce65a99-c7d1-45f0-8140-ed387c2f6359', name: 'Example Brokerage' }]);
    if (u.pathname === '/rest/v1/leaders') return ok([{ id: 'leader-1', team_id: SB_REALTY_ID, name: 'Alex Leader', email: 'must-not-return@example.com' }]);
    if (u.pathname === '/rest/v1/agents') return ok(rosterRows);
    if (u.pathname === '/rest/v1/coach_weekly_reports' && (init?.method ?? 'GET') === 'GET') return ok(heldRows);
    if (u.pathname === '/rest/v1/coach_weekly_reports') return ok([], 201);
    return ok([]);
  }));
});

describe('GET /coach/teams', () => {
  function get(token = 'brief-secret'): Promise<Response> {
    return worker.fetch(
      new Request('https://api.truhq.co/coach/teams', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      env, ctx,
    );
  }

  it('rejects a wrong or missing token, same secret as the ingest door', async () => {
    expect((await get('wrong')).status).toBe(401);
    expect((await get('')).status).toBe(401);
    expect((await get('ops')).status).toBe(401); // admin token still doesn't work here
  });

  it('lists teams with only the minimum fields, never FUB keys or tokens', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json() as { teams: Array<Record<string, unknown>> };
    const synergy = body.teams.find((t) => t.teamId === SYNERGY_ID);
    expect(synergy).toEqual({ teamId: SYNERGY_ID, name: 'The Synergy Group NJ', connected: false, organizationName: null, fubSubdomain: null, leaderNames: [] });
    expect(Object.keys(synergy!).sort()).toEqual(['connected', 'fubSubdomain', 'leaderNames', 'name', 'organizationName', 'teamId']);

    const sbRealty = body.teams.find((t) => t.teamId === SB_REALTY_ID);
    expect(sbRealty?.connected).toBe(true);

    const duplicate = body.teams.find((t) => t.teamId === SB_REALTY_DUPLICATE_ID);
    expect(duplicate?.connected).toBe(false);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/token|email|api_key|must-not-return/i);
    expect(sbRealty).toMatchObject({ organizationName: 'Example Brokerage', leaderNames: ['Alex Leader'] });
    expect(duplicate).toMatchObject({ organizationName: null, leaderNames: [] });
  });

  it('includes account identity without folding same-named teams together and excludes inactive teams', async () => {
    teamsTable.find(t => t.id === SB_REALTY_ID)!.fub_subdomain = 'sbrealty';
    teamsTable.find(t => t.id === SB_REALTY_DUPLICATE_ID)!.is_active = false;
    const body = await (await get()).json() as { teams: Array<Record<string, unknown>> };
    expect(body.teams.find(t => t.teamId === SB_REALTY_ID)?.fubSubdomain).toBe('sbrealty');
    expect(body.teams.some(t => t.teamId === SB_REALTY_DUPLICATE_ID)).toBe(false);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
    expect(calls.some(c => /select=.*email/.test(c.path))).toBe(false);
  });
});

it('routes receipt lookups to the scoped receiver without legacy token fallback',async()=>{
 const url=new URL('https://offline.test/coach/weekly-report/receipt?teamId=11111111-1111-4111-8111-111111111111&runId=test');
 const res=await handleCoachBriefIngest(new Request(url),{} as Env,url,{},{} as any);
 expect(res!.status).toBe(503);
});
