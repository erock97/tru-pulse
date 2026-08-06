// Authorization tests for the two routes that decide who may change an
// organization's numbers and who may read back a graded practice call. Both had
// gaps found in the 2026-08-06 estate audit; these lock the fixes in.
//
// The Worker talks to Supabase, Retell and Anthropic over plain fetch, so the whole
// world is stubbed at the fetch boundary and the real handler runs end to end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

const env = {
  SUPABASE_URL: SUPA,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  FUB_ENC_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
  ADMIN_TOKEN: 'ops-token',
  RETELL_API_KEY: 'retell-key',
  RETELL_AGENT_ID: 'agent_base',
  ANTHROPIC_API_KEY: 'anthropic-key',
} as Env;

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

/** The fake world, reconfigured per test. */
interface World {
  /** Bearer token → Supabase user id. */
  users: Record<string, string>;
  /** user id → org ids they are a member of (any role). */
  memberOf: Record<string, string[]>;
  /** user id → org ids where their role is admin|leader. */
  leaderOf: Record<string, string[]>;
  /** auth user id → an `agents` row, when they are a learner. */
  agents: Record<string, { id: string; org_id: string }>;
  /** platform-owner ids in the `admins` table. */
  platformAdmins: string[];
  /** retell call id → its stored metadata owner + transcript. */
  calls: Record<string, { owner: string | null; transcript: string; status: string }>;
}
let world: World;
let patches: Array<{ table: string; query: string; body: any }>;
let retellCreates: any[];

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  patches = [];
  retellCreates = [];
  world = { users: {}, memberOf: {}, leaderOf: {}, agents: {}, platformAdmins: [], calls: {} };

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);

    // ── Supabase auth: who does this bearer token belong to? ──
    if (u.pathname === '/auth/v1/user') {
      const bearer = String((init?.headers as any)?.Authorization ?? '').replace('Bearer ', '');
      const id = world.users[bearer];
      return id ? ok({ id }) : ok({ error: 'bad token' }, 401);
    }

    // ── PostgREST ──
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      const q = u.search.slice(1);
      const eq = (col: string) => {
        const m = q.match(new RegExp(`(?:^|&)${col}=eq\\.([^&]+)`));
        return m ? decodeURIComponent(m[1]) : null;
      };
      if (method === 'PATCH') {
        patches.push({ table, query: q, body: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(null, { status: 204 });
      }
      if (table === 'memberships') {
        const userId = eq('user_id');
        const orgId = eq('org_id');
        if (q.includes('role=in.')) {
          const isLeader = !!userId && !!orgId && (world.leaderOf[userId] ?? []).includes(orgId);
          return ok(isLeader ? [{ user_id: userId }] : []);
        }
        return ok((world.memberOf[userId ?? ''] ?? []).map((org_id) => ({ org_id })));
      }
      if (table === 'agents') {
        const authId = eq('auth_id');
        const hit = authId ? world.agents[authId] : null;
        return ok(hit ? [hit] : []);
      }
      if (table === 'admins') {
        const id = eq('id');
        return ok(id && world.platformAdmins.includes(id) ? [{ id }] : []);
      }
      return ok([]);
    }

    // ── Retell ──
    if (u.host === 'api.retellai.com') {
      if (u.pathname === '/list-agents') return ok([]);
      if (u.pathname === '/v2/create-web-call') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        retellCreates.push(body);
        return ok({ call_id: 'call_new', access_token: 'tok_web' });
      }
      if (u.pathname.startsWith('/v2/get-call/')) {
        const id = u.pathname.split('/').pop() as string;
        const c = world.calls[id];
        if (!c) return ok({ error: 'not found' }, 404);
        return ok({
          transcript: c.transcript,
          call_status: c.status,
          start_timestamp: 1_000_000,
          end_timestamp: 1_120_000,
          metadata: c.owner ? { tru_owner_user_id: c.owner } : {},
        });
      }
    }

    // ── Anthropic (the ALMS grader) ──
    if (u.host === 'api.anthropic.com') {
      return ok({
        content: [{ type: 'text', text: JSON.stringify({
          a: { score: 25, note: 'n' }, l: { score: 25, note: 'n' },
          m: { score: 25, note: 'n' }, s: { score: 20, note: 'n' },
          flags: [], best_moment: 'quoted line from the call', coach_note: 'n',
        }) }],
      });
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  }));
});

const post = (path: string, body: unknown, token?: string) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

// ════════════════════════════════════════════════════════════════════════════
describe('POST /settings — org-wide thresholds', () => {
  it('lets a single-org leader save, and targets their org', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = ['org-a'];
    const res = await post('/settings', { avg_gci: 12000 }, 't');
    expect(res.status).toBe(200);
    expect(patches).toHaveLength(1);
    expect(patches[0].table).toBe('org_settings');
    expect(patches[0].query).toContain('org_id=eq.org-a');
    expect(patches[0].body.avg_gci).toBe(12000);
  });

  it('refuses a plain member who is not a leader or admin of the org', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = []; // e.g. role 'coach'
    const res = await post('/settings', { avg_gci: 12000 }, 't');
    expect(res.status).toBe(403);
    expect(patches).toEqual([]);
  });

  it('will not guess which company when the user belongs to more than one', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a', 'org-b'];
    world.leaderOf['u1'] = ['org-a', 'org-b'];
    const res = await post('/settings', { avg_gci: 12000 }, 't');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('org_id required') });
    expect(patches).toEqual([]); // the whole point: nothing was written anywhere
  });

  it('writes to the org the multi-org user explicitly named', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a', 'org-b'];
    world.leaderOf['u1'] = ['org-a', 'org-b'];
    const res = await post('/settings', { org_id: 'b0000000-0000-4000-8000-000000000002', avg_gci: 9000 }, 't');
    // Not one of theirs → refused, never written.
    expect(res.status).toBe(403);
    expect(patches).toEqual([]);
  });

  it('accepts an explicit org the user actually belongs to', async () => {
    const orgB = 'b0000000-0000-4000-8000-000000000002';
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a', orgB];
    world.leaderOf['u1'] = [orgB];
    const res = await post('/settings', { org_id: orgB, avg_gci: 9000 }, 't');
    expect(res.status).toBe(200);
    expect(patches[0].query).toContain(`org_id=eq.${orgB}`);
  });

  it('rejects a malformed org id outright', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a', 'org-b'];
    world.leaderOf['u1'] = ['org-a'];
    const res = await post('/settings', { org_id: 'org-a&role=in.(admin)', avg_gci: 1 }, 't');
    expect(res.status).toBe(422);
    expect(patches).toEqual([]);
  });

  it('still refuses an unauthenticated caller', async () => {
    expect((await post('/settings', { avg_gci: 1 })).status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('POST /rep/practice — call ownership', () => {
  it('stamps the starting user onto the Retell call', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = ['org-a'];
    const res = await post('/rep/practice/start', { scenario: 'relocator' }, 't');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.test).toBe(true);
    expect(body.practiceId).toBe('test:relocator:call_new');
    expect(retellCreates[0].metadata).toMatchObject({ tru_owner_user_id: 'u1' });
  });

  it('refuses to start a test call for a plain member who is not a leader', async () => {
    world.users['t'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = [];
    const res = await post('/rep/practice/start', { scenario: 'relocator' }, 't');
    expect(res.status).toBe(403);
    expect(retellCreates).toEqual([]);
  });

  it('will not grade a call started by somebody else', async () => {
    world.users['mine'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = ['org-a'];
    world.calls['call_of_another_leader'] = {
      owner: 'u2',
      transcript: 'A: hello '.repeat(20),
      status: 'ended',
    };
    const res = await post('/rep/practice/finish', { practiceId: 'test:relocator:call_of_another_leader' }, 'mine');
    expect(res.status).toBe(403);
  });

  it('will not grade a call that carries no ownership stamp at all', async () => {
    world.users['mine'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = ['org-a'];
    world.calls['legacy_call'] = { owner: null, transcript: 'A: hello '.repeat(20), status: 'ended' };
    const res = await post('/rep/practice/finish', { practiceId: 'test:relocator:legacy_call' }, 'mine');
    expect(res.status).toBe(403);
  });

  it('grades the caller’s own test call', async () => {
    world.users['mine'] = 'u1';
    world.memberOf['u1'] = ['org-a'];
    world.leaderOf['u1'] = ['org-a'];
    world.calls['my_call'] = { owner: 'u1', transcript: 'A: hello there '.repeat(20), status: 'ended' };
    const res = await post('/rep/practice/finish', { practiceId: 'test:relocator:my_call' }, 'mine');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.test).toBe(true);
    expect(body.score).toBe(95);
    expect(body.passed).toBe(true);
  });

  it('still refuses an unauthenticated caller', async () => {
    expect((await post('/rep/practice/finish', { practiceId: 'test:relocator:x' })).status).toBe(401);
  });
});
