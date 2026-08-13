// syncPeople is the ONE place a Follow Up Boss person becomes a `leads` row with an
// accountability flag — the number a leader acts on and an agent gets measured by.
// It was completely untested. These pin the classification rules, the subrequest
// budget that keeps a big team's sync from aborting, the stage-progression log's
// seed-vs-live dating, and the two "never fail the lead sync" fallbacks.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from './db.js';
import type { Env } from './env.js';

vi.mock('./fub.js', () => ({
  pullPonds: vi.fn(async () => new Map<number, string>([[7, 'Overflow Pond']])),
  countOutgoingTexts: vi.fn(async () => 0),
  countCalls: vi.fn(async () => 0),
  pullPeople: vi.fn(async () => []),
  getPeopleByIds: vi.fn(async () => []),
  detectSubdomain: vi.fn(async () => null),
  pullUsers: vi.fn(async () => []),
  pullDeals: vi.fn(async () => []),
}));

const { syncPeople } = await import('./sync.js');
const fub = await import('./fub.js');

const TEAM = { id: 'team-1', org_id: 'org-1', fub_subdomain: 'acme' };
const env = {} as Env;

interface Stub {
  db: Db;
  leadRows: () => any[];
  stageRows: () => any[];
  upsertCalls: Array<{ table: string; rows: any[] }>;
}

function stubDb(opts: { priorHits?: any[]; failLeadsOnPond?: boolean; failStageLog?: boolean } = {}): Stub {
  const upsertCalls: Array<{ table: string; rows: any[] }> = [];
  let leadsAttempt = 0;
  const db = {
    select: vi.fn(async (table: string) => (table === 'person_stage_log' ? (opts.priorHits ?? []) : [])),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    upsert: vi.fn(async (table: string, rows: any[]) => {
      if (table === 'leads' && opts.failLeadsOnPond && leadsAttempt++ === 0) {
        throw new Error(`upsert leads 400: {"message":"column leads.pond does not exist"}`);
      }
      if (table === 'person_stage_log' && opts.failStageLog) {
        throw new Error('upsert person_stage_log 400: relation does not exist');
      }
      upsertCalls.push({ table, rows });
    }),
  } as unknown as Db;
  const rowsFor = (t: string) => upsertCalls.filter((c) => c.table === t).flatMap((c) => c.rows);
  return { db, upsertCalls, leadRows: () => rowsFor('leads'), stageRows: () => rowsFor('person_stage_log') };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

/** A tracked (Zillow) person, recent enough to be inside the contact horizon. */
const person = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Dana Reed', source: 'Zillow Premier Agent', stage: 'Nurture',
  created: daysAgo(3), assignedTo: 'Sam Cole', ...over,
});

beforeEach(() => {
  vi.mocked(fub.countOutgoingTexts).mockResolvedValue(0);
  vi.mocked(fub.countCalls).mockResolvedValue(0);
  vi.clearAllMocks();
  vi.mocked(fub.pullPonds).mockResolvedValue(new Map([[7, 'Overflow Pond']]));
});

describe('syncPeople — which leads are in scope', () => {
  it('keeps tracked paid sources and drops everything else', async () => {
    const s = stubDb();
    const r = await syncPeople(env, s.db, TEAM, 'k', [
      person({ id: 1, source: 'Zillow Flex' }),
      person({ id: 2, source: 'Realtor.com MVIP' }),
      person({ id: 3, source: 'Sphere of Influence' }),
      person({ id: 4, source: null }),
    ]);
    expect(r.inScope).toBe(2);
    expect(s.leadRows().map((l) => l.fub_person_id).sort()).toEqual([1, 2]);
    expect(s.leadRows().map((l) => l.source_family).sort()).toEqual(['Realtor.com MVIP', 'Zillow']);
  });

  it('labels a pond-assigned lead with the pond name', async () => {
    const s = stubDb();
    await syncPeople(env, s.db, TEAM, 'k', [person({ assignedPondId: 7 })]);
    expect(s.leadRows()[0].pond).toBe('Overflow Pond');
  });
});

describe('syncPeople — the accountability flag', () => {
  it('flags a stuck-stage lead without spending a contact lookup', async () => {
    const s = stubDb();
    const r = await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'New Lead' })]);
    expect(s.leadRows()[0].flag).toBe('stuck');
    expect(r.stuck).toBe(1);
    expect(fub.countOutgoingTexts).not.toHaveBeenCalled();
    expect(fub.countCalls).not.toHaveBeenCalled();
  });

  it('treats offer-or-beyond as worked without spending a contact lookup', async () => {
    const s = stubDb();
    for (const stage of ['Offer Made', 'Under Contract', 'Closed']) {
      const one = stubDb();
      await syncPeople(env, one.db, TEAM, 'k', [person({ stage })]);
      expect(one.leadRows()[0].flag).toBe('worked');
    }
    expect(fub.countCalls).not.toHaveBeenCalled();
    expect(s.leadRows()).toEqual([]);
  });

  it('flags a recent active lead with no contact as zero_contact', async () => {
    const s = stubDb();
    const r = await syncPeople(env, s.db, TEAM, 'k', [person()]);
    expect(s.leadRows()[0].flag).toBe('zero_contact');
    expect(r.zeroContact).toBe(1);
  });

  it('counts 2+ outgoing texts, or 1+ call, as worked', async () => {
    vi.mocked(fub.countOutgoingTexts).mockResolvedValue(2);
    const texted = stubDb();
    await syncPeople(env, texted.db, TEAM, 'k', [person()]);
    expect(texted.leadRows()[0].flag).toBe('worked');
    expect(texted.leadRows()[0].outgoing_texts).toBe(2);

    vi.mocked(fub.countOutgoingTexts).mockResolvedValue(0);
    vi.mocked(fub.countCalls).mockResolvedValue(1);
    const called = stubDb();
    await syncPeople(env, called.db, TEAM, 'k', [person()]);
    expect(called.leadRows()[0].flag).toBe('worked');
    expect(called.leadRows()[0].calls).toBe(1);
  });

  it('does not spend a contact lookup on a lead older than the 45-day horizon', async () => {
    const s = stubDb();
    await syncPeople(env, s.db, TEAM, 'k', [person({ created: daysAgo(60) })]);
    expect(s.leadRows()[0].flag).toBe('worked');
    expect(fub.countOutgoingTexts).not.toHaveBeenCalled();
  });

  it('caps contact lookups at 250 per sync and never turns a skipped lead into a strike', async () => {
    const s = stubDb();
    const many = Array.from({ length: 260 }, (_, i) => person({ id: i + 1 }));
    await syncPeople(env, s.db, TEAM, 'k', many);
    expect(fub.countOutgoingTexts).toHaveBeenCalledTimes(250);
    const rows = s.leadRows();
    expect(rows).toHaveLength(260);
    // The 250 that were checked have no contact → zero_contact; the 10 skipped by
    // the budget default to 'worked' so a budget cap can never manufacture a strike.
    expect(rows.filter((r) => r.flag === 'zero_contact')).toHaveLength(250);
    expect(rows.slice(250).every((r) => r.flag === 'worked')).toBe(true);
  });
});

describe('syncPeople — stage-progression log', () => {
  it('seeds a first-ever sync without inventing dates', async () => {
    const s = stubDb({ priorHits: [] });
    await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Under Contract' })]);
    const hit = s.stageRows()[0];
    expect(hit.stage_class).toBe('uc');
    expect(hit.changed_at).toBeNull();
    expect(hit.date_source).toBe('seed');
    expect(hit.agent_name).toBe('Sam Cole');
  });

  it('uses the real deal close date for a closing even on the seed sync', async () => {
    const s = stubDb({ priorHits: [] });
    await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Closed', dealCloseDate: '2026-06-30 05:00:00' })]);
    const hit = s.stageRows()[0];
    expect(hit.date_source).toBe('deal_close_date');
    expect(hit.changed_at).toBe('2026-06-30T05:00:00.000Z');
  });

  // FUB's dealCloseDate is the PROJECTED close while a deal is still open, so it can
  // be in the future. Dating a hit forward hides it from every current window until
  // that day, then resurfaces the lead as a fresh closing — even if the deal fell
  // through. A forecast is not an achievement date.
  it('refuses a close date in the future and dates the hit live instead', async () => {
    const s = stubDb({ priorHits: [{ fub_person_id: 99, stage: 'Nurture' }] });
    const future = new Date(Date.now() + 21 * 86400_000).toISOString();
    await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Closed', dealCloseDate: future })]);
    const hit = s.stageRows()[0];
    expect(hit.date_source).toBe('live');
    expect(Date.parse(hit.changed_at as string)).toBeLessThanOrEqual(Date.now());
  });

  it('still refuses a future close date on the seed sync, rather than seeding it forward', async () => {
    const s = stubDb({ priorHits: [] });
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Closed', dealCloseDate: future })]);
    const hit = s.stageRows()[0];
    expect(hit.date_source).toBe('seed');
    expect(hit.changed_at).toBeNull();
  });

  it('still accepts a close date that has already happened', async () => {
    const s = stubDb({ priorHits: [{ fub_person_id: 99, stage: 'Nurture' }] });
    const past = new Date(Date.now() - 3 * 86400_000).toISOString();
    await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Closed', dealCloseDate: past })]);
    const hit = s.stageRows()[0];
    expect(hit.date_source).toBe('deal_close_date');
    expect(hit.changed_at).toBe(past);
  });

  it('dates a newly-seen hit live once the log is established', async () => {
    const s = stubDb({ priorHits: [{ fub_person_id: 99, stage: 'Nurture' }] });
    await syncPeople(env, s.db, TEAM, 'k', [person({ id: 1, stage: 'Offer Made' })]);
    const hit = s.stageRows()[0];
    expect(hit.date_source).toBe('live');
    expect(hit.changed_at).not.toBeNull();
  });

  it('does not re-log a hit it has already recorded', async () => {
    const s = stubDb({ priorHits: [{ fub_person_id: 1, stage: 'Under Contract' }] });
    const r = await syncPeople(env, s.db, TEAM, 'k', [person({ id: 1, stage: 'Under Contract' })]);
    expect(r.stageHits).toBe(0);
    expect(s.stageRows()).toEqual([]);
  });

  it('logs nothing for a lead that has not reached offer', async () => {
    const s = stubDb();
    const r = await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Nurture' })]);
    expect(r.stageHits).toBe(0);
  });
});

describe('syncPeople — degrading instead of failing', () => {
  it('retries the lead upsert without `pond` when that column is missing', async () => {
    const s = stubDb({ failLeadsOnPond: true });
    const r = await syncPeople(env, s.db, TEAM, 'k', [person({ assignedPondId: 7 })]);
    expect(r.upserted).toBe(1);
    const rows = s.leadRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('pond');
    expect(rows[0].flag).toBe('zero_contact');
  });

  it('still syncs leads when the stage log table is not migrated yet', async () => {
    const s = stubDb({ failStageLog: true });
    const r = await syncPeople(env, s.db, TEAM, 'k', [person({ stage: 'Closed' })]);
    expect(r.upserted).toBe(1);
    expect(s.leadRows()).toHaveLength(1);
  });

  it('propagates a real lead-upsert failure rather than reporting a clean sync', async () => {
    const s = stubDb();
    vi.mocked(s.db.upsert).mockRejectedValueOnce(new Error('upsert leads 503: upstream down'));
    await expect(syncPeople(env, s.db, TEAM, 'k', [person()])).rejects.toThrow(/503/);
  });
});
