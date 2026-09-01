// The contract machinery's load-bearing rules, ported with the code:
// role pairing (the optional-second-signer bug), the one-time approval
// ledger's every refusal reason, whose-turn routing, and the admin gate on
// every route.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pairRecipientsToRoles, type TemplateRole } from './trusign.js';
import { issueApprovalRecord, consumeApprovalRecord, fingerprintEnvelope } from './contractApprovalCore.js';
import { whoseTurn } from './trusignTurn.js';
import { buildContractDraftPdf } from './contractPdf.js';
import worker from './index.js';
import type { Env } from './env.js';

const role = (roleKey: string, label: string, optional = false): TemplateRole => ({
  roleKey, label, role: 'signer', optional, routingOrder: 1, fixedName: null, fixedEmail: null,
});

const person = (name: string) => ({ name, email: `${name.toLowerCase().replace(/\W+/g, '')}@example.com`, role: 'signer' as const });

describe('pairRecipientsToRoles', () => {
  it('fills one signer on a template that also offers an optional second', () => {
    // The Consulting Services Agreement shape. This once threw
    // "Cannot read properties of undefined (reading 'name')" and killed the
    // draft before TruSign was called.
    const open = [role('client', 'Client signer'), role('client_2', 'Second client signer', true)];
    const paired = pairRecipientsToRoles(open, [person('Michael Gomes')]);
    expect(Object.keys(paired)).toEqual(['client']);
    expect(paired.client.name).toBe('Michael Gomes');
  });

  it('fills both when a second signer was actually supplied', () => {
    const open = [role('client', 'Client signer'), role('client_2', 'Second client signer', true)];
    const paired = pairRecipientsToRoles(open, [person('Michael Gomes'), person('George Bellino')]);
    expect(Object.keys(paired)).toEqual(['client', 'client_2']);
    expect(paired.client_2.name).toBe('George Bellino');
  });

  it('keeps required roles when an optional one sits between them', () => {
    const open = [role('client', 'Client'), role('witness', 'Witness', true), role('broker', 'Broker')];
    const paired = pairRecipientsToRoles(open, [person('Ann'), person('Bob')]);
    expect(Object.keys(paired)).toEqual(['client', 'broker']);
    expect(paired.broker.name).toBe('Bob');
  });

  it('refuses rather than inventing a person when required roles outnumber people', () => {
    const open = [role('client', 'Client'), role('broker', 'Broker')];
    expect(() => pairRecipientsToRoles(open, [person('Ann')])).toThrow(/Broker/);
  });

  it('ignores extra optional roles nobody was supplied for', () => {
    const open = [role('client', 'Client'), role('a', 'A', true), role('b', 'B', true)];
    expect(Object.keys(pairRecipientsToRoles(open, [person('Ann')]))).toEqual(['client']);
  });
});

describe('the approval record', () => {
  const scope = { actorId: 'eric', action: 'send', envelopeId: 'env-1', version: 'sha256:abc' };
  const NOW = 1_000_000;

  it('spends exactly once', () => {
    const record = issueApprovalRecord(scope, 'tok', NOW, 60_000);
    const first = consumeApprovalRecord(record, { ...scope, token: 'tok' }, NOW + 1);
    expect(first.ok).toBe(true);
    const second = consumeApprovalRecord((first as any).record, { ...scope, token: 'tok' }, NOW + 2);
    expect(second).toEqual({ ok: false, reason: 'already_consumed' });
  });

  it('names every mismatch precisely', () => {
    const record = issueApprovalRecord(scope, 'tok', NOW, 60_000);
    const attempt = { ...scope, token: 'tok' };
    expect(consumeApprovalRecord(undefined, attempt, NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(consumeApprovalRecord(record, { ...attempt, token: 'wrong' }, NOW)).toEqual({ ok: false, reason: 'token_mismatch' });
    expect(consumeApprovalRecord(record, { ...attempt, actorId: 'bob' }, NOW)).toEqual({ ok: false, reason: 'actor_mismatch' });
    expect(consumeApprovalRecord(record, { ...attempt, action: 'void' }, NOW)).toEqual({ ok: false, reason: 'action_mismatch' });
    expect(consumeApprovalRecord(record, { ...attempt, envelopeId: 'env-2' }, NOW)).toEqual({ ok: false, reason: 'envelope_mismatch' });
    expect(consumeApprovalRecord(record, { ...attempt, version: 'sha256:zzz' }, NOW)).toEqual({ ok: false, reason: 'version_mismatch' });
    expect(consumeApprovalRecord(record, attempt, NOW + 61_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses to issue for any action other than send or void', () => {
    expect(() => issueApprovalRecord({ ...scope, action: 'delete' }, 't', NOW, 1000)).toThrow(/send or void/);
  });
});

describe('fingerprintEnvelope', () => {
  it('is stable under key order and sensitive to content', async () => {
    const a = await fingerprintEnvelope({ id: '1', title: 'X', status: 'draft' });
    const b = await fingerprintEnvelope({ status: 'draft', id: '1', title: 'X' });
    const c = await fingerprintEnvelope({ id: '1', title: 'X', status: 'sent' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('whoseTurn', () => {
  const rec = (email: string, order: number, status = 'pending', roleName = 'signer') =>
    ({ name: email, email, role: roleName, status, routing_order: order });

  it('sequential: only the lowest unsigned signer is live; cc is never waited on', () => {
    const turn = whoseTurn({ status: 'sent', routing: 'sequential' }, [
      rec('broker@x.com', 1, 'signed'),
      rec('eric@terrasonconsulting.com', 2),
      rec('adam@x.com', 3),
      rec('copy@x.com', 4, 'pending', 'cc'),
    ]);
    expect(turn.map((t) => t.email)).toEqual(['eric@terrasonconsulting.com']);
  });

  it('a draft or completed envelope waits on nobody', () => {
    expect(whoseTurn({ status: 'draft' }, [rec('a@x.com', 1)])).toEqual([]);
    expect(whoseTurn({ status: 'completed' }, [rec('a@x.com', 1)])).toEqual([]);
  });

  it('parallel: everyone unsigned is live at once', () => {
    const turn = whoseTurn({ status: 'sent', routing: 'parallel' }, [rec('a@x.com', 1), rec('b@x.com', 2)]);
    expect(turn).toHaveLength(2);
  });
});

describe('buildContractDraftPdf', () => {
  it('produces a real PDF stamped as a draft on every page', () => {
    const bytes = buildContractDraftPdf({
      title: 'Consulting Agreement', client: 'Acme', team: 'Costigan', contractType: 'consulting',
      templateId: null, durationDays: 365, terms: 'Monthly retainer.', draftText: 'Full text here.',
      recipients: [{ name: 'Jane', role: 'signer' }],
    });
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('DRAFT - NOT SENT - Eric review required');
    expect(text.trim().endsWith('%%EOF')).toBe(true);
  });
});

// ── The admin gate ─────────────────────────────────────────────────────────

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async () => ({ keys: [] }),
  } as unknown as KVNamespace;
}

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the contracts routes', () => {
  let env: Env;

  beforeEach(() => {
    env = {
      SESSIONS: fakeKV(),
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    } as unknown as Env;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input.url);
      if (u.pathname === '/auth/v1/user') {
        const bearer = String((init?.headers as any)?.Authorization ?? '').replace('Bearer ', '');
        return bearer === 'admin-token' ? ok({ id: 'admin-1' }) : ok({}, 401);
      }
      if (u.pathname === '/rest/v1/admins') {
        const m = u.search.match(/id=eq\.([^&]+)/);
        return ok(m && decodeURIComponent(m[1]) === 'admin-1' ? [{ id: 'admin-1' }] : []);
      }
      return ok([]);
    }));
  });

  const call = (path: string, method = 'GET', token?: string) =>
    worker.fetch(
      new Request(`https://worker.test${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: method === 'GET' ? undefined : '{}',
      }),
      env, ctx,
    );

  it('401s every route with no session', async () => {
    for (const [p, m] of [
      ['/admin/contracts/overview', 'GET'], ['/admin/contracts/templates', 'GET'],
      ['/admin/contracts/review?envelopeId=x', 'GET'], ['/admin/contracts/prepare', 'POST'],
      ['/admin/contracts/approvals', 'POST'], ['/admin/contracts/send', 'POST'], ['/admin/contracts/void', 'POST'],
    ] as const) {
      expect((await call(p, m)).status, p).toBe(401);
    }
  });

  it('the overview renders an honest not-connected state when TruSign has no credentials', async () => {
    const res = await call('/admin/contracts/overview', 'GET', 'admin-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.connected).toBe(false);
    expect(body.writeConnected).toBe(false);
    expect(body.envelopes).toEqual([]);
    expect(body.requires).toContain('TRUSIGN_SUPABASE_URL');
  });

  it('send refuses without the full approval scope', async () => {
    const res = await call('/admin/contracts/send', 'POST', 'admin-token');
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/approval/i);
  });
});
