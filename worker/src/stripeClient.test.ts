// The Stripe client's two hard-won rules: lines are bound to the invoice by id
// (never left for the "pending items" sweep), and a $0 invoice is refused
// BEFORE finalising — finalising is the irreversible half.
import { describe, it, expect, vi } from 'vitest';
import { createDraftInvoice, sendInvoice, voidInvoice } from './stripeClient.js';
import type { Env } from './env.js';

const env = { STRIPE_SECRET_KEY: 'sk_test_real' } as unknown as Env;
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe('createDraftInvoice', () => {
  it('creates the invoice first, attaches every line by invoice id with derived keys, and re-reads', async () => {
    const calls: { url: string; method?: string; idem: string | null; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method, idem: headers.get('Idempotency-Key'), body: String(init?.body || '') });
      if (url.endsWith('/v1/invoices') && init?.method === 'POST') return ok({ id: 'in_1' });
      if (url.includes('/v1/invoiceitems')) return ok({ id: 'ii' });
      if (url.includes('/v1/invoices/in_1')) return ok({ id: 'in_1', total: 500 });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const result = await createDraftInvoice(env, {
      customerId: 'cus_1',
      lines: [
        { description: 'deal one', amountCents: 250 },
        { description: 'deal two', amountCents: 250 },
      ],
      idempotencyKey: 'tru:closings:v2:t:2026-07',
    });

    expect(result.total).toBe(500);
    const items = calls.filter((c) => c.url.includes('/v1/invoiceitems'));
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.body).toContain('invoice=in_1');
    expect(items[0].idem).toBe('tru:closings:v2:t:2026-07:line:0');
    expect(items[1].idem).toBe('tru:closings:v2:t:2026-07:line:1');
    // The last call is the re-read — the create call's empty shell is never
    // what the caller sees.
    expect(calls[calls.length - 1].url).toContain('/v1/invoices/in_1');
    expect(calls[calls.length - 1].method).toBe('GET');
  });
});

describe('sendInvoice', () => {
  it('refuses a $0 invoice BEFORE any finalize call reaches Stripe', async () => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'POST') posts.push(url);
      if (url.includes('/v1/invoices/in_1')) return ok({ id: 'in_1', total: 0 });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await expect(sendInvoice(env, 'in_1')).rejects.toThrow(/\$0/);
    expect(posts).toHaveLength(0);
  });

  it('finalizes then sends when the total is real', async () => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'POST') { posts.push(url); return ok({ id: 'in_1', status: 'open' }); }
      if (url.includes('/v1/invoices/in_1')) return ok({ id: 'in_1', total: 25000 });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await sendInvoice(env, 'in_1');
    expect(posts[0]).toContain('/v1/invoices/in_1/finalize');
    expect(posts[1]).toContain('/v1/invoices/in_1/send');
  });
});

describe('voidInvoice', () => {
  it('DELETEs a draft (it has no number; voiding it is a Stripe error)', async () => {
    let deleted = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'DELETE') { deleted = url; return ok({ deleted: true }); }
      if (url.includes('/v1/invoices/in_1')) return ok({ id: 'in_1', status: 'draft' });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const out = await voidInvoice(env, 'in_1');
    expect(out).toEqual({ status: 'deleted', deleted: true });
    expect(deleted).toContain('/v1/invoices/in_1');
  });

  it('voids a finalised one', async () => {
    let voided = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'POST') { voided = url; return ok({ status: 'void' }); }
      if (url.includes('/v1/invoices/in_1')) return ok({ id: 'in_1', status: 'open' });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const out = await voidInvoice(env, 'in_1');
    expect(out).toEqual({ status: 'void', deleted: false });
    expect(voided).toContain('/v1/invoices/in_1/void');
  });
});
