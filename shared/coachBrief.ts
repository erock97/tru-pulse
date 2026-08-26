// The weekly coaching brief — the contract between the Hermes automation (an
// external sender, via the Worker's POST /coach/weekly-report) and the Coach tab.
//
// Everything here is pure: validation, name matching, and evidence resolution,
// shared by the Worker (ingest) and the web app (rendering) so the two can never
// drift. No imports, no I/O.

// ── Payload types ───────────────────────────────────────────────────────────

export interface BriefMetrics {
  reviewedContacts: number;
  substantiveContacts: number;
  // Initial-outreach behavior: how the agent FIRST touched each reviewed lead.
  callFirst: number;
  textFirst: number;
  noOutreach: number;
  unclassified: number;
}

/** One coaching point. `findingIndexes` ties it to its evidence (findings[]). */
export interface BriefPoint {
  text: string;
  /** The "Coach:" line — how to coach this point, when the report includes one. */
  coach?: string;
  findingIndexes: number[];
}

/**
 * A coaching opportunity in schema 1.1 — the analysis now supplies what this
 * Worker previously had to infer.
 *
 * `explanation` is the plain-English line, written by the model that actually
 * read the calls. `patternKey` is a stable identity for the habit, so the same
 * habit recurring next week is recognisable without guessing from wording.
 * `findingIds` are the durable evidence.
 */
export interface BriefOpportunity {
  findingIndex?: number;
  findingIds: string[];
  patternKey?: string;
  explanation: string;
  coachingMove?: string;
  /**
   * Schema 1.2 evidence grounding (docs/HERMES_CONTRACT.md §2). The stored
   * payload is the raw history — dropping these here would lose them forever,
   * so they pass through even though display work for them is still pending.
   */
  isFirstContact?: boolean | 'unknown';
  sourceQuote?: string;
  sourceChannel?: string;
  sourceQuality?: string;
  durationSeconds?: number;
}

export interface BriefAgent {
  agentName: string;
  metrics: Partial<BriefMetrics>;
  doingRight: BriefPoint[];
  /** Schema 1.0 shape, kept so older payloads keep working. */
  opportunities: BriefPoint[];
  /** Schema 1.1 shape. Empty on 1.0 payloads. */
  opportunityPoints: BriefOpportunity[];
  objections: BriefPoint[];
  coachingActions: BriefPoint[];
}

/** One piece of evidence: the exact interaction backing a coaching point. */
export interface BriefFinding {
  findingIndex: number;
  /**
   * Durable identity across overlapping daily reports (schema 1.1).
   *
   * findingIndex is only meaningful inside one report; a rolling seven-day
   * window re-sends the same call every day with a different index. This is
   * what makes "the same finding, again" recognisable — and therefore what
   * stops a week of reports counting one call as seven occurrences.
   */
  findingId?: string;
  agentName: string;
  leadName?: string;
  leadUrl?: string;
  occurredAt?: string;
  channel?: string;
  quote?: string;
}

export interface BriefRun {
  runId: string;
  trigger: string;          // 'weekly' publishes; anything else is stored only
  teamId: string;           // the laptop's team slug, e.g. 'costigan'
  teamName?: string;
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  generatedAt?: string;
  status?: string;
}

export interface CoachBrief {
  schemaVersion: string;
  run: BriefRun;
  agents: BriefAgent[];
  findings: BriefFinding[];
}

// ── Validation ──────────────────────────────────────────────────────────────
// Coerce generously (a point may arrive as a plain string), reject clearly.
// A rejected payload must 4xx so the laptop's retry loop doesn't spin on it.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AGENTS = 200;
const MAX_FINDINGS = 5000;
const MAX_POINTS_PER_LIST = 100;

type Raw = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function asCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/** A point may be a string or an object; index lists may be absent. */
function coercePoint(v: unknown): BriefPoint | null {
  if (typeof v === 'string') {
    const text = v.trim();
    return text ? { text, findingIndexes: [] } : null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Raw;
  const text = asString(o.text) ?? asString(o.detail) ?? asString(o.title) ?? asString(o.summary);
  if (!text) return null;
  const idxRaw = Array.isArray(o.findingIndexes) ? o.findingIndexes
    : Array.isArray(o.findings) ? o.findings : [];
  const findingIndexes = idxRaw
    .map((n) => asCount(n))
    .filter((n): n is number => n !== undefined);
  const point: BriefPoint = { text, findingIndexes };
  const coach = asString(o.coach) ?? asString(o.coachLine) ?? asString(o.coaching);
  if (coach) point.coach = coach;
  return point;
}

function coercePoints(v: unknown): BriefPoint[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_POINTS_PER_LIST)
    .map(coercePoint)
    .filter((p): p is BriefPoint => p !== null);
}

/** Schema 1.1 opportunities. Anything without an explanation is not one. */
function coerceOpportunities(v: unknown): BriefOpportunity[] {
  if (!Array.isArray(v)) return [];
  const out: BriefOpportunity[] = [];
  for (const raw of v.slice(0, MAX_POINTS_PER_LIST)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Raw;
    const explanation = asString(o.explanation);
    // No explanation means this is a 1.0 point, handled by coercePoints.
    if (!explanation) continue;
    const ids = (Array.isArray(o.findingIds) ? o.findingIds : [])
      .map((x) => asString(x))
      .filter((x): x is string => !!x);
    const entry: BriefOpportunity = { findingIds: ids, explanation };
    const idx = asCount(o.findingIndex);
    if (idx !== undefined) entry.findingIndex = idx;
    const pk = asString(o.patternKey);
    if (pk) entry.patternKey = pk;
    const move = asString(o.coachingMove);
    if (move) entry.coachingMove = move;
    // Schema 1.2 evidence fields. `unknown` is a legitimate value for
    // isFirstContact — the contract forbids guessing the timeline.
    if (o.isFirstContact === true || o.isFirstContact === false || o.isFirstContact === 'unknown') {
      entry.isFirstContact = o.isFirstContact;
    }
    const sourceQuote = asString(o.sourceQuote);
    if (sourceQuote) entry.sourceQuote = sourceQuote;
    const sourceChannel = asString(o.sourceChannel);
    if (sourceChannel) entry.sourceChannel = sourceChannel;
    const sourceQuality = asString(o.sourceQuality);
    if (sourceQuality) entry.sourceQuality = sourceQuality;
    const duration = asCount(o.durationSeconds);
    if (duration !== undefined) entry.durationSeconds = duration;
    out.push(entry);
  }
  return out;
}

function coerceMetrics(v: unknown): Partial<BriefMetrics> {
  if (!v || typeof v !== 'object') return {};
  const o = v as Raw;
  const out: Partial<BriefMetrics> = {};
  (['reviewedContacts', 'substantiveContacts', 'callFirst', 'textFirst', 'noOutreach', 'unclassified'] as const)
    .forEach((k) => {
      const n = asCount(o[k]);
      if (n !== undefined) out[k] = n;
    });
  return out;
}

export type BriefValidation =
  | { ok: true; brief: CoachBrief }
  | { ok: false; errors: string[] };

export function validateCoachBrief(raw: unknown): BriefValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }
  const o = raw as Raw;
  const runRaw = (o.run && typeof o.run === 'object' ? o.run : {}) as Raw;

  const runId = asString(runRaw.runId);
  if (!runId) errors.push('run.runId is required');
  const teamId = asString(runRaw.teamId);
  if (!teamId) errors.push('run.teamId (the team slug) is required');
  const startDate = asString(runRaw.startDate);
  if (!startDate || !DATE_RE.test(startDate)) errors.push('run.startDate must be YYYY-MM-DD');
  const endDate = asString(runRaw.endDate);
  if (!endDate || !DATE_RE.test(endDate)) errors.push('run.endDate must be YYYY-MM-DD');

  const agentsRaw = Array.isArray(o.agents) ? o.agents : null;
  if (!agentsRaw) errors.push('agents[] is required (may be empty)');
  if (agentsRaw && agentsRaw.length > MAX_AGENTS) errors.push(`agents[] exceeds ${MAX_AGENTS}`);

  const findingsRaw = Array.isArray(o.findings) ? o.findings : [];
  if (findingsRaw.length > MAX_FINDINGS) errors.push(`findings[] exceeds ${MAX_FINDINGS}`);

  const agents: BriefAgent[] = (agentsRaw ?? []).slice(0, MAX_AGENTS).flatMap((a) => {
    if (!a || typeof a !== 'object') return [];
    const ao = a as Raw;
    const agentName = asString(ao.agentName) ?? asString(ao.name);
    if (!agentName) return [];
    return [{
      agentName,
      metrics: coerceMetrics(ao.metrics),
      doingRight: coercePoints(ao.doingRight),
      opportunities: coercePoints(ao.opportunities),
      opportunityPoints: coerceOpportunities(ao.opportunities),
      objections: coercePoints(ao.objections),
      coachingActions: coercePoints(ao.coachingActions),
    }];
  });
  if (agentsRaw && agentsRaw.length > 0 && agents.length === 0) {
    errors.push('agents[] contained no usable entries (each needs agentName)');
  }

  const findings: BriefFinding[] = findingsRaw.slice(0, MAX_FINDINGS).flatMap((f, i) => {
    if (!f || typeof f !== 'object') return [];
    const fo = f as Raw;
    const agentName = asString(fo.agentName);
    if (!agentName) return [];
    const finding: BriefFinding = {
      findingIndex: asCount(fo.findingIndex) ?? i,
      // Durable across the overlapping daily windows; findingIndex is not.
      findingId: asString(fo.findingId),
      agentName,
    };
    const leadName = asString(fo.leadName); if (leadName) finding.leadName = leadName;
    const leadUrl = asString(fo.leadUrl); if (leadUrl) finding.leadUrl = leadUrl;
    const occurredAt = asString(fo.occurredAt); if (occurredAt) finding.occurredAt = occurredAt;
    const channel = asString(fo.channel); if (channel) finding.channel = channel;
    const quote = asString(fo.quote); if (quote) finding.quote = quote;
    return [finding];
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    brief: {
      schemaVersion: asString(o.schemaVersion) ?? '1.0',
      run: {
        runId: runId as string,
        trigger: asString(runRaw.trigger) ?? 'weekly',
        teamId: teamId as string,
        teamName: asString(runRaw.teamName),
        startDate: startDate as string,
        endDate: endDate as string,
        generatedAt: asString(runRaw.generatedAt),
        status: asString(runRaw.status),
      },
      agents,
      findings,
    },
  };
}

// ── Publishing policy ───────────────────────────────────────────────────────
// Scheduled weekly runs publish into the Coach tab; personal on-demand runs are
// stored (same schema) but never shown, per the handoff. A report whose team
// slug isn't mapped yet is held regardless, and publishes when it resolves.

// `daily` joins `weekly` from schema 1.1 - Hermes now runs every morning over a
// rolling seven days rather than once a week. `personal` and `manual` stay
// hidden: those are runs somebody kicked off by hand to look at something, and a
// client's Coach tab is not the place for a scratch pad. That is also the
// deployment gate - a synthetic personal payload must round-trip and stay
// invisible before the unattended schedule is switched on.
const PUBLISHING_TRIGGERS = new Set(['weekly', 'daily']);

export function briefStatusFor(trigger: string, teamResolved: boolean): 'published' | 'held' {
  return PUBLISHING_TRIGGERS.has(trigger) && teamResolved ? 'published' : 'held';
}

/**
 * The universal admin profile carries leads for whoever is covering, so it is
 * never a person to coach. It must produce no agent card, no trend and no
 * unmatched-agent warning - a warning would be a standing false alarm on every
 * report forever.
 */
const IGNORED_AGENTS = new Set(['eric and adam']);

export function isIgnoredAgent(name: string): boolean {
  return IGNORED_AGENTS.has(normalizeAgentName(name));
}

// ── Agent matching ──────────────────────────────────────────────────────────
// By normalized name, only among the named team's agents. An ambiguous or
// unknown name is never guessed — it stays unlinked and is reported back to the
// sender so the mismatch is visible in the laptop's logs.

export function normalizeAgentName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface AgentMatchResult {
  /** agentName → agents.id, only for unambiguous matches. */
  links: Record<string, string>;
  matched: string[];
  unmatched: string[];
  ambiguous: string[];
}

export function matchAgents(
  briefAgentNames: string[],
  roster: Array<{ id: string; name: string }>,
): AgentMatchResult {
  const byNorm = new Map<string, string[]>();
  for (const r of roster) {
    const key = normalizeAgentName(r.name);
    if (!key) continue;
    byNorm.set(key, [...(byNorm.get(key) ?? []), r.id]);
  }
  const links: Record<string, string> = {};
  const matched: string[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const name of briefAgentNames) {
    const ids = byNorm.get(normalizeAgentName(name)) ?? [];
    if (ids.length === 1) {
      links[name] = ids[0];
      matched.push(name);
    } else if (ids.length === 0) {
      unmatched.push(name);
    } else {
      ambiguous.push(name);
    }
  }
  return { links, matched, unmatched, ambiguous };
}

// ── Evidence resolution (rendering) ─────────────────────────────────────────

export function findingsByIndex(brief: CoachBrief): Map<number, BriefFinding> {
  return new Map(brief.findings.map((f) => [f.findingIndex, f]));
}

/** The evidence behind one coaching point, in the report's own order.
 *  The sender sometimes emits the same interaction under several finding
 *  indexes (seen live: one FUB note arriving as three findings), which renders
 *  as the same quote repeated under one point. Two findings that agree on
 *  lead, time and quote ARE the same interaction, so only the first shows. */
/** Evidence keyed by the durable id schema 1.1 attaches to every finding. */
export function findingsById(brief: CoachBrief): Map<string, BriefFinding> {
  const out = new Map<string, BriefFinding>();
  for (const f of brief.findings) if (f.findingId) out.set(f.findingId, f);
  return out;
}

/**
 * A schema 1.1 opportunity in the shape the display already knows how to draw.
 *
 * 1.1 replaced the free-text `text` with a pair — `explanation` (what happened)
 * and `coachingMove` (what to do instead) — and pointed at its evidence by
 * durable id rather than by position in the list. The reading side had no path
 * for either, so every one of these arrived and rendered as nothing at all.
 *
 * Evidence resolves by id first, because that survives a report being resent
 * with its findings in a different order; `findingIndex` is the fallback for a
 * sender that omitted the ids.
 */
export function opportunityAsPoint(
  o: BriefOpportunity,
  byIndex: Map<number, BriefFinding>,
  byId: Map<string, BriefFinding>,
): { text: string; coach: string | null; evidence: BriefFinding[] } {
  const seen = new Set<string>();
  const evidence: BriefFinding[] = [];
  const take = (f: BriefFinding | undefined) => {
    if (!f) return;
    const key = `${f.leadName ?? ''} ${f.occurredAt ?? ''} ${f.quote ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push(f);
  };
  for (const id of o.findingIds) take(byId.get(id));
  if (!evidence.length && o.findingIndex !== undefined) take(byIndex.get(o.findingIndex));
  return { text: o.explanation, coach: o.coachingMove ?? null, evidence };
}

export function pointEvidence(point: BriefPoint, byIndex: Map<number, BriefFinding>): BriefFinding[] {
  const seen = new Set<string>();
  const out: BriefFinding[] = [];
  for (const i of point.findingIndexes) {
    const f = byIndex.get(i);
    if (!f) continue;
    const key = `${f.leadName ?? ''} ${f.occurredAt ?? ''} ${f.quote ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** What kind of interaction this evidence is, in words a leader reads at a
 *  glance — "call" alone did not read as a phone call in live use. Unknown
 *  channels pass through capitalized rather than hidden. */
export function channelLabel(channel: string | undefined): string | null {
  if (!channel) return null;
  const c = channel.trim().toLowerCase();
  const KNOWN: Record<string, string> = {
    call: 'Phone call',
    text: 'Text message',
    sms: 'Text message',
    note: 'FUB note',
    email: 'Email',
    voicemail: 'Voicemail',
  };
  if (KNOWN[c]) return KNOWN[c];
  const t = channel.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/** Eric's rule: a blank section means "not enough reviewed", never a failure.
 *  Rendering must show this line rather than an empty box. */
export const NOT_ENOUGH_REVIEWED = 'Not enough reviewed this week';
