import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
let env: Env; let ctx: ExecutionContext; let upserted: any[];

beforeEach(() => {
  upserted = [];
  env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'anon',
          SUPABASE_SERVICE_ROLE_KEY: 'svc' } as unknown as Env;
  ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  vi.stubGlobal('fetch', vi.fn(async (input: any, init: any) => {
    const u = String(input);
    const body = init?.body ? JSON.parse(init.body) : null;
    // token introspection → the leader's user id
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u-leader' }), { status: 200 });
    if (u.includes('/agents?')) return new Response('[]', { status: 200 });
    if (u.includes('/memberships?')) return new Response(JSON.stringify([{ org_id: 'o1', role: 'leader' }]), { status: 200 });
    if (u.includes('/leaders?')) return new Response(JSON.stringify([{ name: 'Eric', email: 'e@truhq.co' }]), { status: 200 });
    if (u.includes('/rep_learners') && init?.method === 'POST')
      return new Response(JSON.stringify([{ id: 'L-leader', org_id: 'o1', kind: 'member', agent_id: null }]), { status: 201 });
    if (u.includes('/rep_learners?')) return new Response('[]', { status: 200 });
    if (u.includes('/rep_modules?')) return new Response(JSON.stringify([{ id: 'm1', org_id: 'o1', pass_pct: 80, active: true }]), { status: 200 });
    if (u.includes('/rep_questions?')) return new Response(JSON.stringify([
      { idx: 1, answer: 0, explain: null }, { idx: 2, answer: 1, explain: null }]), { status: 200 });
    if (u.includes('/rep_progress?') && init?.method === 'POST') { upserted.push(body); return new Response('', { status: 201 }); }
    if (u.includes('/rep_progress?')) return new Response('[]', { status: 200 });
    return new Response('[]', { status: 200 });
  }));
});

describe('/rep/grade', () => {
  const call = () => worker.fetch(new Request('https://api.truhq.co/rep/grade', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: 'm1', answers: [0, 1] }),
  }), env, ctx);

  it('grades a LEADER, not just an agent', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ score: 100, passed: true, correct: 2, total: 2 });
  });

  it('writes learner_id on the progress row', async () => {
    await call();
    expect(upserted[0][0]).toMatchObject({ learner_id: 'L-leader', org_id: 'o1', module_id: 'm1' });
  });

  it('leaves agent_id null for a member learner', async () => {
    await call();
    expect(upserted[0][0].agent_id ?? null).toBeNull();
  });
});

describe('/rep/ack', () => {
  const call = () => worker.fetch(new Request('https://api.truhq.co/rep/ack', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: '11111111-1111-1111-1111-111111111111' }),
  }), env, ctx);

  it('lets a LEADER complete a no-quiz module', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any, init: any) => {
      const u = String(input);
      const body = init?.body ? JSON.parse(init.body) : null;
      if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u-leader' }), { status: 200 });
      if (u.includes('/agents?')) return new Response('[]', { status: 200 });
      if (u.includes('/memberships?')) return new Response(JSON.stringify([{ org_id: 'o1', role: 'leader' }]), { status: 200 });
      if (u.includes('/leaders?')) return new Response(JSON.stringify([{ name: 'Eric', email: 'e@truhq.co' }]), { status: 200 });
      if (u.includes('/rep_learners') && init?.method === 'POST')
        return new Response(JSON.stringify([{ id: 'L-leader', org_id: 'o1', kind: 'member', agent_id: null }]), { status: 201 });
      if (u.includes('/rep_learners?')) return new Response('[]', { status: 200 });
      if (u.includes('/rep_modules?')) return new Response(JSON.stringify([{ id: 'm1', org_id: 'o1', active: true }]), { status: 200 });
      if (u.includes('/rep_questions?')) return new Response('[]', { status: 200 });
      if (u.includes('/rep_progress?') && init?.method === 'POST') { upserted.push(body); return new Response('', { status: 201 }); }
      if (u.includes('/rep_progress?')) return new Response('[]', { status: 200 });
      return new Response('[]', { status: 200 });
    }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(upserted[0][0]).toMatchObject({ learner_id: 'L-leader', org_id: 'o1', status: 'passed' });
  });
});
