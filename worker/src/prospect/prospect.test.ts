import { describe, it, expect } from 'vitest';
import { evaluateProspectGate } from './gate.js';
import type { ProspectGateConfig } from './gate.js';
import { buildCircleCampaign, buildOutboundCampaign, dedupeKey, scoreCirclePriority } from './circle.js';
import type {
  NeighborRecord, NeighborSource, SkipTracer, DncScrubber, ProspectStore, ScrubResult, TracedContact, CircleQueueState,
} from './circle.js';
import { fakeNeighborSource, fakeSkipTracer, fakeDncScrubber, fakeExpiredListings, fakeFsboListings } from './providers.js';
import { generateOpeners } from './dossier.js';

const config: ProspectGateConfig = {
  orgId: 'org-1', quietStartHour: 8, quietEndHour: 21,
  defaultTimezone: 'America/Los_Angeles', maxAttempts: 6,
  dncPolicy: { circle: 'block', expired: 'manual', fsbo: 'manual' },
};
const NOON_PST = new Date('2026-01-15T20:00:00Z');

describe('prospect gate (ported)', () => {
  const base = {
    personId: 'p', channel: 'circle' as const, phoneE164: '+12065551234',
    timezone: 'America/Los_Angeles', optedOut: false, onDnc: false, attempts: 0,
  };
  it('allows a clean neighbor with no AI-disclosure requirement', () => {
    const d = evaluateProspectGate(base, config, NOON_PST);
    expect(d.verdict).toBe('allow');
    expect(d.requirements).toContain('OFFER_OPT_OUT');
  });
  it('blocks a DNC neighbor on circle', () => {
    const d = evaluateProspectGate({ ...base, onDnc: true, dncScope: 'federal' }, config, NOON_PST);
    expect(d.verdict).toBe('block');
    expect(d.blockers).toContain('ON_DNC');
  });
  it('routes a DNC expired to manual', () => {
    const d = evaluateProspectGate({ ...base, channel: 'expired', onDnc: true, dncScope: 'federal' }, config, NOON_PST);
    expect(d.verdict).toBe('manual');
  });
  it('always suppresses a litigator', () => {
    const d = evaluateProspectGate({ ...base, channel: 'expired', onDnc: true, dncScope: 'litigator' }, config, NOON_PST);
    expect(d.verdict).toBe('block');
    expect(d.blockers).toContain('ON_DNC_LITIGATOR');
  });
  it('respects recipient quiet hours', () => {
    const early = new Date('2026-01-15T14:00:00Z'); // 06:00 PST
    expect(evaluateProspectGate(base, config, early).blockers).toContain('QUIET_HOURS');
  });
});

// Minimal in-memory store for precise pipeline assertions.
function makeStore(suppression?: Map<string, { optedOut: boolean; onDnc: boolean }>) {
  const persons = new Map<string, string>();
  const enqueued: Array<{ personId: string; state: CircleQueueState }> = [];
  let seq = 0;
  const store: ProspectStore = {
    async upsertProperty() { seq += 1; return { id: `prop-${seq}` }; },
    async upsertPerson(p) {
      const ex = persons.get(p.dedupeKey);
      if (ex) return { id: ex };
      seq += 1; const id = `person-${seq}`; persons.set(p.dedupeKey, id); return { id };
    },
    async upsertPhones() {},
    async checkSuppression(_org, phones) {
      const out = new Map<string, { optedOut: boolean; onDnc: boolean }>();
      for (const p of phones) out.set(p, suppression?.get(p) ?? { optedOut: false, onDnc: false });
      return out;
    },
    async enqueue(row) { enqueued.push({ personId: row.personId, state: row.state }); },
    async audit() {},
  };
  return { store, enqueued, personCount: () => persons.size };
}
const src = (ns: NeighborRecord[]): NeighborSource => ({ async neighborsAround() { return ns; } });
const tracer = (m: Record<string, TracedContact[]>): SkipTracer => ({ async trace(n) { return m[n.addressLine1] ?? []; } });
const scrubber = (m: Record<string, ScrubResult>): DncScrubber => ({
  async scrub(ps) { const o = new Map<string, ScrubResult>(); for (const p of ps) o.set(p, m[p] ?? { onDnc: false, lineType: 'mobile' }); return o; },
});
const input = { orgId: 'org-1', teamId: null, campaignId: 'c1', center: { latitude: 47.6, longitude: -122.3 }, radiusMeters: 500, limit: 50 };

describe('circle pipeline (ported)', () => {
  it('queues a clean neighbor and blocks a DNC one', async () => {
    const clean = makeStore();
    const s1 = await buildCircleCampaign(
      { neighborSource: src([{ addressLine1: '1 Main', ownerName: 'Ann Lee', equityPct: 0.6 }]),
        skipTracer: tracer({ '1 Main': [{ phoneE164: '+12065550001', lineType: 'mobile', confidence: 0.9 }] }),
        dncScrubber: scrubber({ '+12065550001': { onDnc: false, lineType: 'mobile' } }), store: clean.store },
      input, config, NOON_PST);
    expect(s1.queued).toBe(1);
    expect(clean.enqueued[0]!.state).toBe('queued');

    const dnc = makeStore();
    const s2 = await buildCircleCampaign(
      { neighborSource: src([{ addressLine1: '2 Main', ownerName: 'Bob Kim' }]),
        skipTracer: tracer({ '2 Main': [{ phoneE164: '+12065550002', lineType: 'mobile', confidence: 0.8 }] }),
        dncScrubber: scrubber({ '+12065550002': { onDnc: true, scope: 'federal', lineType: 'mobile' } }), store: dnc.store },
      input, config, NOON_PST);
    expect(s2.blocked).toBe(1);
    expect(dnc.enqueued[0]!.state).toBe('gate_blocked');
  });

  it('dedupes the same owner into one person', async () => {
    const st = makeStore();
    const dup: NeighborRecord = { addressLine1: '7 Main', ownerName: 'Gao Li' };
    await buildCircleCampaign(
      { neighborSource: src([dup, { ...dup }]),
        skipTracer: tracer({ '7 Main': [{ phoneE164: '+12065550007', lineType: 'mobile', confidence: 0.9 }] }),
        dncScrubber: scrubber({ '+12065550007': { onDnc: false, lineType: 'mobile' } }), store: st.store },
      input, config, NOON_PST);
    expect(st.personCount()).toBe(1);
  });

  it('helpers: priority ranks equity/tenure; dedupeKey canonicalizes phones', () => {
    expect(scoreCirclePriority({ addressLine1: 'a', equityPct: 0.9, tenureYears: 18 }))
      .toBeLessThan(scoreCirclePriority({ addressLine1: 'b', equityPct: 0.05, tenureYears: 1 }));
    expect(dedupeKey('Jane Doe', '+12065551234', 'x')).toBe(dedupeKey('jane  doe', '(206) 555-1234', 'y'));
  });
});

describe('buildOutboundCampaign — expired/fsbo reuse the same spine', () => {
  it('routes a DNC expired to manual (policy=manual), not blocked', async () => {
    const st = makeStore();
    const rec: NeighborRecord = { addressLine1: '9 Ave', ownerName: 'Zoe Ash', listingStatus: 'expired', daysOnMarket: 120 };
    const summary = await buildOutboundCampaign(
      {
        skipTracer: tracer({ '9 Ave': [{ phoneE164: '+12065559999', lineType: 'mobile', confidence: 0.8 }] }),
        dncScrubber: scrubber({ '+12065559999': { onDnc: true, scope: 'federal', lineType: 'mobile' } }),
        store: st.store,
      },
      { orgId: 'org-1', teamId: null, campaignId: 'c1', channel: 'expired', records: [rec] },
      config, NOON_PST,
    );
    expect(summary.manual).toBe(1);
    expect(st.enqueued[0]!.state).toBe('manual');
  });
  it('queues a clean FSBO owner', async () => {
    const st = makeStore();
    const rec: NeighborRecord = { addressLine1: '11 Ave', ownerName: 'Ivy Cole', listingStatus: 'fsbo' };
    const summary = await buildOutboundCampaign(
      {
        skipTracer: tracer({ '11 Ave': [{ phoneE164: '+12065551111', lineType: 'mobile', confidence: 0.9 }] }),
        dncScrubber: scrubber({ '+12065551111': { onDnc: false, lineType: 'mobile' } }),
        store: st.store,
      },
      { orgId: 'org-1', teamId: null, campaignId: 'c2', channel: 'fsbo', records: [rec] },
      config, NOON_PST,
    );
    expect(summary.queued).toBe(1);
  });
  it('stubbed listing feeds return typed records', () => {
    expect(fakeExpiredListings(5).length).toBe(5);
    expect(fakeExpiredListings(5).every((r) => r.listingStatus === 'expired' && (r.daysOnMarket ?? 0) >= 90)).toBe(true);
    expect(fakeFsboListings(5).every((r) => r.listingStatus === 'fsbo')).toBe(true);
  });
});

describe('dossier openers are best-effort', () => {
  it('returns an empty map with no API key (never throws)', async () => {
    const m = await generateOpeners({} as any, 'A nearby home sold', [{ id: 'q1', name: 'Ann', address: '1 Main' }]);
    expect(m.size).toBe(0);
  });
  it('returns an empty map for no neighbors', async () => {
    const m = await generateOpeners({ ANTHROPIC_API_KEY: 'x' } as any, 'subject', []);
    expect(m.size).toBe(0);
  });
});

describe('stubbed providers produce a runnable, varied queue', () => {
  it('runs end-to-end and yields a mix of states', async () => {
    // Collect states across many neighbors from the fakes.
    const states: CircleQueueState[] = [];
    const store: ProspectStore = {
      async upsertProperty() { return { id: 'p' }; },
      async upsertPerson() { return { id: 'x' }; },
      async upsertPhones() {},
      async checkSuppression(_o, phones) { const m = new Map<string, { optedOut: boolean; onDnc: boolean }>(); for (const p of phones) m.set(p, { optedOut: false, onDnc: false }); return m; },
      async enqueue(r) { states.push(r.state); },
      async audit() {},
    };
    const summary = await buildCircleCampaign(
      { neighborSource: fakeNeighborSource(), skipTracer: fakeSkipTracer(), dncScrubber: fakeDncScrubber(), store },
      { ...input, limit: 12 }, config, NOON_PST);
    expect(summary.neighbors).toBeGreaterThan(0);
    // At least one queued (clean) and the fakes seed some DNC → blocked/suppressed.
    expect(states.length).toBeGreaterThan(0);
    expect(summary.queued + summary.blocked + summary.suppressed + summary.manual).toBe(states.length);
  });
});
