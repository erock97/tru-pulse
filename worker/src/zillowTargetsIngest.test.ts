// The contract for the fub-weekly-reports scraper's push: its dedicated
// secret must fail closed, a malformed payload must 4xx (so the scraper's
// retry loop stops), and an unknown team slug must 4xx rather than silently
// drop the data — unlike coach briefs, there is no held-report queue here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

let env: Env;
let ctx: ExecutionContext;
let calls: Array<{ method: string; path: string; body: unknown }>;
let teamRows: Array<{ id: string }>;

beforeEach(() => {
  env = {
    SUPABASE_URL: SUPA,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ADMIN_TOKEN: 'ops',
    ZILLOW_TARGETS_INGEST_TOKEN: 'targets-secret',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  calls = [];
  teamRows = [{ id: 'aaaaaaaa-1111-4111-8111-111111111111' }];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (u.pathname === '/rest/v1/teams') return ok(teamRows);
    return ok([]);
  }));
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    teamSlug: 'costigan',
    capturedAt: '2026-08-30T12:00:00Z',
    sourceRefreshDate: '2026-08-29',
    metrics: [
      { metric: 'six_month', targetValue: 60, actualValue: 27, unit: 'count', periodStart: '2026-06-01', periodEnd: '2026-11-30' },
      { metric: 'zhl', targetValue: 100000, actualValue: 42000, unit: 'currency' },
    ],
    ...overrides,
  };
}

function send(body: unknown, token = 'targets-secret'): Promise<Response> {
  return worker.fetch(
    new Request('https://api.truhq.co/zillow/targets', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env, ctx,
  );
}

describe('POST /zillow/targets', () => {
  it('rejects a wrong token, and fails closed when no token is configured', async () => {
    expect((await send(payload(), 'wrong')).status).toBe(401);
    delete (env as unknown as Record<string, unknown>).ZILLOW_TARGETS_INGEST_TOKEN;
    expect((await send(payload(), 'targets-secret')).status).toBe(401);
    expect(calls.filter((c) => c.method === 'POST' && c.path.includes('zillow_targets'))).toHaveLength(0);
  });

  it('never accepts the admin token in place of the targets secret', async () => {
    expect((await send(payload(), 'ops')).status).toBe(401);
  });

  it('4xxs malformed bodies so the scraper retry loop stops', async () => {
    expect((await send('this is not json')).status).toBe(422);
    const missingMetrics = payload({ metrics: [] });
    const res = await send(missingMetrics);
    expect(res.status).toBe(422);
    const body = await res.json() as { details: string[] };
    expect(body.details.join(' ')).toContain('metrics');
  });

  it('4xxs an unknown team slug rather than holding it', async () => {
    teamRows = [];
    const res = await send(payload());
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('unknown teamSlug');
  });

  it('upserts the snapshot and history rows for a known team', async () => {
    const res = await send(payload());
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; teamId: string; metrics: string[] };
    expect(body.ok).toBe(true);
    expect(body.teamId).toBe('aaaaaaaa-1111-4111-8111-111111111111');
    expect(body.metrics).toEqual(['six_month', 'zhl']);

    const snapshotUpsert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/zillow_targets_snapshot'));
    expect(snapshotUpsert).toBeTruthy();
    expect(snapshotUpsert!.path).toContain('on_conflict=team_id%2Cmetric');
    const rows = snapshotUpsert!.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].team_id).toBe('aaaaaaaa-1111-4111-8111-111111111111');
    expect(rows[0].target_value).toBe(60);
    expect(rows[0].actual_value).toBe(27);

    const historyUpsert = calls.find((c) => c.method === 'POST' && c.path.startsWith('/rest/v1/zillow_targets_history'));
    expect(historyUpsert).toBeTruthy();
    expect(historyUpsert!.path).toContain('on_conflict=team_id%2Cmetric%2Ccaptured_at');
  });

  it('rejects a duplicate metric key in the same push', async () => {
    const res = await send(payload({
      metrics: [
        { metric: 'zhl', targetValue: 1, actualValue: 1, unit: 'count' },
        { metric: 'zhl', targetValue: 2, actualValue: 2, unit: 'count' },
      ],
    }));
    expect(res.status).toBe(422);
  });
});
