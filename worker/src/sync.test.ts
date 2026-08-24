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

function stubDb(
  opts: {
    priorHits?: any[];
    /** Existing `leads` rows, as the sync reads them back to drive the rotation. */
    priorLeads?: any[];
    failLeadsOnPond?: boolean;
    failStageLog?: boolean;
  } = {},
): Stub {
  const upsertCalls: Array<{ table: string; rows: any[] }> = [];
  let leadsAttempt = 0;
  const db = {
    select: vi.fn(async (table: string) => {
      if (table === 'person_stage_log') return opts.priorHits ?? [];
      if (table === 'leads') return opts.priorLeads ?? [];
      return [];
    }),
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

describe('syncPeople — the contact-lookup rotation', () => {
  // Reading calls + texts costs 2 subrequests, so only 250 leads can be read per
  // sync. Signature has ~840 inside the horizon. Spending that budget in arrival
  // order meant the same leads were read every run and the rest were written back
  // as 'worked' — which does not merely decline to accuse, it ERASES a
  // zero_contact flag an earlier run had correctly established. The nightly
  // reconcile sees one frame of that flicker, so a lead was struck only if it
  // happened to read zero_contact at 07:05. These pin the fix.

  it('keeps a known zero_contact flag when the lead is waiting its turn', async () => {
    // The bug, stated as a test. This lead was read before and had no contact.
    // It is in horizon but not in this run's slice, so nothing is re-read — and
    // what we already knew must survive rather than be overwritten with 'worked'.
    const readAt = daysAgo(1);
    const s = stubDb({
      priorLeads: [{
        fub_person_id: 1, flag: 'zero_contact', outgoing_texts: 1, calls: 0,
        contact_checked_at: readAt,
      }],
    });
    // 250 never-read leads sort ahead of it, so lead 1 cannot be in the slice.
    const others = Array.from({ length: 250 }, (_, i) => person({ id: 1000 + i }));
    await syncPeople(env, s.db, TEAM, 'k', [...others, person({ id: 1 })]);

    const one = s.leadRows().find((l) => l.fub_person_id === 1);
    expect(one.flag).toBe('zero_contact');
    expect(one.outgoing_texts).toBe(1);
    // Its clock does not move, or it would keep losing its place in the queue.
    expect(one.contact_checked_at).toBe(readAt);
    // And it was genuinely never asked about.
    expect(vi.mocked(fub.countOutgoingTexts).mock.calls.map((c) => c[1])).not.toContain(1);
  });

  it('spends the budget on the longest-unread leads and skips the freshest', async () => {
    // 260 leads, all read before. Ids 1-10 were read a minute ago; the rest are
    // days stale. Only 250 lookups are affordable, so the ten fresh ones are the
    // ten that wait — the whole point of ordering by staleness.
    const fresh = Array.from({ length: 10 }, (_, i) => ({
      fub_person_id: i + 1, flag: 'worked', outgoing_texts: 0, calls: 0,
      contact_checked_at: new Date(Date.now() - 60_000).toISOString(),
    }));
    const stale = Array.from({ length: 250 }, (_, i) => ({
      fub_person_id: i + 11, flag: 'worked', outgoing_texts: 0, calls: 0,
      contact_checked_at: daysAgo(5),
    }));
    const s = stubDb({ priorLeads: [...fresh, ...stale] });
    const people = Array.from({ length: 260 }, (_, i) => person({ id: i + 1 }));
    await syncPeople(env, s.db, TEAM, 'k', people);

    const askedFor = new Set(vi.mocked(fub.countOutgoingTexts).mock.calls.map((c) => c[1]));
    expect(askedFor.size).toBe(250);
    for (const id of [1, 5, 10]) expect(askedFor.has(id)).toBe(false);
    for (const id of [11, 150, 260]) expect(askedFor.has(id)).toBe(true);
  });

  it('reads never-seen leads before ones it has already read', async () => {
    // 250 leads read five days ago, plus 10 nobody has ever looked at. A
    // never-read lead outranks any prior reading however stale, because its flag
    // is currently an assumption rather than an observation.
    const seen = Array.from({ length: 250 }, (_, i) => ({
      fub_person_id: i + 1, flag: 'worked', outgoing_texts: 0, calls: 0,
      contact_checked_at: daysAgo(5),
    }));
    const s = stubDb({ priorLeads: seen });
    const people = Array.from({ length: 260 }, (_, i) => person({ id: i + 1 }));
    await syncPeople(env, s.db, TEAM, 'k', people);

    const askedFor = new Set(vi.mocked(fub.countOutgoingTexts).mock.calls.map((c) => c[1]));
    for (const id of [251, 255, 260]) expect(askedFor.has(id)).toBe(true);
  });

  it('advances the clock only for leads it actually read', async () => {
    const s = stubDb();
    await syncPeople(env, s.db, TEAM, 'k', [
      person({ id: 1 }),                        // read
      person({ id: 2, stage: 'New Lead' }),     // stuck: classified from stage alone
      person({ id: 3, created: daysAgo(60) }),  // past the horizon
    ]);
    const by = (id: number) => s.leadRows().find((l) => l.fub_person_id === id);
    expect(by(1).contact_checked_at).not.toBeNull();
    expect(by(2).contact_checked_at).toBeNull();
    expect(by(3).contact_checked_at).toBeNull();
  });

  it('still refuses to invent a strike for a lead it has never read', async () => {
    // The original guarantee, unchanged: a lead we have never looked at cannot
    // produce a strike. Only leads with a prior reading are now preserved.
    const s = stubDb({ priorLeads: [] });
    const many = Array.from({ length: 260 }, (_, i) => person({ id: i + 1 }));
    await syncPeople(env, s.db, TEAM, 'k', many);
    const skipped = s.leadRows().filter((l) => l.contact_checked_at === null);
    expect(skipped).toHaveLength(10);
    expect(skipped.every((l) => l.flag === 'worked')).toBe(true);
  });

  it('survives the prior-state read failing, without erasing anything it reads', async () => {
    const s = stubDb();
    (s.db.select as any).mockImplementation(async (table: string) =>
      table === 'leads' ? Promise.reject(new Error('boom')) : [],
    );
    const r = await syncPeople(env, s.db, TEAM, 'k', [person({ id: 1 })]);
    expect(r.upserted).toBe(1);
    expect(s.leadRows()[0].flag).toBe('zero_contact');
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
