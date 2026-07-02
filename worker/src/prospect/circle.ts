// Circle Prospecting pipeline — the agent-assist "zero-to-dial" spine.
// Ported from the Voice ISA repo (src/prospect/circle.ts), verified there by
// test/circle.test.ts. Re-homed to org scoping (org_id + team_id).
//
// Given ONE subject property, build a compliance-cleared, prioritized call list of
// the surrounding neighbors: neighbor lookup → skip trace → DNC scrub → dedupe/
// upsert → gate → call_queue. A HUMAN dials from the queue; nothing auto-dials.
// Pure orchestration over small interfaces (real adapters: providers.ts / store.ts).

import { evaluateProspectGate } from './gate.js';
import type { ProspectGateConfig, ProspectGateDecision, DncScope, LineType } from './gate.js';

// The cold-outbound channels that all ride the identical pipeline — they differ
// only in their lead source (how `records` are fetched) and their script.
export type OutboundChannel = 'circle' | 'expired' | 'fsbo';

export interface NeighborRecord {
  addressLine1: string;
  city?: string;
  state?: string;
  postalCode?: string;
  apn?: string;
  latitude?: number;
  longitude?: number;
  ownerName?: string;
  ownerOccupied?: boolean;
  tenureYears?: number;
  estValue?: number;
  estEquity?: number;
  equityPct?: number; // 0..1
  timezone?: string;
  // Listing context — populated for the expired / FSBO channels, empty for circle.
  mlsId?: string;
  listPrice?: number;
  daysOnMarket?: number;
  priceChanges?: Array<{ at?: string; from?: number; to?: number }>;
  listingStatus?: string; // 'expired' | 'withdrawn' | 'fsbo' | ...
}

export interface TracedContact {
  phoneE164: string;
  lineType: LineType;
  confidence: number; // 0..1
  source?: string;
}

export interface ScrubResult {
  onDnc: boolean;
  scope?: DncScope;
  lineType?: LineType;
}

export interface NeighborSource {
  neighborsAround(input: {
    subjectPropertyId?: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit: number;
  }): Promise<NeighborRecord[]>;
}

export interface SkipTracer {
  trace(neighbor: NeighborRecord): Promise<TracedContact[]>;
}

export interface DncScrubber {
  scrub(phones: string[]): Promise<Map<string, ScrubResult>>;
}

export interface ProspectStore {
  upsertProperty(p: NeighborRecord & { orgId: string; teamId: string | null }): Promise<{ id: string }>;
  upsertPerson(p: {
    orgId: string;
    teamId: string | null;
    dedupeKey: string;
    propertyId: string | null;
    fullName: string | null;
    bestPhoneE164: string | null;
    timezone: string | null;
    source: string;
    owningAgentId: string | null;
  }): Promise<{ id: string }>;
  upsertPhones(
    personId: string,
    orgId: string,
    phones: Array<{
      phoneE164: string;
      lineType: LineType;
      confidence: number;
      dncStatus: string;
      isBest: boolean;
      source: string | null;
    }>,
  ): Promise<void>;
  checkSuppression(orgId: string, phones: string[]): Promise<Map<string, { optedOut: boolean; onDnc: boolean }>>;
  enqueue(row: {
    orgId: string;
    teamId: string | null;
    campaignId: string;
    personId: string;
    phoneE164: string | null;
    channel: OutboundChannel;
    priority: number;
    state: CircleQueueState;
    gateDecision: ProspectGateDecision;
    nextEligibleAt: string | null;
  }): Promise<void>;
  audit(entry: { orgId: string; personId: string | null; eventType: string; payload: Record<string, unknown> }): Promise<void>;
}

export type CircleQueueState = 'queued' | 'manual' | 'gate_blocked' | 'suppressed';

export interface CircleInput {
  orgId: string;
  teamId: string | null;
  campaignId: string;
  subjectPropertyId?: string;
  center: { latitude: number; longitude: number };
  radiusMeters: number;
  limit: number;
  agentId?: string;
}

export interface CircleSummary {
  neighbors: number;
  queued: number;
  manual: number;
  blocked: number;
  suppressed: number;
  uncallable: number;
  errors: number;
}

/** Priority hint — lower dials sooner. Ranks by equity then tenure. ~1..100. */
export function scoreCirclePriority(n: NeighborRecord): number {
  const equityPart = Math.min(40, Math.max(0, (n.equityPct ?? 0) * 40));
  const tenurePart = Math.min(20, Math.max(0, n.tenureYears ?? 0));
  return Math.max(1, Math.round(100 - equityPart - tenurePart));
}

/** Stable dedupe key so a person is skip-traced/dialed once across channels. */
export function dedupeKey(name: string | undefined, phone: string | undefined, address: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normPhone = (s: string) => {
    const d = s.replace(/\D/g, '');
    return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  };
  if (name && phone) return `${norm(name)}:${normPhone(phone)}`;
  if (phone) return `phone:${normPhone(phone)}`;
  return `addr:${norm(address)}`;
}

function stateForDecision(d: ProspectGateDecision): CircleQueueState {
  if (d.verdict === 'allow') return 'queued';
  if (d.verdict === 'manual') return 'manual';
  if (d.blockers.includes('OPTED_OUT') || d.blockers.includes('ON_DNC_LITIGATOR')) return 'suppressed';
  return 'gate_blocked';
}

function pickBest(traced: TracedContact[]): TracedContact | null {
  if (traced.length === 0) return null;
  return [...traced].sort((a, b) => {
    const am = a.lineType === 'mobile' ? 1 : 0;
    const bm = b.lineType === 'mobile' ? 1 : 0;
    if (am !== bm) return bm - am;
    return b.confidence - a.confidence;
  })[0]!;
}

export interface OutboundInput {
  orgId: string;
  teamId: string | null;
  campaignId: string;
  channel: OutboundChannel;
  agentId?: string;
  /** Already-fetched owner/property records from the channel's lead source. */
  records: NeighborRecord[];
}

/**
 * The generic agent-assist outbound pipeline for cold channels (circle / expired
 * / fsbo). Given already-fetched owner/property records, it skip-traces, scrubs
 * DNC, gates, and enqueues a compliance-tagged call list. Channels differ ONLY in
 * their lead source (the caller fetches `records`) and script — everything here
 * is identical. A human dials from the queue; nothing auto-dials.
 */
export async function buildOutboundCampaign(
  deps: { skipTracer: SkipTracer; dncScrubber: DncScrubber; store: ProspectStore },
  input: OutboundInput,
  config: ProspectGateConfig,
  now: Date,
): Promise<CircleSummary> {
  const summary: CircleSummary = { neighbors: 0, queued: 0, manual: 0, blocked: 0, suppressed: 0, uncallable: 0, errors: 0 };
  const { orgId, teamId, channel } = input;
  summary.neighbors = input.records.length;

  for (const n of input.records) {
    try {
      const property = await deps.store.upsertProperty({ ...n, orgId, teamId });
      const traced = await deps.skipTracer.trace(n);
      const best = pickBest(traced);

      if (!best) {
        const personId = (await deps.store.upsertPerson({
          orgId, teamId, dedupeKey: dedupeKey(n.ownerName, undefined, n.addressLine1),
          propertyId: property.id, fullName: n.ownerName ?? null, bestPhoneE164: null,
          timezone: n.timezone ?? null, source: channel, owningAgentId: input.agentId ?? null,
        })).id;
        await deps.store.audit({ orgId, personId, eventType: 'scrub', payload: { result: 'uncallable', address: n.addressLine1 } });
        summary.uncallable++;
        continue;
      }

      const allPhones = traced.map((t) => t.phoneE164);
      const [scrub, internal] = await Promise.all([
        deps.dncScrubber.scrub(allPhones),
        deps.store.checkSuppression(orgId, allPhones),
      ]);

      const bestScrub = scrub.get(best.phoneE164);
      const bestInternal = internal.get(best.phoneE164);
      const onDnc = Boolean(bestScrub?.onDnc) || Boolean(bestInternal?.onDnc);
      const optedOut = Boolean(bestInternal?.optedOut);
      const dncScope: DncScope | undefined = bestScrub?.scope ?? (bestInternal?.onDnc ? 'internal' : undefined);

      const personId = (await deps.store.upsertPerson({
        orgId, teamId, dedupeKey: dedupeKey(n.ownerName, best.phoneE164, n.addressLine1),
        propertyId: property.id, fullName: n.ownerName ?? null, bestPhoneE164: best.phoneE164,
        timezone: n.timezone ?? null, source: channel, owningAgentId: input.agentId ?? null,
      })).id;

      await deps.store.upsertPhones(personId, orgId, traced.map((t) => {
        const s = scrub.get(t.phoneE164);
        const it = internal.get(t.phoneE164);
        const dncStatus = it?.onDnc ? 'internal' : s?.onDnc ? (s.scope ?? 'federal') : s ? 'clear' : 'unknown';
        return {
          phoneE164: t.phoneE164, lineType: s?.lineType ?? t.lineType, confidence: t.confidence,
          dncStatus, isBest: t.phoneE164 === best.phoneE164, source: t.source ?? null,
        };
      }));

      const decision = evaluateProspectGate(
        {
          personId, channel, phoneE164: best.phoneE164, timezone: n.timezone ?? null,
          optedOut, onDnc, dncScope, lineType: bestScrub?.lineType ?? best.lineType,
          attempts: 0, priorityHint: scoreCirclePriority(n),
        },
        config, now,
      );

      const state = stateForDecision(decision);
      await deps.store.enqueue({
        orgId, teamId, campaignId: input.campaignId, personId, phoneE164: best.phoneE164,
        channel, priority: decision.priority, state, gateDecision: decision,
        nextEligibleAt: decision.nextEligibleAt,
      });
      await deps.store.audit({ orgId, personId, eventType: 'gate_decision', payload: { channel, decision } });

      if (state === 'queued') summary.queued++;
      else if (state === 'manual') summary.manual++;
      else if (state === 'suppressed') summary.suppressed++;
      else summary.blocked++;
    } catch {
      summary.errors++;
    }
  }

  return summary;
}

/** Circle Prospecting: fetch the neighbors around a subject, then run the pipeline. */
export async function buildCircleCampaign(
  deps: { neighborSource: NeighborSource; skipTracer: SkipTracer; dncScrubber: DncScrubber; store: ProspectStore },
  input: CircleInput,
  config: ProspectGateConfig,
  now: Date,
): Promise<CircleSummary> {
  const records = await deps.neighborSource.neighborsAround({
    subjectPropertyId: input.subjectPropertyId,
    latitude: input.center.latitude,
    longitude: input.center.longitude,
    radiusMeters: input.radiusMeters,
    limit: input.limit,
  });
  return buildOutboundCampaign(
    { skipTracer: deps.skipTracer, dncScrubber: deps.dncScrubber, store: deps.store },
    { orgId: input.orgId, teamId: input.teamId, campaignId: input.campaignId, channel: 'circle', agentId: input.agentId, records },
    config, now,
  );
}
