// The broker confirmation round's contract: the email only asks about deals
// still waiting on the broker, a round already out is never doubled, the
// billing month is translated before the round starts, the send goes through
// Resend from an @truhq.co sender, and a failure to record the send never
// fails the send.
import { describe, it, expect, vi } from 'vitest';
import {
  buildVerificationEmail,
  sendVerification,
  closeDateForMove,
  isHardClosingRefusal,
  adminRespond,
  roundAlreadyOut,
} from './verification.js';
import { db } from './db.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SUPABASE_ANON_KEY: 'anon',
    RESEND_API_KEY: 're_test',
    MONEY_FROM: 'Terrason Consulting <billing@truhq.co>',
    APP_ORIGIN: 'https://app.truhq.co',
    ...overrides,
  } as unknown as Env;
}

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const deal = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  address: '1 Main St',
  client_name: 'Buyer One',
  source: 'Zillow Preferred',
  close_date: '2026-07-14',
  status: 'pending',
  locked: false,
  ...over,
});

describe('buildVerificationEmail', () => {
  it('lists ONLY deals still pending and unlocked — answered and invoiced ones are not the broker\'s to touch', () => {
    const { html } = buildVerificationEmail({
      team: 'Costigan',
      year: 2026,
      month: 7,
      link: 'https://x/confirm',
      deals: [
        deal({ id: 'a', address: 'Open Deal Rd' }),
        deal({ id: 'b', address: 'Confirmed Ave', status: 'confirmed' }),
        deal({ id: 'c', address: 'Invoiced Blvd', locked: true }),
      ] as any,
    });
    expect(html).toContain('Open Deal Rd');
    expect(html).not.toContain('Confirmed Ave');
    expect(html).not.toContain('Invoiced Blvd');
    expect(html).toContain('could you confirm the 1 July closing');
  });
});

describe('roundAlreadyOut', () => {
  it('matches team names case-insensitively', () => {
    expect(roundAlreadyOut([{ team: 'costigan', sentAt: '2026-08-01' }], 'Costigan')).toBe(true);
    expect(roundAlreadyOut([{ team: 'Woosley', sentAt: '2026-08-01' }], 'Costigan')).toBe(false);
  });
});

function stubVerificationFetch(opts: {
  rounds?: unknown[];
  deals?: unknown[];
  resendStatus?: number;
  recordStatus?: number;
  onCall?: (url: string, init?: RequestInit) => void;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    opts.onCall?.(url, init);
    if (url.includes('/rest/v1/brokers')) return ok([{ name: 'Jack', email: 'jack@team.com' }, { name: 'Lauren', email: 'lauren@team.com' }]);
    if (url.includes('/rest/v1/teams')) return ok([{ id: 'team-1', name: 'Costigan' }]);
    if (url.includes('/rest/v1/closing_verifications')) return ok(opts.rounds ?? []);
    if (url.includes('/rpc/tru_start_verification')) return ok({ token: TOKEN });
    if (url.includes('/rpc/tru_verify_list')) return ok({ team: 'Costigan', year: 2026, month: 7, deals: opts.deals ?? [deal()] });
    if (url.includes('api.resend.com')) {
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: opts.resendStatus ?? 200 });
    }
    if (url.includes('/rest/v1/broker_email_sends')) {
      return new Response(opts.recordStatus === 500 ? 'boom' : '[{}]', { status: opts.recordStatus ?? 201 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }));
  return calls;
}

describe('sendVerification', () => {
  it('translates the billing month to the close month before starting the round', async () => {
    let startBody: any = null;
    const calls = stubVerificationFetch({
      onCall: (url, init) => {
        if (url.includes('tru_start_verification')) startBody = JSON.parse(String(init?.body));
      },
    });
    const env = baseEnv();
    const out = await sendVerification(db(env), env, { team: 'Costigan', year: 2026, month: 8 });
    expect(startBody).toEqual({ p_team_name: 'Costigan', p_year: 2026, p_month: 7 });
    expect(out.to).toBe('jack@team.com, lauren@team.com');
    expect(out.link).toBe(`https://app.truhq.co/#/confirm?t=${TOKEN}`);
    // Resend, from the money sender.
    const resend = calls.find((c) => c.url.includes('api.resend.com'));
    const sent = JSON.parse(String(resend!.init?.body));
    expect(sent.from).toContain('@truhq.co');
    expect(sent.to).toEqual(['jack@team.com', 'lauren@team.com']);
  });

  it('an explicit toEmail wins — the test-send path mails ONLY that address', async () => {
    const calls = stubVerificationFetch({});
    const env = baseEnv();
    const out = await sendVerification(db(env), env, { team: 'Costigan', year: 2026, month: 8, toEmail: 'eric@terrasonconsulting.com' });
    expect(out.to).toBe('eric@terrasonconsulting.com');
    const resend = calls.find((c) => c.url.includes('api.resend.com'));
    expect(JSON.parse(String(resend!.init?.body)).to).toEqual(['eric@terrasonconsulting.com']);
  });

  it('refuses when a round for this team+month is already out', async () => {
    stubVerificationFetch({
      rounds: [{ created_at: '2026-08-02T00:00:00Z', closed_at: null, teams: { name: 'Costigan' } }],
    });
    const env = baseEnv();
    await expect(sendVerification(db(env), env, { team: 'Costigan', year: 2026, month: 8 })).rejects.toThrow(
      /already sent/,
    );
  });

  it('refuses an empty month — a pointless email teaches brokers to ignore these', async () => {
    stubVerificationFetch({ deals: [] });
    const env = baseEnv();
    await expect(sendVerification(db(env), env, { team: 'Costigan', year: 2026, month: 8 })).rejects.toThrow(
      /No closings uploaded/,
    );
  });

  it('a failure to RECORD the send never fails the send — the mail is already gone', async () => {
    stubVerificationFetch({ recordStatus: 500 });
    const env = baseEnv();
    const out = await sendVerification(db(env), env, { team: 'Costigan', year: 2026, month: 8 });
    expect(out.messageId).toBe('msg_1');
  });
});

describe('closeDateForMove', () => {
  it('keeps the day, clamped to the destination month\'s LAST real day (not 28)', () => {
    expect(closeDateForMove(2026, 2, '2026-01-31')).toBe('2026-02-28');
    expect(closeDateForMove(2024, 2, '2024-01-31')).toBe('2024-02-29');
    expect(closeDateForMove(2026, 9, '2026-08-15')).toBe('2026-09-15');
  });
});

describe('isHardClosingRefusal', () => {
  it('locked/answered deals are hard refusals; expired rounds are not', () => {
    expect(isHardClosingRefusal('That deal is already invoiced. Nothing was changed.')).toBe(true);
    expect(isHardClosingRefusal('That deal is already confirmed. Nothing was changed.')).toBe(true);
    expect(isHardClosingRefusal('this link has expired')).toBe(false);
  });
});

describe('adminRespond', () => {
  it('falls back to a direct closings write when the round path soft-fails', async () => {
    let patched: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rpc/tru_start_verification')) return new Response(JSON.stringify({ message: 'this link has expired' }), { status: 400 });
      if (url.includes('/rest/v1/closings') && (!init?.method || init.method === 'GET')) {
        return ok([{ id: 'd1', invoice_id: null, verify_status: 'pending', close_date: '2026-07-14', address: '1 Main St', client_name: 'Buyer', team_id: 'team-1' }]);
      }
      if (url.includes('/rest/v1/closings') && init?.method === 'PATCH') { patched = String(init.body); return ok([]); }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const out = await adminRespond(db(env), { team: 'Costigan', year: 2026, month: 8, closingId: 'd1', outcome: 'confirmed' });
    expect(out.ok).toBe(true);
    expect(patched).toContain('"verify_status":"confirmed"');
  });

  it('re-throws a hard refusal instead of falling back — an invoiced deal stays settled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rpc/tru_start_verification')) return ok({ token: TOKEN });
      if (url.includes('/rpc/tru_verify_list')) return ok({ deals: [deal({ locked: true })] });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    await expect(
      adminRespond(db(env), { team: 'Costigan', year: 2026, month: 8, closingId: 'd1', outcome: 'confirmed' }),
    ).rejects.toThrow(/already invoiced/);
  });
});
