// POST /rep/invite — the leader's Rep "Invite" button. The agent gets a
// Resend email (same sendInviteEmail path Coach already uses) asking them
// to set a login and password. A copied magic-link-only invite is not a
// success.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
const APP = 'https://app.truhq.co';
const AGENT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ORG_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

const env = {
  SUPABASE_URL: SUPA,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  ADMIN_TOKEN: 'ops-token',
  RESEND_API_KEY: 'resend-key',
  INVITE_FROM: 'TRU HQ <hq@truhq.co>',
  BRIEF_FROM: 'DO NOT TOUCH <reports@truhq.co>',
} as Env;

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

interface World {
  users: Record<string, string>;
  memberOf: Record<string, string[]>;
  agents: Record<string, { id: string; org_id: string; email: string | null; auth_id: string | null; name: string }>;
  orgs: Record<string, { id: string; name: string }>;
  resendOk: boolean;
}
let world: World;
let sentEmails: Array<{ from: string; to: any; subject: string; html: string }>;
let generatedLinks: Array<{ type: string; email: string }>;
let patches: Array<{ table: string; body: any }>;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  sentEmails = [];
  generatedLinks = [];
  patches = [];
  world = {
    users: { 'leader-tok': 'leader-1' },
    memberOf: { 'leader-1': [ORG_ID] },
    agents: {
      [AGENT_ID]: {
        id: AGENT_ID, org_id: ORG_ID, email: 'jordan@sample.com',
        auth_id: null, name: 'Jordan Rivera',
      },
    },
    orgs: { [ORG_ID]: { id: ORG_ID, name: 'Sample Realty' } },
    resendOk: true,
  };

  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (u.pathname === '/auth/v1/user') {
      const bearer = String((init?.headers as any)?.Authorization ?? '').replace('Bearer ', '');
      const id = world.users[bearer];
      return id ? ok({ id }) : ok({ error: 'bad token' }, 401);
    }

    if (u.pathname === '/auth/v1/admin/generate_link') {
      generatedLinks.push({ type: body.type, email: body.email });
      return ok({
        properties: { action_link: 'https://app.truhq.co/#access_token=tok&type=invite' },
        user: { id: 'new-auth-1' },
      });
    }

    if (u.host === 'api.resend.com') {
      if (!world.resendOk) return new Response('nope', { status: 422 });
      sentEmails.push(body);
      return ok({ id: 'email-1' });
    }

    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      const q = u.search.slice(1);
      const eq = (col: string) => {
        const m = q.match(new RegExp(`(?:^|&)${col}=eq\\.([^&]+)`));
        return m ? decodeURIComponent(m[1]) : null;
      };
      if (method === 'PATCH') {
        patches.push({ table, body });
        return new Response(null, { status: 204 });
      }
      if (table === 'memberships') {
        const userId = eq('user_id');
        return ok((world.memberOf[userId ?? ''] ?? []).map((org_id) => ({ org_id })));
      }
      if (table === 'agents') {
        const id = eq('id');
        const hit = id ? world.agents[id] : null;
        return ok(hit ? [hit] : []);
      }
      if (table === 'orgs') {
        const id = eq('id');
        const hit = id ? world.orgs[id] : null;
        return ok(hit ? [hit] : []);
      }
      return ok([]);
    }

    return ok({});
  }));
});

const post = (body: unknown, token?: string) =>
  worker.fetch(
    new Request('https://api.truhq.co/rep/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: APP,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

describe('POST /rep/invite', () => {
  it('emails the agent a set-password link on the existing Resend / INVITE_FROM path', async () => {
    const res = await post({ agentId: AGENT_ID }, 'leader-tok');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.emailed).toBe(true);
    expect(body.email).toBe('jordan@sample.com');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].from).toBe('TRU HQ <hq@truhq.co>');
    expect(sentEmails[0].to).toBe('jordan@sample.com');
    expect(sentEmails[0].html).toMatch(/training/i);
    expect(sentEmails[0].html).toMatch(/Coach/);
    expect(sentEmails[0].html).not.toMatch(/Pulse/);
    expect(generatedLinks).toEqual([{ type: 'invite', email: 'jordan@sample.com' }]);
    expect(patches.some((p) => p.table === 'agents' && p.body.auth_id === 'new-auth-1')).toBe(true);
  });

  it('fails clearly when the agent has no email — no blank or magic-link-only invite', async () => {
    world.agents[AGENT_ID].email = null;
    const res = await post({ agentId: AGENT_ID }, 'leader-tok');
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(String(body.error).toLowerCase()).toMatch(/email/);
    expect(sentEmails).toEqual([]);
    expect(generatedLinks).toEqual([]);
  });

  it('fails the invite when Resend does not accept the email — does not hand back a copyable link', async () => {
    world.resendOk = false;
    const res = await post({ agentId: AGENT_ID }, 'leader-tok');
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json() as any;
    expect(body.emailed).not.toBe(true);
    expect(body.link).toBeUndefined();
    expect(String(body.error).toLowerCase()).toMatch(/email/);
  });

  it('refuses a caller who is not in the agent\'s org', async () => {
    world.memberOf['leader-1'] = [];
    const res = await post({ agentId: AGENT_ID }, 'leader-tok');
    expect(res.status).toBe(403);
    expect(sentEmails).toEqual([]);
  });
});
