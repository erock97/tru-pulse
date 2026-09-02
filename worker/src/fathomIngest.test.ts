// The Fathom ingest rules: fail closed without the secret, refuse anything the
// signature doesn't prove, only call a meeting a 1:1 when EXACTLY one coached
// agent matches an invitee email, never store the same meeting twice, and keep
// the distill (the model call) after the ACK so Fathom never times us out.
import { describe, it, expect, vi, afterEach } from 'vitest';
import nodeCrypto from 'node:crypto';
import {
  handleFathomIngest, verifyFathomSignature, candidateEmails, matchAgent,
  parseDistilled, distillPrompt, getWebhookSecret,
  type FathomMeeting,
} from './fathomIngest.js';
import { db } from './db.js';
import type { Env } from './env.js';

const SECRET = 'whsec_' + Buffer.from('an-arbitrary-32ish-byte-test-key').toString('base64');
const env = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  FATHOM_WEBHOOK_SECRET: SECRET,
  ANTHROPIC_API_KEY: 'anthropic-key',
} as unknown as Env;
const cors = {};

const AGENT = { id: 'a1b2c3d4-0000-0000-0000-000000000001', org_id: 'o-1', team_id: 't-1', name: 'Trevor Agent', email: 'trevor@team.com' };

function sign(id: string, ts: number, body: string): string {
  const key = Buffer.from(SECRET.split('_')[1], 'base64');
  return 'v1,' + nodeCrypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

function signedRequest(body: string, ts = Math.floor(Date.now() / 1000)): Request {
  return new Request('https://api.truhq.co/fathom/webhook', {
    method: 'POST',
    headers: {
      'webhook-id': 'msg_1',
      'webhook-timestamp': String(ts),
      'webhook-signature': sign('msg_1', ts, body),
    },
    body,
  });
}

function ctx(tasks: Promise<unknown>[]): ExecutionContext {
  return { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
}

const meeting: FathomMeeting = {
  title: '1:1 Eric / Trevor',
  share_url: 'https://fathom.video/share/xyz123',
  recording_start_time: '2026-09-02T16:01:12Z',
  recording_end_time: '2026-09-02T16:31:00Z',
  default_summary: { markdown_formatted: '## Summary\nGood week.' },
  action_items: [{ description: '20 sphere conversations by Friday', assignee: { name: 'Trevor Agent', email: 'trevor@team.com' } }],
  calendar_invitees: [
    { name: 'Eric Gilmore', email: 'eric@terrasonconsulting.com', is_external: false },
    { name: 'Trevor Agent', email: 'Trevor@Team.com', is_external: true },
  ],
  recorded_by: { name: 'Eric Gilmore', email: 'eric@terrasonconsulting.com' },
  transcript: [{ speaker: { display_name: 'Trevor Agent' }, text: 'I will do 20 sphere conversations.', timestamp: '00:05:00' }],
};

/** Fetch stub covering the whole pipeline; records what was written where. */
function stubPipeline(opts: { agents?: unknown[]; existing?: unknown[] } = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    if (url.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"wins":["Followed up five times on the Zillow lead"],"commitments":["20 sphere conversations by Friday"],"private_note":"Confidence is shaky after the lost listing."}' }],
      }), { status: 200 });
    }
    if (url.includes('/meeting_preps') && method === 'GET') {
      return new Response(JSON.stringify(opts.existing ?? []), { status: 200 });
    }
    if (url.includes('/agents')) {
      return new Response(JSON.stringify(opts.agents ?? []), { status: 200 });
    }
    if (url.includes('/meeting_preps') && method === 'POST') {
      return new Response(JSON.stringify([{ id: 'prep-1', ...body }]), { status: 200 });
    }
    if (url.includes('/meeting_preps') && method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    return new Response('[]', { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('verifyFathomSignature', () => {
  it('accepts a correctly signed body and rejects a tampered one', async () => {
    const body = JSON.stringify(meeting);
    const req = signedRequest(body);
    expect(await verifyFathomSignature(SECRET, req.headers, body)).toBe(true);
    expect(await verifyFathomSignature(SECRET, req.headers, body + ' ')).toBe(false);
  });
  it('rejects a replay outside the 5-minute window', async () => {
    const body = '{}';
    const old = Math.floor(Date.now() / 1000) - 600;
    const req = signedRequest(body, old);
    expect(await verifyFathomSignature(SECRET, req.headers, body)).toBe(false);
  });
});

describe('candidateEmails', () => {
  it('excludes the recorder, lowercases, and dedupes', () => {
    expect(candidateEmails(meeting)).toEqual(['trevor@team.com']);
  });
});

describe('matchAgent', () => {
  it('two different people matching means a team meeting — no 1:1 target', async () => {
    stubPipeline({ agents: [AGENT, { ...AGENT, id: 'other', email: 'dana@team.com' }] });
    expect(await matchAgent(db(env), ['trevor@team.com', 'dana@team.com'])).toBeNull();
  });
  it('the same person on two teams is ambiguous — never guess a team', async () => {
    stubPipeline({ agents: [AGENT, { ...AGENT, id: 'other-team-row' }] });
    expect(await matchAgent(db(env), ['trevor@team.com'])).toBeNull();
  });
});

describe('handleFathomIngest', () => {
  it('fails closed when the secret is unset', async () => {
    const calls = stubPipeline();
    const res = await handleFathomIngest(
      signedRequest('{}'), { ...env, FATHOM_WEBHOOK_SECRET: undefined } as unknown as Env,
      new URL('https://api.truhq.co/fathom/webhook'), cors, db(env), ctx([]),
    );
    expect(res?.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  it('refuses a bad signature before touching the database', async () => {
    const calls = stubPipeline();
    const req = new Request('https://api.truhq.co/fathom/webhook', {
      method: 'POST',
      headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,bm90LXJlYWw=' },
      body: JSON.stringify(meeting),
    });
    const res = await handleFathomIngest(req, env, new URL(req.url), cors, db(env), ctx([]));
    expect(res?.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  it('stores a matched meeting under the agent and distills AFTER the ACK', async () => {
    const calls = stubPipeline({ agents: [AGENT] });
    const tasks: Promise<unknown>[] = [];
    const body = JSON.stringify(meeting);
    const res = await handleFathomIngest(signedRequest(body), env, new URL('https://api.truhq.co/fathom/webhook'), cors, db(env), ctx(tasks));
    expect(res?.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, matched: 'Trevor Agent' });

    const insert = calls.find((c) => c.url.includes('/meeting_preps') && c.method === 'POST')!;
    expect(insert.body).toMatchObject({
      agent_id: AGENT.id, org_id: 'o-1', team_id: 't-1',
      dedupe_key: 'https://fathom.video/share/xyz123',
      summary_md: '## Summary\nGood week.',
    });
    // The distill was handed to waitUntil (it must not block the ACK) and,
    // once awaited, stamps the row with the parsed suggestion.
    expect(tasks.length).toBe(1);
    await Promise.all(tasks);
    expect(calls.some((c) => c.url.includes('api.anthropic.com'))).toBe(true);
    const patch = calls.find((c) => c.url.includes('/meeting_preps') && c.method === 'PATCH')!;
    expect((patch.body as { distilled: { commitments: string[] } }).distilled.commitments)
      .toEqual(['20 sphere conversations by Friday']);
  });

  it('stores an unmatched meeting with no agent and does NOT distill', async () => {
    const calls = stubPipeline({ agents: [] });
    const tasks: Promise<unknown>[] = [];
    const body = JSON.stringify(meeting);
    const res = await handleFathomIngest(signedRequest(body), env, new URL('https://api.truhq.co/fathom/webhook'), cors, db(env), ctx(tasks));
    expect(await res!.json()).toMatchObject({ ok: true, matched: null });
    const insert = calls.find((c) => c.url.includes('/meeting_preps') && c.method === 'POST')!;
    expect(insert.body).toMatchObject({ agent_id: null, org_id: null, team_id: null });
    await Promise.all(tasks);
    expect(calls.some((c) => c.url.includes('api.anthropic.com'))).toBe(false);
  });

  it('a redelivery never creates a second row', async () => {
    const calls = stubPipeline({
      existing: [{ id: 'prep-1', agent_id: AGENT.id, distilled: { wins: [] } }],
    });
    const body = JSON.stringify(meeting);
    const res = await handleFathomIngest(signedRequest(body), env, new URL('https://api.truhq.co/fathom/webhook'), cors, db(env), ctx([]));
    expect(await res!.json()).toMatchObject({ ok: true, duplicate: true });
    expect(calls.some((c) => c.url.includes('/meeting_preps') && c.method === 'POST')).toBe(false);
  });
});

describe('getWebhookSecret', () => {
  it('the vault value wins over the env fallback (rotate in Infisical, no deploy)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('universal-auth/login')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), { status: 200 });
      }
      if (url.includes('/api/v3/secrets/raw/FATHOM_WEBHOOK_SECRET')) {
        expect(url).toContain('secretPath=%2FFathom');
        return new Response(JSON.stringify({ secret: { secretValue: 'whsec_from_vault' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    const vaultEnv = {
      ...env, INFISICAL_CLIENT_ID: 'id', INFISICAL_CLIENT_SECRET: 'cs',
      INFISICAL_PROJECT_ID: 'proj', INFISICAL_ENV: 'fathom-test-a',
    } as unknown as Env;
    expect(await getWebhookSecret(vaultEnv)).toBe('whsec_from_vault');
  });
  it('falls back to the env var without the vault, and closes when neither exists', async () => {
    expect(await getWebhookSecret(env)).toBe(SECRET);
    expect(await getWebhookSecret({ ...env, FATHOM_WEBHOOK_SECRET: undefined } as unknown as Env)).toBeNull();
  });
});

describe('parseDistilled', () => {
  it('takes fenced JSON and drops non-string entries', () => {
    const out = parseDistilled('```json\n{"wins":["a", 3],"commitments":[],"private_note":" n "}\n```');
    expect(out).toEqual({ wins: ['a'], commitments: [], private_note: 'n' });
  });
  it('null on garbage', () => {
    expect(parseDistilled('no json here')).toBeNull();
  });
});

describe('distillPrompt', () => {
  it('is extraction-only: carries the meeting content and forbids invention', () => {
    const p = distillPrompt(meeting, 'Trevor');
    expect(p).toContain('do not invent, judge, or add advice');
    expect(p).toContain('20 sphere conversations by Friday');
    expect(p).toContain('Trevor Agent: I will do 20 sphere conversations.');
  });
});
