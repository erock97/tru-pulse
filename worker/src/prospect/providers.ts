// Prospecting data providers. Circle needs three "buy" services: neighbor lookup
// (ATTOM/Regrid), skip trace (BatchData), and DNC scrub (DNC.com). Until those
// accounts/keys exist, these deterministic FAKES let the whole pipeline run
// end-to-end for free. Real adapters implement the same interfaces and swap in at
// prospectProviders() when the keys are present — no pipeline changes.
import type { Env } from '../env.js';
import type {
  NeighborSource, SkipTracer, DncScrubber, NeighborRecord, TracedContact, ScrubResult,
} from './circle.js';

// Deterministic pseudo-random from a string seed (reproducible demos; no Math.random).
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Clean synthetic US E.164 (+1 206 xxxxxxx) so the demo scrub logic is predictable.
function fakePhone(seed: number): string {
  return '+1206' + String(2000000 + (seed % 8000000)).slice(0, 7);
}

const STREETS = ['Maple', 'Oak', 'Cedar', 'Birch', 'Elm', 'Pine', 'Walnut', 'Ash', 'Cherry', 'Spruce', 'Willow', 'Alder'];
const OWNERS = ['Ann Lee', 'Bob Kim', 'Cara Diaz', 'Dan Ford', 'Eve Ng', 'Frank Ito', 'Gina Ray', 'Hugo Sax', 'Ivy Chen', 'Jon Park', 'Kay Ruiz', 'Leo Vance'];

export function fakeNeighborSource(): NeighborSource {
  return {
    async neighborsAround({ latitude, longitude, limit }) {
      const n = Math.min(limit, 20);
      const out: NeighborRecord[] = [];
      for (let i = 0; i < n; i += 1) {
        const seed = hash(`${latitude},${longitude},${i}`);
        const equityPct = (seed % 100) / 100;
        const value = 600000 + (seed % 400000);
        out.push({
          addressLine1: `${100 + i * 2} ${STREETS[i % STREETS.length]} St`,
          city: 'Seattle', state: 'WA', postalCode: '98103',
          latitude: latitude + (i - 6) * 0.0004, longitude: longitude + (i - 6) * 0.0004,
          ownerName: OWNERS[i % OWNERS.length],
          ownerOccupied: (seed & 1) === 0,
          tenureYears: (seed >> 3) % 25,
          equityPct, estValue: value, estEquity: Math.round(value * equityPct),
          timezone: 'America/Los_Angeles',
        });
      }
      return out;
    },
  };
}

export function fakeSkipTracer(): SkipTracer {
  return {
    async trace(n) {
      const seed = hash(n.addressLine1 + (n.ownerName ?? ''));
      if (seed % 10 === 0) return []; // ~1 in 10 uncallable
      const contacts: TracedContact[] = [
        { phoneE164: fakePhone(seed), lineType: 'mobile', confidence: 0.7 + (seed % 30) / 100, source: 'fake' },
      ];
      if (seed % 3 === 0) {
        contacts.push({ phoneE164: fakePhone(seed * 7 + 13), lineType: 'landline', confidence: 0.4, source: 'fake' });
      }
      return contacts;
    },
  };
}

export function fakeDncScrubber(): DncScrubber {
  return {
    async scrub(phones) {
      const out = new Map<string, ScrubResult>();
      for (const p of phones) {
        const seed = hash(p);
        const last = Number(p.slice(-1));
        let onDnc = false;
        let scope: ScrubResult['scope'] | undefined;
        if (p.endsWith('0000')) { onDnc = true; scope = 'litigator'; }
        else if (last >= 7) { onDnc = true; scope = 'federal'; }
        out.set(p, { onDnc, scope, lineType: seed % 4 === 0 ? 'landline' : 'mobile' });
      }
      return out;
    },
  };
}

// ── Listing sources (Expired / FSBO) — stubbed until MLS / feed access lands ──
// Return listing-shaped NeighborRecords (owner + property + listing context) so
// they ride the exact same buildOutboundCampaign pipeline as circle.

function fakeListings(seedTag: string, limit: number, status: 'expired' | 'fsbo'): NeighborRecord[] {
  const n = Math.min(limit, 20);
  const out: NeighborRecord[] = [];
  for (let i = 0; i < n; i += 1) {
    const seed = hash(`${seedTag},${status},${i}`);
    const equityPct = (seed % 100) / 100;
    const value = 500000 + (seed % 500000);
    const cuts = seed % 3; // 0..2 price reductions
    const priceChanges = Array.from({ length: cuts }, (_, k) => ({
      from: value + (cuts - k) * 15000, to: value + (cuts - k - 1) * 15000,
    }));
    out.push({
      addressLine1: `${200 + i * 3} ${STREETS[(i + 4) % STREETS.length]} Ave`,
      city: 'Seattle', state: 'WA', postalCode: '98115',
      ownerName: OWNERS[(i + 3) % OWNERS.length],
      ownerOccupied: (seed & 1) === 0,
      tenureYears: (seed >> 4) % 22,
      equityPct, estValue: value, estEquity: Math.round(value * equityPct),
      timezone: 'America/Los_Angeles',
      mlsId: `MLS${(seed % 900000) + 100000}`,
      listPrice: value + 20000,
      daysOnMarket: status === 'expired' ? 90 + (seed % 120) : 10 + (seed % 60),
      priceChanges,
      listingStatus: status,
    });
  }
  return out;
}

/** Today's expired/withdrawn listings (stub). Real: RESO/MLS or REDX/Vulcan feed. */
export function fakeExpiredListings(limit: number): NeighborRecord[] {
  return fakeListings('expired-feed', limit, 'expired');
}

/** Today's FSBO listings (stub). Real: aggregate Zillow/Craigslist/FSBO.com (licensed). */
export function fakeFsboListings(limit: number): NeighborRecord[] {
  return fakeListings('fsbo-feed', limit, 'fsbo');
}

export interface ProspectProviders {
  neighborSource: NeighborSource;
  skipTracer: SkipTracer;
  dncScrubber: DncScrubber;
  live: boolean; // true once real adapters are wired
}

// Swap to real adapters here once BATCHDATA_KEY / ATTOM_KEY / DNC_API_KEY are set.
export function prospectProviders(_env: Env): ProspectProviders {
  return {
    neighborSource: fakeNeighborSource(),
    skipTracer: fakeSkipTracer(),
    dncScrubber: fakeDncScrubber(),
    live: false,
  };
}
