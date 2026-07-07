// ═══════════════════════════════════════════════════════════════════════════
// TRU Pulse — accuracy metrics (Section 1, Block 2)
// ═══════════════════════════════════════════════════════════════════════════
// Pure functions, no I/O — mirrors shared/flags.ts. Computes per-team / per-agent
// total leads, offer/UC/closed counts, and the stable 1:N conversion ratio, per
// the LOCKED definitions in docs/accuracy-definitions.md. Reuses shared/flags.ts
// (stageClass / isOfferPlus / isClosing / sourceFamily) for every classification.
//
// ── THE CORE ASYMMETRY (read this before touching anything below) ──────────
// §2 total leads is windowed by CREATED date (leads.fub_created) and EXCLUDES
// dateless leads. §3 offer/UC/closed is windowed by ACHIEVEMENT date
// (person_stage_log.changed_at) and is driven ENTIRELY by the hit rows — the
// lead's created date (or its absence) never gates the numerator. A lead
// created 18 months ago, or with no created date at all, that reaches Under
// Contract today STILL COUNTS in today's numerator. See computeWindowedMetrics:
// the denominator loop filters on `l.fub_created`; the numerator loop filters
// ONLY on `h.changed_at` — the two loops never share a created-date condition.

import { stageClass, isOfferPlus, isClosing, sourceFamily, type StageClass } from './flags.js';

export type Window = '7' | '14' | 'mtd' | '90' | '180' | '365';
export const WINDOWS: Window[] = ['7', '14', 'mtd', '90', '180', '365'];

const normName = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const UNASSIGNED_KEY = '__unassigned__';
const UNASSIGNED_LABEL = 'Unassigned';

/** Start-of-window timestamp (ms). `now` is injectable so this stays pure/testable. */
export function windowStartMs(win: Window, now: number = Date.now()): number {
  if (win === 'mtd') {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  const days = Number(win);
  return now - days * 86400_000;
}

// ── Inputs ───────────────────────────────────────────────────────────────
// A minimal lead shape — the denominator side. `source_family` is expected to
// already be the tracked-family string (or null/untracked), i.e. the output of
// shared/flags.ts sourceFamily() as stamped by worker/src/sync.ts at write time.
// A raw `source` may be supplied instead (e.g. from an older row); when
// `source_family` is absent we derive it here via the same sourceFamily() so
// the module never silently mis-scopes a lead.
export interface MetricsLead {
  fub_person_id: number;
  source_family?: string | null;
  source?: string | null;
  fub_created: string | null; // ISO date string; null = dateless
  assigned_to?: string | null; // display agent name, for the denominator's per-agent split
}

// A person_stage_log row — the numerator side. `stage_class` is expected
// pre-computed (worker/src/sync.ts stamps it via stageClass() at write time);
// a raw `stage` may be supplied instead as a fallback so this module stays
// correct even against an older/partial row.
export interface MetricsStageHit {
  fub_person_id: number;
  stage_class?: StageClass | string | null;
  stage?: string | null;
  changed_at: string | null; // null = dateless (seed, pre-history)
  date_source?: string | null; // 'live' | 'deal_close_date' | 'seed' | 'tableau'
  agent_user_id?: number | string | null;
  agent_name?: string | null;
}

function resolveClass(h: MetricsStageHit): StageClass {
  if (h.stage_class === 'offer' || h.stage_class === 'uc' || h.stage_class === 'closed' || h.stage_class === 'other') {
    return h.stage_class;
  }
  return stageClass(h.stage ?? (typeof h.stage_class === 'string' ? h.stage_class : null));
}

function resolveFamily(l: MetricsLead): string | null {
  if (l.source_family !== undefined) return l.source_family;
  return sourceFamily(l.source);
}

/** The stable identity for a stage-log hit's owning agent: user id preferred
 *  (survives a name edit / re-spelling), name as fallback, else unassigned. */
function hitAgentKey(h: MetricsStageHit): { key: string; label: string } {
  if (h.agent_user_id != null && String(h.agent_user_id).trim()) {
    const label = h.agent_name && h.agent_name.trim() ? h.agent_name.trim() : `Agent #${h.agent_user_id}`;
    // Keyed by normalized NAME when we have one, so this merges cleanly with the
    // lead-side denominator (leads only carry `assigned_to`, a name — there is no
    // agent_user_id on `leads` yet). Falls back to a uid-only key (own row, 0
    // total leads) only in the rare case a hit has an id but no name.
    return h.agent_name && h.agent_name.trim() ? { key: normName(h.agent_name), label } : { key: `uid:${h.agent_user_id}`, label };
  }
  if (h.agent_name && h.agent_name.trim()) return { key: normName(h.agent_name), label: h.agent_name.trim() };
  return { key: UNASSIGNED_KEY, label: UNASSIGNED_LABEL };
}

function leadAgentKey(l: MetricsLead): { key: string; label: string } {
  if (l.assigned_to && l.assigned_to.trim()) return { key: normName(l.assigned_to), label: l.assigned_to.trim() };
  return { key: UNASSIGNED_KEY, label: UNASSIGNED_LABEL };
}

function sourceAllowed(family: string | null, enabledSources?: string[] | null): boolean {
  if (family == null) return false; // untracked — excluded everywhere (§1)
  if (!enabledSources || enabledSources.length === 0) return true;
  return enabledSources.includes(family);
}

// ── Output shapes ────────────────────────────────────────────────────────
export interface AgentBucket {
  agent: string; // display label
  totalLeads: number;
  offersReached: number;
  underContractOrClosed: number;
}

export interface WindowedMetrics {
  window: Window;
  totalLeads: number;
  offersReached: number;
  underContractOrClosed: number;
  byAgent: AgentBucket[];
}

export interface ConversionResult {
  n: number | null; // null => render "—" (no closings yet)
  ratioLabel: string; // "1 : N" or "—"
  allTimeLeads: number;
  allTimeClosings: number;
}

export interface MetricsOptions {
  window: Window;
  enabledSources?: string[] | null; // §2 ruling B: the source filter narrows the denominator (and, for
  // consistency with how the rest of the board already filters by source, the numerator too).
  now?: number; // injectable clock for tests; defaults to Date.now()
}

/**
 * §2 total leads (created-date windowed, dateless excluded) + §3 offer/UC/closed
 * (changed_at windowed, seed excluded) — team-level and per-agent.
 *
 * ASYMMETRY, enforced structurally: the two loops below never share a filter.
 * The denominator loop tests `l.fub_created` against the window. The numerator
 * loop tests `h.changed_at` against the window — a lead's created date (or its
 * absence) is never consulted there.
 */
export function computeWindowedMetrics(
  leads: MetricsLead[],
  hits: MetricsStageHit[],
  opts: MetricsOptions,
): WindowedMetrics {
  const now = opts.now ?? Date.now();
  const start = windowStartMs(opts.window, now);
  const enabled = opts.enabledSources;

  // fub_person_id -> tracked source family, for joining hits (which carry no
  // source_family of their own) back to their lead's source, so the enabled-
  // sources filter can apply to the numerator exactly as it does to leads.
  const familyByPerson = new Map<number, string | null>();
  for (const l of leads) familyByPerson.set(l.fub_person_id, resolveFamily(l));

  // ── §2 denominator: totalLeads, windowed by CREATED date, dateless EXCLUDED ──
  const totalsByAgent = new Map<string, AgentBucket>();
  const getBucket = (key: string, label: string): AgentBucket => {
    let b = totalsByAgent.get(key);
    if (!b) { b = { agent: label, totalLeads: 0, offersReached: 0, underContractOrClosed: 0 }; totalsByAgent.set(key, b); }
    return b;
  };
  let totalLeads = 0;
  for (const l of leads) {
    const family = resolveFamily(l);
    if (!sourceAllowed(family, enabled)) continue;
    if (!l.fub_created) continue; // Ruling A: dateless leads excluded from windowed totals (denominator-only)
    const createdMs = Date.parse(l.fub_created);
    if (Number.isNaN(createdMs) || createdMs < start) continue;
    totalLeads++;
    const { key, label } = leadAgentKey(l);
    getBucket(key, label).totalLeads++;
  }

  // ── §3 numerator: offersReached / underContractOrClosed, windowed by changed_at,
  //    seed rows EXCLUDED, the lead's created date is NEVER consulted here. ──
  const offerPersons = new Set<number>();
  const ucPersons = new Set<number>();
  const offerPersonsByAgent = new Map<string, Set<number>>();
  const ucPersonsByAgent = new Map<string, Set<number>>();
  const addTo = (map: Map<string, Set<number>>, key: string, person: number) => {
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    s.add(person);
  };

  for (const h of hits) {
    if (h.date_source === 'seed') continue; // dateless pre-history, excluded from windowed numerators
    if (!h.changed_at) continue; // defensive: no date, can't be windowed
    const changedMs = Date.parse(h.changed_at);
    if (Number.isNaN(changedMs) || changedMs < start) continue;
    const family = familyByPerson.get(h.fub_person_id) ?? null;
    if (!sourceAllowed(family, enabled)) continue;

    const cls = resolveClass(h);
    const { key, label } = hitAgentKey(h);
    if (isOfferPlus(cls)) {
      offerPersons.add(h.fub_person_id);
      addTo(offerPersonsByAgent, key, h.fub_person_id);
      getBucket(key, label); // ensure the bucket exists even if this agent has no leads assigned in-window
    }
    if (isClosing(cls)) {
      ucPersons.add(h.fub_person_id);
      addTo(ucPersonsByAgent, key, h.fub_person_id);
      getBucket(key, label);
    }
  }

  for (const [key, set] of offerPersonsByAgent) totalsByAgent.get(key)!.offersReached = set.size;
  for (const [key, set] of ucPersonsByAgent) totalsByAgent.get(key)!.underContractOrClosed = set.size;

  return {
    window: opts.window,
    totalLeads,
    offersReached: offerPersons.size,
    underContractOrClosed: ucPersons.size,
    byAgent: [...totalsByAgent.values()].sort((a, b) => b.totalLeads - a.totalLeads),
  };
}

function ratio(leadCount: number, closingCount: number): ConversionResult {
  if (closingCount <= 0) return { n: null, ratioLabel: '—', allTimeLeads: leadCount, allTimeClosings: closingCount };
  const n = Math.max(1, Math.round(leadCount / closingCount));
  return { n, ratioLabel: `1 : ${n}`, allTimeLeads: leadCount, allTimeClosings: closingCount };
}

/**
 * §4 conversion — a STABLE, ALL-TIME `1 : N` ratio. NOT windowed by design: the
 * all-time baseline may include dateless seed closings (§5) and dateless-created
 * leads, because "all-time" has no window to be dateless WITH RESPECT TO.
 *
 * `enabledSources` is accepted for parity with how the rest of the board already
 * scopes to "my leads" (Dashboard.tsx's `allTracked`) — the definitions doc does
 * not explicitly rule on this; flagged in the Block 2 report as an open item for
 * Block 3 to confirm before wiring the UI.
 */
export function computeAllTimeConversion(
  leads: MetricsLead[],
  hits: MetricsStageHit[],
  enabledSources?: string[] | null,
): ConversionResult {
  const familyByPerson = new Map<number, string | null>();
  const leadCountBySource = new Map<string, number>();
  let leadCount = 0;
  for (const l of leads) {
    const family = resolveFamily(l);
    familyByPerson.set(l.fub_person_id, family);
    if (!sourceAllowed(family, enabledSources)) continue;
    leadCount++;
    leadCountBySource.set(family as string, (leadCountBySource.get(family as string) ?? 0) + 1);
  }
  const closingPersons = new Set<number>();
  const closingPersonsBySource = new Map<string, Set<number>>();
  for (const h of hits) {
    if (!isClosing(resolveClass(h))) continue;
    const family = familyByPerson.get(h.fub_person_id) ?? null;
    if (!sourceAllowed(family, enabledSources)) continue;
    closingPersons.add(h.fub_person_id);
    let s = closingPersonsBySource.get(family as string);
    if (!s) { s = new Set(); closingPersonsBySource.set(family as string, s); }
    s.add(h.fub_person_id);
  }
  return ratio(leadCount, closingPersons.size);
}

/**
 * §3a (RULED 2026-07-07) — the team-headline OFFER figure as a STABLE, ALL-TIME
 * `1 : N` ratio, computed IDENTICALLY to computeAllTimeConversion but with the
 * numerator being offer-or-beyond (isOfferPlus) instead of closing-or-beyond —
 * a lead that jumps straight to Under Contract still counts, so this can never
 * render "1 : 0" / a 0% offer rate. All-time (not windowed), so dateless seed
 * hits are usable in the baseline exactly as they are for conversion (§5).
 */
export function computeAllTimeOfferRatio(
  leads: MetricsLead[],
  hits: MetricsStageHit[],
  enabledSources?: string[] | null,
): ConversionResult {
  const familyByPerson = new Map<number, string | null>();
  let leadCount = 0;
  for (const l of leads) {
    const family = resolveFamily(l);
    familyByPerson.set(l.fub_person_id, family);
    if (!sourceAllowed(family, enabledSources)) continue;
    leadCount++;
  }
  const offerPersons = new Set<number>();
  for (const h of hits) {
    if (!isOfferPlus(resolveClass(h))) continue;
    const family = familyByPerson.get(h.fub_person_id) ?? null;
    if (!sourceAllowed(family, enabledSources)) continue;
    offerPersons.add(h.fub_person_id);
  }
  return ratio(leadCount, offerPersons.size);
}

/** Per-source `1:N`, same all-time (unwindowed) baseline as computeAllTimeConversion. */
export function computeAllTimeConversionBySource(
  leads: MetricsLead[],
  hits: MetricsStageHit[],
): Record<string, ConversionResult> {
  const familyByPerson = new Map<number, string | null>();
  const leadCountBySource = new Map<string, number>();
  for (const l of leads) {
    const family = resolveFamily(l);
    familyByPerson.set(l.fub_person_id, family);
    if (family == null) continue;
    leadCountBySource.set(family, (leadCountBySource.get(family) ?? 0) + 1);
  }
  const closingPersonsBySource = new Map<string, Set<number>>();
  for (const h of hits) {
    if (!isClosing(resolveClass(h))) continue;
    const family = familyByPerson.get(h.fub_person_id) ?? null;
    if (family == null) continue;
    let s = closingPersonsBySource.get(family);
    if (!s) { s = new Set(); closingPersonsBySource.set(family, s); }
    s.add(h.fub_person_id);
  }
  const out: Record<string, ConversionResult> = {};
  for (const family of leadCountBySource.keys()) {
    out[family] = ratio(leadCountBySource.get(family) ?? 0, closingPersonsBySource.get(family)?.size ?? 0);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3b (RULED 2026-07-07) — agent-level windowed counts + ▲/▼ trend vs the prior
// equal-length period. Stable ratios are the team headline; the agent level is
// the trend surface (Eric: "super important to track upward and downward trends
// on the agent level"). Rule of thumb: RATIOS are stable/all-time; COUNTS are
// always windowed — at both team and agent level.
// ═══════════════════════════════════════════════════════════════════════════

export interface AgentRangeBucket {
  agent: string; // display label
  offersReached: number;
  underContractOrClosed: number;
}

export interface RangeMetrics {
  offersReached: number;
  underContractOrClosed: number;
  byAgent: AgentRangeBucket[];
}

/**
 * §3 numerator (offers-reached / UC-closed), scoped to an EXPLICIT
 * `[startMs, endMs)` range rather than "since start, unbounded above" the way
 * computeWindowedMetrics is. computeWindowedMetrics can't express a PRIOR,
 * bounded period (e.g. "the 14 days before this 14-day window") — this function
 * is what makes that possible, so computeAgentTrends can diff two ranges.
 *
 * Same rules as computeWindowedMetrics' numerator loop: windowed by
 * `changed_at`, offer-or-beyond carry-forward, seed rows excluded, source-scoped
 * via each hit's lead. `leads` is consulted ONLY to resolve a hit's source
 * family (§2's created-date logic is irrelevant here — see the file-header note).
 */
export function computeRangeMetrics(
  leads: MetricsLead[],
  hits: MetricsStageHit[],
  range: { startMs: number; endMs: number; enabledSources?: string[] | null },
): RangeMetrics {
  const familyByPerson = new Map<number, string | null>();
  for (const l of leads) familyByPerson.set(l.fub_person_id, resolveFamily(l));

  const offerPersons = new Set<number>();
  const ucPersons = new Set<number>();
  const offerPersonsByAgent = new Map<string, Set<number>>();
  const ucPersonsByAgent = new Map<string, Set<number>>();
  const labelByKey = new Map<string, string>();
  const addTo = (map: Map<string, Set<number>>, key: string, person: number) => {
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    s.add(person);
  };

  for (const h of hits) {
    if (h.date_source === 'seed') continue; // dateless pre-history, excluded from windowed/range numerators
    if (!h.changed_at) continue;
    const changedMs = Date.parse(h.changed_at);
    if (Number.isNaN(changedMs) || changedMs < range.startMs || changedMs >= range.endMs) continue;
    const family = familyByPerson.get(h.fub_person_id) ?? null;
    if (!sourceAllowed(family, range.enabledSources)) continue;

    const cls = resolveClass(h);
    const { key, label } = hitAgentKey(h);
    labelByKey.set(key, label);
    if (isOfferPlus(cls)) { offerPersons.add(h.fub_person_id); addTo(offerPersonsByAgent, key, h.fub_person_id); }
    if (isClosing(cls)) { ucPersons.add(h.fub_person_id); addTo(ucPersonsByAgent, key, h.fub_person_id); }
  }

  const keys = new Set<string>([...offerPersonsByAgent.keys(), ...ucPersonsByAgent.keys()]);
  const byAgent: AgentRangeBucket[] = [...keys].map((key) => ({
    agent: labelByKey.get(key) ?? key,
    offersReached: offerPersonsByAgent.get(key)?.size ?? 0,
    underContractOrClosed: ucPersonsByAgent.get(key)?.size ?? 0,
  }));

  return { offersReached: offerPersons.size, underContractOrClosed: ucPersons.size, byAgent };
}

export interface AgentTrend {
  agent: string; // display label
  offersReached: number; // CURRENT window
  closings: number;      // CURRENT window (underContractOrClosed)
  offersDelta: number;   // current − prior; positive = ▲, negative = ▼, 0 = flat (—)
  closingsDelta: number;
}

export interface AgentTrendsOptions {
  window: Window;
  enabledSources?: string[] | null;
  now?: number; // injectable clock for tests; defaults to Date.now()
}

/**
 * §3b — per-agent windowed offers/closings for the SELECTED window, plus a
 * ▲/▼ delta vs the prior equal-length period.
 *
 * PRIOR PERIOD DEFINITION (documented, per the ruling):
 *  - Day windows (7 / 14 / 90 / 180 / 365): current = [start, now) where
 *    start = windowStartMs(window, now). Prior = the immediately preceding
 *    period of the SAME length: [start − len, start) where len = now − start.
 *    ("this 30d vs the previous 30d.")
 *  - mtd: current = [1st of this month, now). Prior = the PREVIOUS calendar
 *    month, from its 1st through the SAME elapsed duration into the month
 *    (e.g. today is the 10th → prior = the 1st through the 10th of last
 *    month) — an equal-length "month-to-date vs month-to-date" comparison,
 *    not the whole prior month (which would almost always be a larger period
 *    and make the delta meaningless).
 */
export function computeAgentTrends(
  leads: MetricsLead[],
  hits: MetricsStageHit[],
  opts: AgentTrendsOptions,
): AgentTrend[] {
  const now = opts.now ?? Date.now();
  const start = windowStartMs(opts.window, now);

  let priorStart: number;
  let priorEnd: number;
  if (opts.window === 'mtd') {
    const d = new Date(start); // start = 1st of the current month, 00:00 local
    priorStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    priorEnd = priorStart + (now - start); // same elapsed duration into last month
  } else {
    const len = now - start;
    priorStart = start - len;
    priorEnd = start;
  }

  const current = computeRangeMetrics(leads, hits, { startMs: start, endMs: now, enabledSources: opts.enabledSources });
  const prior = computeRangeMetrics(leads, hits, { startMs: priorStart, endMs: priorEnd, enabledSources: opts.enabledSources });
  const priorByAgent = new Map(prior.byAgent.map((b) => [b.agent, b]));

  const agents = new Map<string, AgentRangeBucket>();
  for (const b of current.byAgent) agents.set(b.agent, b);
  for (const b of prior.byAgent) if (!agents.has(b.agent)) agents.set(b.agent, { agent: b.agent, offersReached: 0, underContractOrClosed: 0 });

  return [...agents.values()].map((b) => {
    const p = priorByAgent.get(b.agent);
    return {
      agent: b.agent,
      offersReached: b.offersReached,
      closings: b.underContractOrClosed,
      offersDelta: b.offersReached - (p?.offersReached ?? 0),
      closingsDelta: b.underContractOrClosed - (p?.underContractOrClosed ?? 0),
    };
  });
}
