// Provisioning + intake. The Worker talks to Supabase and Resend over plain
// fetch, so the whole world is stubbed at the fetch boundary and the real
// exported handler runs end to end. Same shape as routes-auth.test.ts.
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
  RESEND_API_KEY: 'resend-key',
  INVITE_FROM: 'TRU HQ <hq@truhq.co>',
  BRIEF_FROM: 'DO NOT TOUCH <reports@truhq.co>',
} as Env;

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

interface Inserted { table: string; row: any }
interface World {
  users: Record<string, string>;             // bearer token → user id
  platformAdmins: string[];                  // rows in `admins`
  existingAuthUsers: Record<string, string>; // email → existing auth user id
}
let world: World;
let inserted: Inserted[];
let upserts: Array<{ table: string; rows: any[] }>;
let generatedLinks: Array<{ type: string; email: string }>;
let sentEmails: Array<{ from: string; to: any; subject: string; html: string }>;
let seq: number;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  inserted = []; upserts = []; generatedLinks = []; sentEmails = []; seq = 0;
  world = { users: { owner: 'owner-1' }, platformAdmins: ['owner-1'], existingAuthUsers: {} };
  (ctx.waitUntil as any).mockClear?.();

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

    // Supabase admin: does this email already have a login?
    if (u.pathname === '/auth/v1/admin/users') {
      const filter = (u.searchParams.get('filter') ?? '').toLowerCase();
      const hit = world.existingAuthUsers[filter];
      return ok({ users: hit ? [{ id: hit, email: filter }] : [] });
    }

    // Supabase admin: mint an invite / recovery link, creating the user if new.
    if (u.pathname === '/auth/v1/admin/generate_link') {
      generatedLinks.push({ type: body.type, email: body.email });
      const existing = world.existingAuthUsers[body.email];
      const id = existing ?? `new-user-${++seq}`;
      world.existingAuthUsers[body.email] = id;
      return ok({
        properties: { action_link: `https://app.truhq.co/#access_token=tok${seq}&type=${body.type}` },
        user: { id },
      });
    }

    if (u.host === 'api.resend.com') {
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
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        if (String((init?.headers as any)?.Prefer ?? '').includes('resolution=')) {
          upserts.push({ table, rows });
          return new Response(null, { status: 204 });
        }
        const withIds = rows.map((r: any) => ({ ...r, id: r.id ?? `${table}-${++seq}` }));
        withIds.forEach((r) => inserted.push({ table, row: r }));
        return ok(withIds);
      }
      if (method === 'PATCH') return new Response(null, { status: 204 });
      if (table === 'admins') {
        const id = eq('id');
        return ok(id && world.platformAdmins.includes(id) ? [{ id }] : []);
      }
      return ok([]);
    }

    // FUB — webhook registration during connectTeamKey. No FUB_SYSTEM_KEY is
    // set in this env, so this should never be reached; fail loudly if it is.
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }));
});

const post = (path: string, body: unknown, token?: string) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

const postAsOps = (path: string, body: unknown) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'ops-token' },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

const rowsIn = (table: string) => inserted.filter((i) => i.table === table).map((i) => i.row);
const upsertedIn = (table: string) => upserts.filter((u) => u.table === table).flatMap((u) => u.rows);

// ════════════════════════════════════════════════════════════════════════════
describe('provision — completeness', () => {
  it('refuses a caller with neither an ops token nor a session', async () => {
    const res = await post('/provision', {
      orgName: 'Acme Realty',
      userId: 'leader-1',
      teams: [{ name: 'Main office', fubKey: 'fka_key' }],
    });
    expect(res.status).toBe(401);
    expect(inserted).toEqual([]);
  });

  it('creates org, membership, settings, entitlements and a team', async () => {
    const res = await postAsOps('/provision', {
      orgName: 'Acme Realty',
      userId: 'leader-1',
      teams: [{ name: 'Main office', fubKey: 'fka_key' }],
    });
    expect(res.status).toBe(200);
    expect(rowsIn('orgs')[0]).toMatchObject({ name: 'Acme Realty' });
    expect(rowsIn('memberships')[0]).toMatchObject({ user_id: 'leader-1', role: 'admin' });
    expect(rowsIn('teams')[0]).toMatchObject({ name: 'Main office' });
    expect(rowsIn('org_settings')).toHaveLength(1);
    // The gap this closes: Coach is dead without entitlements.
    expect(upsertedIn('entitlements').map((r: any) => r.product).sort()).toEqual(['coach', 'pulse']);
  });

  it('stores the FUB key exactly once, through connectTeamKey', async () => {
    await postAsOps('/provision', {
      orgName: 'Acme',
      userId: 'leader-1',
      teams: [{ name: 'Main', fubKey: 'fka_key' }],
    });
    const secrets = upserts.filter((u) => u.table === 'team_secrets');
    expect(secrets).toHaveLength(1);
    expect(secrets[0].rows[0].fub_key_enc).toBeTruthy();
    // And a first sync was scheduled rather than waited on — the other half of
    // what connectTeamKey does and provision() used to skip.
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('writes a Coach leaders row when the caller supplies a name and email', async () => {
    await postAsOps('/provision', {
      orgName: 'Acme',
      userId: 'leader-1',
      name: 'Dana Lee',
      email: 'dana@acme.com',
      teams: [{ name: 'Main', fubKey: 'fka_key' }],
    });
    const leaders = upsertedIn('leaders');
    expect(leaders).toHaveLength(1);
    expect(leaders[0]).toMatchObject({ id: 'leader-1', name: 'Dana Lee', email: 'dana@acme.com' });
    expect(leaders[0].team_id).toBe(rowsIn('teams')[0].id);
  });
});

// ════════════════════════════════════════════════════════════════════════════
import { validateIntake } from './intake.js';

describe('validateIntake', () => {
  const good = {
    orgName: 'Acme Realty',
    teams: [{ name: 'Main', fubKey: 'fka_key' }],
    leaders: [{ name: 'Dana Lee', email: 'dana@acme.com' }],
  };

  it('accepts a complete payload', () => {
    expect(validateIntake(good).ok).toBe(true);
  });

  it('requires a brokerage name', () => {
    expect(validateIntake({ ...good, orgName: '  ' })).toMatchObject({
      ok: false, error: expect.stringContaining('name'),
    });
  });

  it('requires at least one team with a key — Eric chose to always require it', () => {
    expect(validateIntake({ ...good, teams: [] }).ok).toBe(false);
    expect(validateIntake({ ...good, teams: [{ name: 'Main', fubKey: '' }] }).ok).toBe(false);
    expect(validateIntake({ ...good, teams: [{ name: '', fubKey: 'fka_k' }] }).ok).toBe(false);
  });

  it('requires at least one leader with a plausible email', () => {
    expect(validateIntake({ ...good, leaders: [] }).ok).toBe(false);
    expect(validateIntake({ ...good, leaders: [{ name: 'Dana Lee', email: 'nope' }] }).ok).toBe(false);
    expect(validateIntake({ ...good, leaders: [{ name: '', email: 'dana@acme.com' }] }).ok).toBe(false);
  });

  it('rejects two leaders sharing one email', () => {
    expect(validateIntake({
      ...good,
      leaders: [
        { name: 'Dana Lee', email: 'dana@acme.com' },
        { name: 'Sam Ruiz', email: 'DANA@acme.com' }, // case-insensitive
      ],
    })).toMatchObject({ ok: false, error: expect.stringContaining('once') });
  });

  it('rejects a leader pointed at a team that does not exist', () => {
    expect(validateIntake({
      ...good,
      leaders: [{ name: 'Dana Lee', email: 'd@a.com', teamIndex: 3 }],
    }).ok).toBe(false);
  });

  it('trims whitespace and lowercases the email', () => {
    const r = validateIntake({
      orgName: '  Acme Realty ',
      teams: [{ name: ' Main ', fubKey: ' fka_key ' }],
      leaders: [{ name: ' Dana Lee ', email: '  Dana@Acme.com ' }],
    });
    if (!r.ok) throw new Error('expected valid');
    expect(r.value.orgName).toBe('Acme Realty');
    expect(r.value.teams[0]).toMatchObject({ name: 'Main', fubKey: 'fka_key' });
    expect(r.value.leaders[0]).toMatchObject({ name: 'Dana Lee', email: 'dana@acme.com' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('POST /admin/intake', () => {
  const payload = {
    orgName: 'Acme Realty',
    teams: [{ name: 'Main office', fubKey: 'fka_key' }],
    leaders: [
      { name: 'Dana Lee', email: 'dana@acme.com' },
      { name: 'Sam Ruiz', email: 'sam@acme.com' },
    ],
  };

  it('refuses a caller who is not a platform owner', async () => {
    world.users['nobody'] = 'u-9';        // signed in, but not in `admins`
    const res = await post('/admin/intake', payload, 'nobody');
    expect(res.status).toBe(403);
    expect(inserted).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await post('/admin/intake', payload)).status).toBe(401);
    expect(inserted).toEqual([]);
  });

  it('rejects an invalid payload before writing anything', async () => {
    const res = await post('/admin/intake', { ...payload, leaders: [] }, 'owner');
    expect(res.status).toBe(422);
    expect(inserted).toEqual([]);
    expect(sentEmails).toEqual([]);
  });

  it('creates the tenant, invites both leaders, and emails each of them', async () => {
    const res = await post('/admin/intake', payload, 'owner');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(rowsIn('orgs')[0]).toMatchObject({ name: 'Acme Realty' });
    expect(rowsIn('teams')).toHaveLength(1);

    // Two leaders → two logins, two memberships, two Coach identities on ONE team.
    expect(rowsIn('memberships')).toHaveLength(2);
    const leaderRows = upsertedIn('leaders');
    expect(leaderRows).toHaveLength(2);
    expect(new Set(leaderRows.map((r: any) => r.team_id)).size).toBe(1);
    expect(leaderRows.map((r: any) => r.email).sort()).toEqual(['dana@acme.com', 'sam@acme.com']);

    // A brand-new email gets an `invite` link, which creates the auth user.
    expect(generatedLinks.map((l) => l.type)).toEqual(['invite', 'invite']);

    // One email each, from INVITE_FROM — never BRIEF_FROM.
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails.every((e) => e.from === 'TRU HQ <hq@truhq.co>')).toBe(true);
    expect(sentEmails.some((e) => e.from.includes('reports@'))).toBe(false);
    expect(sentEmails[0].html).toContain('Acme Realty');
    expect(sentEmails[0].html).toContain('https://app.truhq.co/#access_token=');

    expect(body.leaders.map((l: any) => l.status)).toEqual(['invited', 'invited']);
    expect(body.orgId).toBeTruthy();
  });

  it('brings the team online: key stored, first sync scheduled', async () => {
    await post('/admin/intake', payload, 'owner');
    const secrets = upserts.filter((u) => u.table === 'team_secrets');
    expect(secrets).toHaveLength(1);
    expect(secrets[0].rows[0].fub_key_enc).toBeTruthy();
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('sends a recovery link when the leader already has a login', async () => {
    world.existingAuthUsers['dana@acme.com'] = 'existing-1';
    await post('/admin/intake', { ...payload, leaders: [payload.leaders[0]] }, 'owner');
    expect(generatedLinks).toEqual([{ type: 'recovery', email: 'dana@acme.com' }]);
  });

  it('keeps the tenant when a leader email fails to send, and reports it', async () => {
    const realFetch = globalThis.fetch as any;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (new URL(url).host === 'api.resend.com') return new Response('nope', { status: 422 });
      return realFetch(input, init);
    }));

    const res = await post('/admin/intake', { ...payload, leaders: [payload.leaders[0]] }, 'owner');
    expect(res.status).toBe(200);           // the team is real; do not roll it back
    const body = (await res.json()) as any;
    expect(body.leaders[0].status).toBe('email_failed');
    expect(body.leaders[0].link).toContain('https://app.truhq.co/#access_token=');
    expect(rowsIn('orgs')).toHaveLength(1); // still provisioned
  });

  it('assigns each leader to the team the form pointed them at', async () => {
    await post('/admin/intake', {
      orgName: 'Two Office Realty',
      teams: [{ name: 'North', fubKey: 'fka_n' }, { name: 'South', fubKey: 'fka_s' }],
      leaders: [
        { name: 'Dana Lee', email: 'dana@acme.com', teamIndex: 0 },
        { name: 'Sam Ruiz', email: 'sam@acme.com', teamIndex: 1 },
      ],
    }, 'owner');
    const teamIds = rowsIn('teams').map((t: any) => t.id);
    const leaderRows = upsertedIn('leaders');
    expect(leaderRows.find((r: any) => r.email === 'dana@acme.com').team_id).toBe(teamIds[0]);
    expect(leaderRows.find((r: any) => r.email === 'sam@acme.com').team_id).toBe(teamIds[1]);
    expect(upserts.filter((u) => u.table === 'team_secrets')).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('POST /admin/resend-invite', () => {
  it('mints a recovery link for a leader who already has a login', async () => {
    world.existingAuthUsers['dana@acme.com'] = 'existing-1';
    const res = await post(
      '/admin/resend-invite',
      { email: 'dana@acme.com', orgName: 'Acme Realty', name: 'Dana Lee' },
      'owner',
    );
    expect(res.status).toBe(200);
    expect(generatedLinks).toEqual([{ type: 'recovery', email: 'dana@acme.com' }]);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].from).toBe('TRU HQ <hq@truhq.co>');
  });

  it('refuses a caller who is not a platform owner', async () => {
    world.users['nobody'] = 'u-9';
    expect((await post('/admin/resend-invite', { email: 'd@a.com' }, 'nobody')).status).toBe(403);
    expect(sentEmails).toEqual([]);
  });
});
