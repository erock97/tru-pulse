// Admin gate + rendering contract for the Failure Logs tab: no session is
// unauthorized, a signed-in non-admin is forbidden, and a platform owner gets
// fingerprint-grouped problems with the latest incident's detail attached.
// PATCH validates its status enum and requires the problem to already exist.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

let env: Env;
let ctx: ExecutionContext;
let calls: Array<{ method: string; path: string; body: unknown }>;
let isAdminUser: boolean;
let problemRows: Array<Record<string, unknown>>;
let incidentRows: Array<Record<string, unknown>>;

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
  isAdminUser = true;
  problemRows = [{
    fingerprint: 'fp-1',
    title: 'A text message did not expose its sender direction',
    stage: 'fub_collection',
    severity: 'nonfatal',
    first_seen: '2026-09-01T09:00:00.000Z',
    last_seen: '2026-09-05T10:00:00.000Z',
    occurrence_count: 3,
    affected_batch_ids: ['batch-0', 'batch-1'],
    affected_account_ids: ['costigan', 'signature'],
    status: 'open',
    resolution_notes: null,
    latest_incident_id: 'inc-2',
  }];
  incidentRows = [{
    incident_id: 'inc-2',
    occurred_at: '2026-09-05T10:00:00.000Z',
    scope: 'contact',
    code: 'MESSAGE_DIRECTION_UNKNOWN',
    explanation: 'FUB did not provide enough trustworthy information to determine direction.',
    impact: 'This contact was quarantined; collection continued.',
    next_step: 'Review the sanitized diagnostic.',
    action: 'contact_quarantined',
    continued: true,
    position: 12,
    total: 80,
    technical: { stage: 'fub_collection', code: 'MESSAGE_DIRECTION_UNKNOWN', fingerprint: 'fp-1', message: 'Sanitized diagnostic' },
  }];

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: u.pathname + u.search, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (u.pathname === '/auth/v1/user') {
      const authed = (init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer good-token';
      return authed ? ok({ id: 'user-1' }) : ok({ error: 'invalid' }, 401);
    }
    if (u.pathname === '/rest/v1/rpc/coach_admin_mutate') return ok(problemRows.length ? {ok:true,version:2,status:body.p_body.status ?? 'open'} : {code:'INCIDENT_NOT_FOUND'});
    if (u.pathname === '/rest/v1/admins') return ok(isAdminUser ? [{ id: 'user-1' }] : []);
    if (u.pathname === '/rest/v1/coach_run_event_problems' && method === 'GET') return ok(problemRows);
    if (u.pathname === '/rest/v1/coach_run_event_incidents' && method === 'GET') return ok(incidentRows);
    return ok([]);
  }));
});

function get(path: string, token = 'good-token'): Promise<Response> {
  return worker.fetch(
    new Request(`https://api.truhq.co${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    env, ctx,
  );
}

function patch(body: unknown, token = 'good-token'): Promise<Response> {
  return worker.fetch(
    new Request('https://api.truhq.co/admin/failure-logs', {
      method: 'PATCH',
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: JSON.stringify(body),
    }),
    env, ctx,
  );
}

describe('GET /admin/failure-logs', () => {
  it('is unauthorized with no session', async () => {
    expect((await get('/admin/failure-logs', '')).status).toBe(401);
  });

  it('is forbidden for a signed-in user who is not a platform admin', async () => {
    isAdminUser = false;
    expect((await get('/admin/failure-logs')).status).toBe(403);
  });

  it('returns fingerprint-grouped problems with the latest incident attached', async () => {
    const res = await get('/admin/failure-logs');
    expect(res.status).toBe(200);
    const body = await res.json() as { problems: Array<Record<string, unknown>> };
    expect(body.problems).toHaveLength(1);
    const p = body.problems[0];
    expect(p.fingerprint).toBe('fp-1');
    expect(p.occurrenceCount).toBe(3);
    expect(p.affectedAccountIds).toEqual(['costigan', 'signature']);
    expect((p.latest as Record<string, unknown>).incidentId).toBe('inc-2');
    expect((p.latest as Record<string, unknown>).explanation).toContain('FUB did not provide');
  });

  it('applies status/severity filters and rejects an invalid one', async () => {
    expect((await get('/admin/failure-logs?status=bogus')).status).toBe(422);
    await get('/admin/failure-logs?status=open&severity=nonfatal&recurring=1');
    const problemsCall = calls.find((c) => c.method === 'GET' && c.path.startsWith('/rest/v1/coach_run_event_problems'));
    expect(problemsCall!.path).toContain('status=eq.open');
    expect(problemsCall!.path).toContain('severity=eq.nonfatal');
    expect(problemsCall!.path).toContain('occurrence_count=gt.1');
  });
});

describe('PATCH /admin/failure-logs', () => {
  it('is unauthorized with no session and forbidden for a non-admin', async () => {
    expect((await patch({ fingerprint: 'fp-1', expectedVersion: 1, status: 'fixed' }, '')).status).toBe(401);
    isAdminUser = false;
    expect((await patch({ fingerprint: 'fp-1', expectedVersion: 1, status: 'fixed' })).status).toBe(403);
  });

  it('rejects an invalid status', async () => {
    const res = await patch({ fingerprint: 'fp-1', expectedVersion: 1, status: 'closed' });
    expect(res.status).toBe(422);
  });

  it('404s a fingerprint that does not exist', async () => {
    problemRows = [];
    const res = await patch({ fingerprint: 'fp-missing', expectedVersion: 1, status: 'fixed' });
    expect(res.status).toBe(404);
  });

  it('updates status and notes for an existing problem', async () => {
    const res = await patch({ fingerprint: 'fp-1', expectedVersion: 1, status: 'fixed', notes: 'Patched the collector.' });
    expect(res.status).toBe(200);
    const patchCall = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/rpc/coach_admin_mutate');
    expect(patchCall).toBeTruthy();
    expect((patchCall!.body as any).p_fingerprint).toBe('fp-1');
    expect((patchCall!.body as any).p_body.status).toBe('fixed');
    expect((patchCall!.body as any).p_body.notes).toBe('Patched the collector.');
  });
});

describe('Failure Logs browser preflight', () => {
  it('allows credentialed PATCH from the production app', async () => {
    const res = await worker.fetch(new Request('https://api.truhq.co/admin/failure-logs', {
      method: 'OPTIONS', headers: { Origin: 'https://app.truhq.co', 'Access-Control-Request-Method': 'PATCH' },
    }), env, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.truhq.co');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
  it('does not authorize an unknown origin', async () => {
    const res = await worker.fetch(new Request('https://api.truhq.co/admin/failure-logs', {
      method: 'OPTIONS', headers: { Origin: 'https://synthetic-untrusted.example', 'Access-Control-Request-Method': 'PATCH' },
    }), env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('Atomic admin actions',()=>{
  it('passes release with expected version to the admin RPC',async()=>{
    expect((await patch({fingerprint:'fp-1',expectedVersion:1,releaseClaim:true})).status).toBe(200);
    expect(calls.find(c=>c.path==='/rest/v1/rpc/coach_admin_mutate')?.body).toEqual({p_fingerprint:'fp-1',p_body:{fingerprint:'fp-1',expectedVersion:1,releaseClaim:true}});
  });
  it('rejects missing versions and unknown fields',async()=>{
    expect((await patch({fingerprint:'fp-1',status:'fixed'})).status).toBe(422);
    expect((await patch({fingerprint:'fp-1',expectedVersion:1,releaseClaim:true,unsafe:'value'})).status).toBe(422);
  });
  it('does not admit the coaching token to admin routes',async()=>{
    expect((await patch({fingerprint:'fp-1',expectedVersion:1,releaseClaim:true},'coach-secret')).status).toBe(401);
  });
});
