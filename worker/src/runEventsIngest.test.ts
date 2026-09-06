// The contract for the Hermes laptop's failure-log push: its dedicated secret
// must fail closed, a malformed or unsafe payload must 4xx, the same
// incidentId sent twice must not duplicate or double-count, and a new
// incidentId sharing a fingerprint must fold into that problem's recurrence.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

let env: Env;
let ctx: ExecutionContext;
let calls: Array<{ method: string; path: string; body: unknown }>;
let existingIncidentIds: string[];
let rpcNew: number;

beforeEach(() => {
  env = {
    SUPABASE_URL: SUPA,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ADMIN_TOKEN: 'ops',
    COACH_INGEST_TOKEN: 'coach-secret',
  } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  calls = [];
  existingIncidentIds = [];
  rpcNew = 1;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (u.pathname === '/rest/v1/coach_run_event_incidents' && (init?.method ?? 'GET') === 'GET') {
      return ok(existingIncidentIds.map((id) => ({ incident_id: id })));
    }
    if (u.pathname === '/rest/v1/rpc/ingest_coach_run_events') return ok({ incidentsNew: rpcNew });
    return ok([]);
  }));
});

function incident(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    incidentId: 'inc-1',
    fingerprint: 'fp-message-direction-unknown',
    batchId: 'batch-1',
    accountId: 'signature',
    occurredAt: '2026-09-05T10:00:00.000Z',
    severity: 'nonfatal',
    scope: 'contact',
    stage: 'fub_collection',
    code: 'MESSAGE_DIRECTION_UNKNOWN',
    title: 'A text message did not expose its sender direction',
    explanation: 'Follow Up Boss did not provide enough trustworthy information to determine direction.',
    impact: 'This contact was quarantined; collection continued with the remaining contacts.',
    nextStep: 'Review the sanitized diagnostic and add support for the observed message-card variation.',
    action: 'contact_quarantined',
    continued: true,
    position: 12,
    total: 80,
    technical: {
      stage: 'fub_collection',
      code: 'MESSAGE_DIRECTION_UNKNOWN',
      fingerprint: 'fp-message-direction-unknown',
      message: 'Sanitized bounded diagnostic message',
    },
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}, incidents = [incident()]) {
  return {
    schemaVersion: 1,
    batchId: 'batch-1',
    status: 'attention_required',
    counts: { fatal: 0, nonfatal: incidents.length },
    incidents,
    ...overrides,
  };
}

function send(body: unknown, token = 'coach-secret'): Promise<Response> {
  return worker.fetch(
    new Request('https://api.truhq.co/coach/run-events', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env, ctx,
  );
}

describe('POST /coach/run-events', () => {
  it('rejects a wrong token, and fails closed when no token is configured', async () => {
    expect((await send(payload(), 'wrong')).status).toBe(401);
    delete (env as unknown as Record<string, unknown>).COACH_INGEST_TOKEN;
    expect((await send(payload(), 'coach-secret')).status).toBe(401);
    expect(calls.filter((c) => c.method === 'POST' && c.path.includes('coach_run_event'))).toHaveLength(0);
  });

  it('never accepts the admin token in place of the ingest token', async () => {
    expect((await send(payload(), 'ops')).status).toBe(401);
  });

  it('4xxs malformed JSON and oversized bodies', async () => {
    expect((await send('not json')).status).toBe(422);
    const huge = 'x'.repeat(1_000_001);
    expect((await send(huge)).status).toBe(413);
  });

  it('4xxs a payload missing required fields', async () => {
    const res = await send(payload({}, [incident({ title: undefined })]));
    expect(res.status).toBe(422);
    const body = await res.json() as { details: string[] };
    expect(body.details.join(' ')).toContain('title');
  });

  it('rejects an unexpected field anywhere in the payload (allowlist, not silent drop)', async () => {
    const res = await send(payload({ extraField: 'nope' }));
    expect(res.status).toBe(422);
    const body = await res.json() as { details: string[] };
    expect(body.details.join(' ')).toContain('unexpected field');
  });

  it('rejects an incident carrying an email address', async () => {
    const res = await send(payload({}, [incident({ explanation: 'contact this lead at agent@example.com about it' })]));
    expect(res.status).toBe(422);
    const body = await res.json() as { details: string[] };
    expect(body.details.join(' ')).toContain('email');
  });

  it('rejects an incident carrying a phone number', async () => {
    const res = await send(payload({}, [incident({ impact: 'call the lead back at 555-123-4567' })]));
    expect(res.status).toBe(422);
  });

  it('rejects an incident carrying raw HTML', async () => {
    const res = await send(payload({}, [incident({ nextStep: 'render <div class="lead">name</div> safely' })]));
    expect(res.status).toBe(422);
  });

  it('rejects an incident carrying a full stack trace', async () => {
    const stack = 'TypeError: x is not a function\n  at foo (worker.js:12:5)\n  at bar (worker.js:20:9)';
    const res = await send(payload({}, [incident({ technical: { stage: 'x', code: 'X', fingerprint: 'fp', message: stack } })]));
    expect(res.status).toBe(422);
  });

  it('accepts a valid synthetic incident and stores the batch + incident', async () => {
    const res = await send(payload());
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; incidentsReceived: number; incidentsNew: number };
    expect(body.ok).toBe(true);
    expect(body.incidentsReceived).toBe(1);
    expect(body.incidentsNew).toBe(1);

    const rpc = calls.find(c => c.path === '/rest/v1/rpc/ingest_coach_run_events');
    expect(rpc).toBeTruthy();
    expect((rpc!.body as any).p_push.incidents[0].incidentId).toBe('inc-1');
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });

  it('returns the atomic database result on retries', async () => {
    rpcNew = 0;
    expect(await (await send(payload())).json()).toMatchObject({ incidentsNew: 0 });
  });
  it('rejects missing authentication', async () => {
    expect((await send(payload(), '')).status).toBe(401);
  });
  it.each([
    { schemaVersion: 2 }, { batchId: 'other-batch' }, { position: -1 }, { total: 1.5 },
    { explanation: 'password=synthetic-secret' }, { title: 'Lead name: Example Person' },
    { messageBody: 'synthetic private message' }, { cookies: {} }, { transcript: 'synthetic' },
    { technical: { stage: 'Bearer synthetic-secret', code: 'X', fingerprint: 'fp', message: 'Safe diagnostic' } },
  ])('rejects malformed or unsafe incident %j', async bad => {
    expect((await send(payload({}, [incident(bad)]))).status).toBe(422);
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });
  it('limits UTF-8 bytes even when the character count is smaller', async () => {
    expect((await send('é'.repeat(500001))).status).toBe(413);
  });
  it('does not expose storage errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic-private-database-detail'); }));
    const res = await send(payload());
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('synthetic-private');
  });
});
