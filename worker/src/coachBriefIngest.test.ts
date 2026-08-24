// The contract for the ONE unauthenticated-by-cookie write surface the Hermes
// laptop uses: its dedicated secret must fail closed, a malformed payload must
// 4xx (so the laptop's retry loop stops), an unknown team slug must HOLD the
// report rather than lose it, and agent names must never be guessed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

let env: Env;
let ctx: ExecutionContext;
/** Every PostgREST request the Worker made: [method, path+search, body]. */
let calls: Array<{ method: string; path: string; body: unknown }>;
/** What the fake teams table returns for a report_slug lookup. */
let teamRows: Array<{ id: string; org_id: string }>;
let rosterRows: Array<{ id: string; name: string }>;
let heldRows: Array<Record<string, unknown>>;

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
  teamRows = [{ id: 'aaaaaaaa-1111-4111-8111-111111111111', org_id: 'bbbbbbbb-2222-4222-8222-222222222222' }];
  rosterRows = [
    { id: 'cccccccc-3333-4333-8333-333333333333', name: 'Adam Walters' },
    { id: 'dddddddd-4444-4444-8444-444444444444', name: 'Jordan Blake' },
  ];
  heldRows = [];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (u.pathname === '/rest/v1/teams') return ok(teamRows);
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

  it('holds a report whose team slug is not mapped yet, without losing it', async () => {
    teamRows = [];
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
});
