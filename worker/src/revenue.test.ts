// fetchRevenue now reads THIS database's own tables (ported from TRU OS) —
// the contract that matters is that it groups deals under the right team,
// pairs each with its retainer, and surfaces a clear error if closing_ledger()
// itself fails, rather than silently returning nothing.
import { describe, it, expect, vi } from 'vitest';
import { fetchRevenue } from './revenue.js';
import { db } from './db.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';

function baseEnv(): Env {
  return {
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  } as unknown as Env;
}

describe('fetchRevenue', () => {
  it('groups deals by team, pairs each with its retainer, and drops teams with neither', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes('/rest/v1/teams')) {
        return ok([
          { id: 'team-1', name: 'Costigan' },
          { id: 'team-2', name: 'Woosley' },
          { id: 'team-3', name: 'Untouched by billing' },
        ]);
      }
      if (url.includes('/rest/v1/team_pay_settings')) {
        return ok([{ team_id: 'team-1', retainer: 2750 }]);
      }
      if (url.includes('/rpc/closing_ledger')) {
        expect(init?.method).toBe('POST');
        return ok([
          { id: 'd1', team_id: 'team-2', agent_name: 'Carson', address: '1 Main St', source: 'Zillow Preferred', close_date: '2026-07-01', payout_month: '2026-08-01', base_fee: 500, earned_fee: 500, under_threshold: false, status: 'closed' },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const env = baseEnv();
    const result = await fetchRevenue(env, db(env));
    expect(result).toEqual([
      { team_id: 'team-1', team_name: 'Costigan', retainer: 2750, deals: [] },
      { team_id: 'team-2', team_name: 'Woosley', retainer: 0, deals: expect.any(Array) },
    ]);
    expect(result.find((t) => t.team_id === 'team-2')!.deals).toHaveLength(1);
    // team-3 has neither a retainer nor any deals — it never billed through
    // this system, so it's absent rather than shown as an empty row.
    expect(result.find((t) => t.team_id === 'team-3')).toBeUndefined();
  });

  it('throws a clear error when closing_ledger() itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/teams')) return new Response('[]', { status: 200 });
      if (url.includes('/rest/v1/team_pay_settings')) return new Response('[]', { status: 200 });
      if (url.includes('/rpc/closing_ledger')) return new Response('boom', { status: 500 });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const env = baseEnv();
    await expect(fetchRevenue(env, db(env))).rejects.toThrow(/closing_ledger\(\) call failed: 500/);
  });
});
