// fetchRevenue reads a SEPARATE Supabase project (TRU Operating System's own
// database). The contract that matters: it degrades to null rather than
// throwing when the cross-project secret isn't configured yet, it surfaces a
// clear error when TRU OS itself returns something unexpected, and it groups
// deals under the right team without touching the fee math TRU OS already
// computes in closing_ledger().
import { describe, it, expect, vi } from 'vitest';
import { fetchRevenue } from './truOsRevenue.js';
import type { Env } from './env.js';

const TRU_OS = 'https://tru-os-project.supabase.co';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    TRU_OS_SUPABASE_URL: TRU_OS,
    TRU_OS_SUPABASE_SERVICE_ROLE_KEY: 'tru-os-service-role',
    ...overrides,
  } as unknown as Env;
}

describe('fetchRevenue', () => {
  it('returns null rather than throwing when the cross-project secret is unset', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchRevenue(baseEnv({ TRU_OS_SUPABASE_SERVICE_ROLE_KEY: undefined }));
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('groups deals by team and pairs each with its retainer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes('/rest/v1/teams')) {
        return ok([{ id: 'team-1', name: 'Costigan' }, { id: 'team-2', name: 'Woosley' }]);
      }
      if (url.includes('/rest/v1/team_pay_settings')) {
        return ok([{ team_id: 'team-1', retainer: 2750 }]);
      }
      if (url.includes('/rpc/closing_ledger')) {
        return ok([
          { id: 'd1', team_id: 'team-1', agent_name: 'Jack', address: '1 Main St', source: 'Zillow Preferred', close_date: '2026-07-01', payout_month: '2026-08-01', base_fee: 500, earned_fee: 500, under_threshold: false, status: 'closed' },
          { id: 'd2', team_id: 'team-1', agent_name: 'Jack', address: '2 Main St', source: 'Zillow Preferred', close_date: '2026-07-05', payout_month: '2026-08-01', base_fee: 500, earned_fee: 0, under_threshold: true, status: 'closed' },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const result = await fetchRevenue(baseEnv());
    expect(result).toEqual([
      { team_id: 'team-1', team_name: 'Costigan', retainer: 2750, deals: expect.any(Array) },
      { team_id: 'team-2', team_name: 'Woosley', retainer: 0, deals: [] },
    ]);
    expect(result![0].deals).toHaveLength(2);
    expect(result![0].deals[1].under_threshold).toBe(true);
  });

  it('throws a clear error when TRU OS returns a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/teams')) return new Response('nope', { status: 401 });
      return new Response('[]', { status: 200 });
    }));

    await expect(fetchRevenue(baseEnv())).rejects.toThrow(/teams=401/);
  });
});
