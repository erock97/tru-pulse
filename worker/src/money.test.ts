// The invoice discipline, ported from TRU OS and kept under test here because
// each rule exists on account of a real incident: the wrong-recipient fallback,
// the $0 invoices of 2026-08-16, the stale-tab totals, the double-billing that
// invoice_id stamping prevents.
import { describe, it, expect, vi } from 'vitest';
import { closeMonthFromBilling, createInvoice, voidInvoice, saveTeamPay, wholeDollars } from './money.js';
import { db } from './db.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SUPABASE_ANON_KEY: 'anon',
    STRIPE_SECRET_KEY: 'sk_test_real',
    ...overrides,
  } as unknown as Env;
}

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe('closeMonthFromBilling', () => {
  it('August bills July', () => {
    expect(closeMonthFromBilling(2026, 8)).toEqual({ year: 2026, month: 7, yyyyMm: '2026-07' });
  });
  it('January bills December of the PRIOR year', () => {
    expect(closeMonthFromBilling(2026, 1)).toEqual({ year: 2025, month: 12, yyyyMm: '2025-12' });
  });
});

describe('wholeDollars', () => {
  it('refuses cents — integer columns would silently truncate them', () => {
    expect(() => wholeDollars(250.5, 'The rate')).toThrow(/whole dollars/);
  });
  it('refuses negatives', () => {
    expect(() => wholeDollars(-1, 'The rate')).toThrow(/positive/);
  });
});

const TEAM = '11111111-2222-3333-4444-555555555555';

describe('createInvoice', () => {
  it('refuses when nothing is billable, before any Stripe call', async () => {
    const stripeCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('api.stripe.com')) { stripeCalls.push(url); return ok({}); }
      if (url.includes('/rpc/billable_closings')) return ok([]);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const result = await createInvoice(db(env), env, { teamId: TEAM, closeMonth: '2026-07' });
    expect(result).toEqual({ error: true, text: expect.stringMatching(/Nothing billable/) });
    expect(stripeCalls).toHaveLength(0);
  });

  it('refuses when no broker has bills=true — never guesses a recipient', async () => {
    const stripeCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('api.stripe.com')) { stripeCalls.push(url); return ok({}); }
      if (url.includes('/rpc/billable_closings')) {
        return ok([{ id: 'd1', address: '1 Main St', agent_name: 'A', close_date: '2026-07-02', source: 'Zillow Preferred', earned_fee: 250 }]);
      }
      if (url.includes('/rest/v1/brokers')) return ok([]); // nobody with bills=true
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const result = await createInvoice(db(env), env, { teamId: TEAM, closeMonth: '2026-07' });
    expect(result).toEqual({ error: true, text: expect.stringMatching(/marked as the one who gets billed/) });
    expect(stripeCalls).toHaveLength(0);
  });

  it('refuses and records NOTHING when the Stripe draft total disagrees with the preview', async () => {
    const inserts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('api.stripe.com/v1/customers')) {
        return init?.method === 'POST' ? ok({ id: 'cus_1' }) : ok({ data: [{ id: 'cus_1' }] });
      }
      if (url.includes('api.stripe.com/v1/invoiceitems')) return ok({ id: 'ii_1' });
      if (url.includes('api.stripe.com/v1/invoices')) {
        // The re-read reports a total that does NOT match the preview's 25000.
        return ok({ id: 'in_1', total: 0, status: 'draft' });
      }
      if (url.includes('/rpc/billable_closings')) {
        return ok([{ id: 'd1', address: '1 Main St', agent_name: 'A', close_date: '2026-07-02', source: 'Zillow Preferred', earned_fee: 250 }]);
      }
      if (url.includes('/rest/v1/brokers')) return ok([{ email: 'broker@team.com', name: 'B' }]);
      if (url.includes('/rest/v1/invoices') && init?.method === 'POST') { inserts.push(url); return ok([{ id: 'row1' }]); }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const result = await createInvoice(db(env), env, { teamId: TEAM, closeMonth: '2026-07' });
    expect(result).toEqual({ error: true, text: expect.stringMatching(/approved total/) });
    expect(inserts).toHaveLength(0);
  });

  it('happy path: deterministic idempotency key, invoice recorded, closings stamped', async () => {
    let idemKey = '';
    let stamped = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const headers = new Headers(init?.headers);
      if (url.includes('api.stripe.com/v1/customers')) return ok({ data: [{ id: 'cus_1' }] });
      if (url.includes('api.stripe.com/v1/invoiceitems')) return ok({ id: 'ii_1' });
      if (url === 'https://api.stripe.com/v1/invoices' && init?.method === 'POST') {
        idemKey = headers.get('Idempotency-Key') || '';
        return ok({ id: 'in_1' });
      }
      if (url.includes('api.stripe.com/v1/invoices/in_1')) {
        return ok({ id: 'in_1', total: 25000, amount_due: 25000, status: 'draft', customer: 'cus_1' });
      }
      if (url.includes('/rpc/billable_closings')) {
        return ok([{ id: 'd1', address: '1 Main St', agent_name: 'A', close_date: '2026-07-02', source: 'Zillow Preferred', earned_fee: 250 }]);
      }
      if (url.includes('/rest/v1/brokers')) return ok([{ email: 'broker@team.com', name: 'B' }]);
      if (url.includes('/rest/v1/invoices') && init?.method === 'POST') return ok([{ id: 'row1' }]);
      if (url.includes('/rest/v1/closings') && init?.method === 'PATCH') { stamped = url; return ok([]); }
      // listTeams inside nothing here — createInvoice doesn't call it.
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const result = await createInvoice(db(env), env, { teamId: TEAM, teamLabel: 'Costigan', closeMonth: '2026-07' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Draft invoice created/);
    expect(idemKey).toBe(`tru:closings:v2:${TEAM}:2026-07`);
    expect(stamped).toContain('id=in.(d1)');
    expect(stamped).toContain('/rest/v1/closings');
  });
});

describe('voidInvoice', () => {
  it('voids in Stripe and releases the closings back to billable', async () => {
    let released = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/invoices?') && (!init?.method || init.method === 'GET')) {
        return ok([{ id: 'row1', stripe_invoice_id: 'in_1', team_id: TEAM, close_month: '2026-07-01', customer_email: 'b@t.com' }]);
      }
      if (url.includes('api.stripe.com/v1/invoices/in_1/void')) return ok({ status: 'void' });
      if (url.includes('api.stripe.com/v1/invoices/in_1')) return ok({ id: 'in_1', status: 'open' });
      if (url.includes('/rest/v1/invoices') && init?.method === 'PATCH') return ok([]);
      if (url.includes('/rest/v1/closings') && init?.method === 'PATCH') {
        released = url + '::' + String(init?.body);
        return ok([]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const result = await voidInvoice(db(env), env, { invoiceId: '99999999-8888-7777-6666-555555555555' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/billable again/);
    expect(released).toContain('invoice_id=eq.');
    expect(released).toContain('"invoice_id":null');
  });
});

describe('saveTeamPay', () => {
  it('dedupes rate rows by source (last one typed wins) before the SQL replace', async () => {
    let sent: any = null;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rpc/tru_save_team_pay')) {
        sent = JSON.parse(String(init?.body));
        return ok({ team_id: TEAM, rates: 1 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    await saveTeamPay(db(env), {
      teamId: TEAM,
      retainer: 4250,
      defaultRate: null,
      rates: [
        { source: 'Zillow Preferred', rate: 200, thresholdDeals: 0 },
        { source: 'zillow preferred', rate: 250, thresholdDeals: 8 },
      ],
    });
    expect(sent.p_rates).toEqual([{ source: 'zillow preferred', rate: 250, threshold_deals: 8 }]);
    expect(sent.p_retainer).toBe(4250);
  });

  it('refuses a decimal rate before anything reaches the database', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      calls.push(typeof input === 'string' ? input : input.url);
      return ok({});
    }));
    const env = baseEnv();
    await expect(
      saveTeamPay(db(env), { teamId: TEAM, retainer: 100, rates: [{ source: 'Zillow', rate: 250.75 }] }),
    ).rejects.toThrow(/whole dollars/);
    expect(calls).toHaveLength(0);
  });
});

describe('deleteDeal', () => {
  it('refuses a deal an invoice owns — settled money never desyncs from Stripe', async () => {
    const deletes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'DELETE') { deletes.push(url); return ok([]); }
      if (url.includes('/rest/v1/closings')) {
        return ok([{ id: 'd1', invoice_id: 'inv-1', address: '1 Main St', client_name: 'Buyer' }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const { deleteDeal } = await import('./money.js');
    await expect(deleteDeal(db(env), '11111111-2222-3333-4444-555555555555')).rejects.toThrow(/on an invoice/);
    expect(deletes).toHaveLength(0);
  });

  it('deletes an uninvoiced deal, filtering on invoice_id even at the delete', async () => {
    let deleted = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'DELETE') { deleted = url; return ok([{ id: 'd1' }]); }
      if (url.includes('/rest/v1/closings')) {
        return ok([{ id: 'd1', invoice_id: null, address: '1 Main St', client_name: 'Buyer' }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const { deleteDeal } = await import('./money.js');
    const gone = await deleteDeal(db(env), '11111111-2222-3333-4444-555555555555');
    expect(gone.address).toBe('1 Main St');
    expect(deleted).toContain('invoice_id=is.null');
  });
});

describe('clearMonth', () => {
  it('wipes only the uninvoiced deals of the CLOSE month, and reports what stayed', async () => {
    let deletedQuery = '';
    let roundDeleted = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/teams')) return ok([{ id: TEAM, name: 'Costigan' }]);
      if (url.includes('/rest/v1/closings') && init?.method === 'DELETE') {
        deletedQuery = url;
        return ok([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      }
      if (url.includes('/rest/v1/closings')) return ok([{ id: 'kept-1' }]); // one invoiced survivor
      if (url.includes('/rest/v1/closing_verifications') && init?.method === 'DELETE') { roundDeleted = url; return ok([]); }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const { clearMonth } = await import('./money.js');
    // Billing August → close month July.
    const result = await clearMonth(db(env), { team: 'Costigan', year: 2026, month: 8 });
    expect(result).toEqual({ team: 'Costigan', deleted: 3, keptInvoiced: 1 });
    expect(deletedQuery).toContain('close_date=gte.2026-07-01');
    expect(deletedQuery).toContain('close_date=lt.2026-08-01');
    expect(deletedQuery).toContain('invoice_id=is.null');
    // An invoiced deal survived, so the verification round must NOT be touched.
    expect(roundDeleted).toBe('');
  });

  it('deletes the verification round only when the month ends up empty', async () => {
    let roundDeleted = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/teams')) return ok([{ id: TEAM, name: 'Costigan' }]);
      if (url.includes('/rest/v1/closings') && init?.method === 'DELETE') return ok([{ id: 'a' }]);
      if (url.includes('/rest/v1/closings')) return ok([]);
      if (url.includes('/rest/v1/closing_verifications') && init?.method === 'DELETE') { roundDeleted = url; return ok([]); }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const env = baseEnv();
    const { clearMonth } = await import('./money.js');
    const result = await clearMonth(db(env), { team: 'Costigan', year: 2026, month: 8 });
    expect(result.deleted).toBe(1);
    expect(result.keptInvoiced).toBe(0);
    expect(roundDeleted).toContain('close_year=eq.2026');
    expect(roundDeleted).toContain('close_month=eq.7');
  });
});
