// POST /rep/assignments — a leader hands a track to learners.
//
// The tenancy risk here is a forged id: a leader posting another brokerage's
// learner id, or another brokerage's private track. Both are re-read server-side
// and refused, so these tests are the guard on that.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const TRACK = '33333333-3333-4333-8333-333333333333';
const OTHER_TRACK = '44444444-4444-4444-8444-444444444444';
const GLOBAL_TRACK = '55555555-5555-4555-8555-555555555555';
const L1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const L2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const L_OTHER = 'cccccccc-3333-4333-8333-cccccccccccc';

const LEARNER_ORG: Record<string, string> = { [L1]: ORG, [L2]: ORG, [L_OTHER]: OTHER_ORG };
const TRACK_ORG: Record<string, string | null> = {
  [TRACK]: ORG, [OTHER_TRACK]: OTHER_ORG, [GLOBAL_TRACK]: null,
};

let env: Env; let ctx: ExecutionContext;
let upserts: Array<{ url: string; rows: any[] }>;
let isLeader: boolean;

beforeEach(() => {
  upserts = [];
  isLeader = true;
  env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon',
          SUPABASE_SERVICE_ROLE_KEY: 'svc' } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init: any) => {
    const u = String(input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes('/auth/v1/user')) return ok({ id: 'u-leader' });
    if (u.includes('/memberships?')) return ok(isLeader ? [{ user_id: 'u-leader' }] : []);
    if (u.includes('/rep_tracks?')) {
      const id = /id=eq\.([0-9a-f-]+)/i.exec(u)?.[1] ?? '';
      return ok(id in TRACK_ORG ? [{ id, org_id: TRACK_ORG[id] }] : []);
    }
    if (u.includes('/rep_learners?')) {
      const list = (/id=in\.\(([^)]*)\)/i.exec(u)?.[1] ?? '').split(',').filter(Boolean);
      return ok(list.filter((id) => id in LEARNER_ORG).map((id) => ({ id, org_id: LEARNER_ORG[id] })));
    }
    if (u.includes('/rep_assignments') && init?.method === 'POST') {
      upserts.push({ url: u, rows: JSON.parse(init.body) });
      return new Response('', { status: 201 });
    }
    return ok([]);
  }));
});

const post = (body: unknown) => worker.fetch(new Request('https://api.truhq.co/rep/assignments', {
  method: 'POST',
  headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}), env, ctx);

describe('POST /rep/assignments', () => {
  it('401s a caller with no token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const res = await worker.fetch(new Request('https://api.truhq.co/rep/assignments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }), env, ctx);
    expect(res.status).toBe(401);
  });

  it('403s a plain member', async () => {
    isLeader = false;
    const res = await post({ org_id: ORG, track_id: TRACK, learner_ids: [L1] });
    expect(res.status).toBe(403);
  });

  it('422s an empty learner_ids array', async () => {
    const res = await post({ org_id: ORG, track_id: TRACK, learner_ids: [] });
    expect(res.status).toBe(422);
  });

  it('422s a malformed id', async () => {
    expect((await post({ org_id: 'nope', track_id: TRACK, learner_ids: [L1] })).status).toBe(422);
    expect((await post({ org_id: ORG, track_id: TRACK, learner_ids: ['nope'] })).status).toBe(422);
  });

  it('403s when a learner belongs to another org', async () => {
    const res = await post({ org_id: ORG, track_id: TRACK, learner_ids: [L1, L_OTHER] });
    expect(res.status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it('403s when the track belongs to another org', async () => {
    const res = await post({ org_id: ORG, track_id: OTHER_TRACK, learner_ids: [L1] });
    expect(res.status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it('404s an unknown track', async () => {
    const res = await post({
      org_id: ORG, track_id: '99999999-9999-4999-8999-999999999999', learner_ids: [L1],
    });
    expect(res.status).toBe(404);
  });

  it('allows a shared TRU track (org_id null)', async () => {
    const res = await post({ org_id: ORG, track_id: GLOBAL_TRACK, learner_ids: [L1] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });
  });

  it('upserts on (learner_id, track_id) so re-assigning updates the due date', async () => {
    const res = await post({
      org_id: ORG, track_id: TRACK, learner_ids: [L1, L2], due_at: '2026-08-21T00:00:00Z',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
    expect(upserts[0].url).toContain('on_conflict=learner_id%2Ctrack_id');
    expect(upserts[0].rows).toHaveLength(2);
    expect(upserts[0].rows[0]).toMatchObject({
      org_id: ORG, learner_id: L1, track_id: TRACK,
      due_at: '2026-08-21T00:00:00Z', assigned_by: 'u-leader',
    });
  });

  it('counts a duplicated learner once', async () => {
    const res = await post({ org_id: ORG, track_id: TRACK, learner_ids: [L1, L1] });
    expect(await res.json()).toEqual({ count: 1 });
    expect(upserts[0].rows).toHaveLength(1);
  });

  it('accepts no due date', async () => {
    const res = await post({ org_id: ORG, track_id: TRACK, learner_ids: [L1] });
    expect(res.status).toBe(200);
    expect(upserts[0].rows[0].due_at).toBeNull();
  });
});
