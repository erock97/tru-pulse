// The contract for the ONE unauthenticated-by-cookie write surface the Hermes
// laptop uses: its dedicated secret must fail closed, a malformed payload must
// 4xx (so the laptop's retry loop stops), an unknown team identifier must HOLD
// the report rather than lose it, and agent names must never be guessed.
//
// Team resolution has three tiers, tried in order: a direct TrueHQ team UUID,
// a permanent alias, then the legacy report_slug lookup. teamsTable below
// mirrors the real production rows (legacy teams plus the two new ones and
// their disconnected same-named duplicate) so these tests exercise the actual
// resolution order, not just a single stubbed row.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
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
let teamsTable: Array<{ id: string; org_id: string; name: string; report_slug: string | null }>;
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
      if (idFilter) return ok(teamsTable.filter((t) => idFilter === `eq.${t.id}`));
      if (slugFilter) return ok(teamsTable.filter((t) => slugFilter === `eq.${t.report_slug}`));
      return ok(teamsTable); // GET /coach/teams: select=id,name&is_active=eq.true
    }
    if (u.pathname === '/rest/v1/fub_connections') return ok(connectionRows);
    if (u.pathname === '/rest/v1/agents') return ok(rosterRows);
    if (u.pathname === '/rest/v1/coach_weekly_reports' && (init?.method ?? 'GET') === 'GET') return ok(heldRows);
    if (u.pathname === '/rest/v1/coach_weekly_reports') return ok([], 201);
    return ok([]);
  }));
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    run: {
      runId: 'costigan-2026-08-16', trigger: 'weekly', teamId: 'costigan',
      teamName: 'Costigan', startDate: '2026-08-16', endDate: '2026-08-22',
      generatedAt: '2026-08-23T12:00:00Z', status: 'complete',
      ...(overrides.run as Record<string, unknown> ?? {}),
    },
    agents: overrides.agents ?? [
      { agentName: 'adam walters', metrics: { reviewedContacts: 12 }, doingRight: ['Calls first'], opportunities: [], objections: [], coachingActions: [] },
      { agentName: 'Somebody Unknown', metrics: {}, doingRight: [], opportunities: [], objections: [], coachingActions: [] },
    ],
    findings: overrides.findings ?? [],
  };
}

function send(body: unknown, token = 'brief-secret'): Promise<Response> {
  return worker.fetch(
    new Request('https://api.truhq.co/coach/weekly-report', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env, ctx,
  );
}

async function resolvedTeamId(teamId: string): Promise<{ status: number; teamResolved: boolean; upsertedTeamId: unknown }> {
  const res = await send(payload({ run: { teamId } }));
  const body = await res.json() as { status: string; teamResolved: boolean };
  const upsert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/coach_weekly_reports'));
  const row = (upsert!.body as Array<Record<string, unknown>>)[0];
  return { status: res.status, teamResolved: body.teamResolved, upsertedTeamId: row.team_id };
}

describe('POST /coach/weekly-report', () => {
  it('rejects a wrong token, and fails closed when no token is configured', async () => {
    expect((await send(payload(), 'wrong')).status).toBe(401);
    delete (env as unknown as Record<string, unknown>).COACH_INGEST_TOKEN;
    expect((await send(payload(), 'brief-secret')).status).toBe(401);
    // Nothing was written on either attempt.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('never accepts the admin token in place of the brief secret', async () => {
    expect((await send(payload(), 'ops')).status).toBe(401);
  });

  it('4xxs malformed bodies so the sender retry loop stops', async () => {
    expect((await send('this is not json')).status).toBe(422);
    const missingRunId = payload();
    delete (missingRunId.run as Record<string, unknown>).runId;
    const res = await send(missingRunId);
    expect(res.status).toBe(422);
    const body = await res.json() as { details: string[] };
    expect(body.details.join(' ')).toContain('runId');
  });

  it('publishes a weekly run for a known team and links agents without guessing', async () => {
    const res = await send(payload());
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean; status: string; teamResolved: boolean;
      agents: { matched: string[]; unmatched: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('published');
    expect(body.teamResolved).toBe(true);
    expect(body.agents.matched).toEqual(['adam walters']);
    expect(body.agents.unmatched).toEqual(['Somebody Unknown']);

    const upsert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/coach_weekly_reports'));
    expect(upsert).toBeTruthy();
    expect(upsert!.path).toContain('on_conflict=run_id');
    const row = (upsert!.body as Array<Record<string, unknown>>)[0];
    expect(row.run_id).toBe('costigan-2026-08-16');
    expect(row.team_id).toBe('aaaaaaaa-1111-4111-8111-111111111111');
    expect(row.status).toBe('published');
    // The unknown name is ABSENT from links — held back, not guessed.
    expect(row.agent_links).toEqual({ 'adam walters': 'cccccccc-3333-4333-8333-333333333333' });
  });

  it('holds a report whose team identifier is not mapped yet, without losing it', async () => {
    teamsTable = [];
    const res = await send(payload());
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; teamResolved: boolean };
    expect(body.status).toBe('held');
    expect(body.teamResolved).toBe(false);
    const upsert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/coach_weekly_reports'));
    const row = (upsert!.body as Array<Record<string, unknown>>)[0];
    expect(row.team_id).toBeNull();
    expect(row.status).toBe('held');
  });

  it('stores a personal on-demand run as held — never published to the tab', async () => {
    const res = await send(payload({ run: { trigger: 'personal' } }));
    const body = await res.json() as { status: string };
    expect(body.status).toBe('held');
  });

  it('gives previously held reports a second chance once their team exists', async () => {
    heldRows = [{
      id: 'eeeeeeee-5555-4555-8555-555555555555',
      team_slug: 'costigan',
      run_trigger: 'weekly',
      payload: { agents: [{ agentName: 'Jordan Blake' }] },
    }];
    await send(payload());
    const patch = calls.find((c) => c.method === 'PATCH'
      && c.path.includes('id=eq.eeeeeeee-5555-4555-8555-555555555555'));
    expect(patch).toBeTruthy();
    const patchBody = patch!.body as Record<string, unknown>;
    expect(patchBody.status).toBe('published');
    expect(patchBody.team_id).toBe('aaaaaaaa-1111-4111-8111-111111111111');
    expect(patchBody.agent_links).toEqual({ 'Jordan Blake': 'dddddddd-4444-4444-8444-444444444444' });
  });

  describe('team resolution — UUID, alias, and legacy slug', () => {
    it('resolves the Synergy team by its direct TrueHQ UUID', async () => {
      const r = await resolvedTeamId(SYNERGY_ID);
      expect(r.teamResolved).toBe(true);
      expect(r.upsertedTeamId).toBe(SYNERGY_ID);
    });

    it('resolves the connected SB Realty team by its direct TrueHQ UUID', async () => {
      const r = await resolvedTeamId(SB_REALTY_ID);
      expect(r.teamResolved).toBe(true);
      expect(r.upsertedTeamId).toBe(SB_REALTY_ID);
    });

    it('resolves the alias the-synergy-group-nj to the Synergy UUID', async () => {
      const r = await resolvedTeamId('the-synergy-group-nj');
      expect(r.teamResolved).toBe(true);
      expect(r.upsertedTeamId).toBe(SYNERGY_ID);
    });

    it('resolves the alias sb-realty to the connected team, never the disconnected duplicate', async () => {
      const r = await resolvedTeamId('sb-realty');
      expect(r.teamResolved).toBe(true);
      expect(r.upsertedTeamId).toBe(SB_REALTY_ID);
      expect(r.upsertedTeamId).not.toBe(SB_REALTY_DUPLICATE_ID);
    });

    it.each([
      ['signature', '3a84fd98-13f2-46e7-83a2-a1ed3aeadab7'],
      ['costigan', 'aaaaaaaa-1111-4111-8111-111111111111'],
      ['scott-moore', '8b61c008-c8b1-4fb6-9de7-093b21a09a22'],
      ['woosley', '96ddb98f-1fb6-4d99-80f6-20ef615dec34'],
    ])('still resolves the legacy slug %s', async (slug, expectedId) => {
      const r = await resolvedTeamId(slug);
      expect(r.teamResolved).toBe(true);
      expect(r.upsertedTeamId).toBe(expectedId);
    });

    it('holds, rather than guesses, an unrecognized alias-shaped identifier', async () => {
      const r = await resolvedTeamId('some-other-team');
      expect(r.status).toBe(200);
      expect(r.teamResolved).toBe(false);
      expect(r.upsertedTeamId).toBeNull();
    });

    it('holds a well-formed but unknown UUID rather than falling back to slug matching', async () => {
      const r = await resolvedTeamId('00000000-0000-4000-8000-000000000000');
      expect(r.status).toBe(200);
      expect(r.teamResolved).toBe(false);
      expect(r.upsertedTeamId).toBeNull();
    });
  });
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
    expect(synergy).toEqual({ teamId: SYNERGY_ID, name: 'The Synergy Group NJ', connected: false });
    expect(Object.keys(synergy!).sort()).toEqual(['connected', 'name', 'teamId']);

    const sbRealty = body.teams.find((t) => t.teamId === SB_REALTY_ID);
    expect(sbRealty?.connected).toBe(true);

    const duplicate = body.teams.find((t) => t.teamId === SB_REALTY_DUPLICATE_ID);
    expect(duplicate?.connected).toBe(false);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/fub|token|email|api_key/i);
  });
});
