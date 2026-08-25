// Turning a stream of daily snapshots into a memory of what each agent keeps doing.
//
// Hermes sends a report a day. Each is a snapshot — here is what these calls
// showed — and a snapshot cannot answer either question a team leader actually
// has: is this a habit, and didn't we already deal with this?
//
// This module answers both, by collapsing the reports into issues.
//
// ── The distinction everything rests on ─────────────────────────────────────
//
// The analysis writes two very different kinds of point under one heading:
//
//   BEHAVIOURAL   "Call first on late leads"
//                 "Stop handing check-ins back to the client"
//                 "Six-second calls"
//                 A habit. It is about how they work, it will recur, and it is
//                 worth a conversation.
//
//   INCIDENTAL    "Christina Marini August 18 call"
//                 "Log the Mezher appointment"
//                 "Leann voicemail"
//                 One buyer, one moment. Real, but it is a to-do, not a
//                 pattern, and putting it in a daily brief as though it were a
//                 pattern is exactly the "Patricia Chatman said she was still
//                 deciding" problem — a fact with no instruction in it.
//
// Only behavioural points become issues. The test is what survives having the
// proper nouns and dates stripped out: take the names off "Christina Marini
// August 18 call" and you have "call", which says nothing. Take them off "Call
// first on late leads" and it is unchanged, because the behaviour was the whole
// sentence.
//
// This is a heuristic and it will be wrong at the edges. It is deliberately a
// legible one — a rule you can read, disagree with, and fix — rather than an
// opaque call to a model on every report. When it needs to be better, the
// upgrade is to have the model cluster points across ninety days, and the shape
// here does not have to change for that.

/** Words that carry no behaviour on their own once names are stripped. */
const EMPTY_AFTER_STRIP = new Set([
  'call', 'calls', 'note', 'notes', 'voicemail', 'text', 'texts', 'follow',
  'followup', 'follow-up', 'appointment', 'meeting', 'time', 'times', 'lag',
  'alert', 'conversation', 'showing', 'visit',
]);

/**
 * Words that legitimately START a coaching point without being somebody's name.
 *
 * This exists because "Close with times" and "Leann voicemail" are the same
 * shape — capitalised word, lowercase word — and only meaning separates them.
 * A maintained list is the honest way to do that: you can read it, disagree
 * with it, and add to it. The alternative is a model call on every point of
 * every report to decide whether a word is a verb, which costs more and
 * explains less.
 *
 * Everything here came off the reports Hermes actually sends.
 */
const LEADING_KEEP = new Set([
  'call', 'book', 'stop', 'close', 'lock', 'log', 'review', 'ask', 'handle',
  'set', 'offer', 'open', 'confirm', 'catch', 'pivot', 'own', 'restart',
  'recover', 'hold', 'stay', 'do', 'send', 'text', 'follow', 'move', 'keep',
  'avoid', 'give', 'make', 'take', 'write', 'check', 'schedule', 'lead',
  'answer', 'return', 'update', 'push', 'start', 'use', 'get', 'end', 'begin',
  'same', 'six', 'period', 'no', 'never', 'always', 'stopped', 'missing',
]);

const DATE_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
const NUM_DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;

/**
 * Strip the parts of a point that are about WHO and WHEN rather than WHAT.
 *
 * Take the names and dates off "Christina Marini August 18 call" and you have
 * "call", which instructs nobody. Take them off "Call first on late leads" and
 * it is untouched, because the behaviour was the whole sentence. That gap is
 * the entire test.
 */
export function stripSpecifics(s: string): string {
  let out = s.replace(DATE_RE, ' ').replace(NUM_DATE_RE, ' ');
  // Possessives first, before they read as bare proper nouns.
  out = out.replace(/\b[A-Z][a-z]+'s\b/g, ' ');
  // A single capital letter with a dot is an initial: "Tina L." -> drop both.
  out = out.replace(/\b[A-Z]\.\s*/g, ' ');

  const words = out.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = w.replace(/[^A-Za-z-]/g, '');
    const isCapitalised = /^[A-Z][a-z]/.test(bare);
    if (!isCapitalised) { kept.push(w); continue; }
    // The first word gets the benefit of the doubt only if it is a word that
    // starts an instruction. Otherwise a leading capital is a name, which is
    // exactly the case the old sentence-case exception let through.
    const head = bare.toLowerCase().split('-')[0];
    if (i === 0 && LEADING_KEEP.has(head)) { kept.push(w); continue; }
    // Anywhere else, a capitalised word is a person, a place or a brand.
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'in', 'at', 'to', 'of', 'for', 'and', 'or', 'with',
  'before', 'after', 'every', 'his', 'her', 'their', 'this', 'that',
]);

/** The content words left once names, dates and filler are gone. */
export function behaviourWords(s: string): string[] {
  return stripSpecifics(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

/** Did stripping actually remove a name, a place or a date? */
export function namedSomeone(point: string): boolean {
  return stripSpecifics(point).length < point.trim().length;
}

/**
 * Is this point about a habit, or about one buyer on one day?
 *
 * Two rules, and the second is the one that earns its keep.
 *
 * First: if nothing survives the strip but bare event nouns — "call",
 * "voicemail", "appointment" — there is no behaviour in it at all.
 *
 * Second: **a point that names somebody and then says almost nothing else is
 * about that person, not about how the agent works.** That is what separates
 * "Log the Mezher appointment" from "Close with times". Structurally they are
 * identical — a verb and an event noun — and only the presence of a name tells
 * you which one is a habit. Take the name out of the first and nothing is left
 * to coach; the second never had one because it was never about one buyer.
 */
export function isBehavioural(point: string): boolean {
  const words = behaviourWords(point);
  if (words.length === 0) return false;
  if (words.length === 1) return !EMPTY_AFTER_STRIP.has(words[0]);
  // Two words that are BOTH bare event nouns ("showing time", "follow-up lag")
  // still describe nothing anyone can change.
  if (words.length === 2 && words.every((w) => EMPTY_AFTER_STRIP.has(w))) return false;
  // A name was removed, and what is left is a verb plus an event noun. The
  // sentence was carrying that person, not a practice.
  if (namedSomeone(point) && words.length <= 2
    && words.slice(1).every((w) => EMPTY_AFTER_STRIP.has(w))) return false;
  return true;
}

/**
 * A stable identity for "the same issue", so tomorrow's slightly different
 * wording lands on the same row rather than starting a second one.
 *
 * Built from the sorted content words, which makes "Call first on late leads"
 * and "Call first on flagged leads" distinct — deliberately. They are close but
 * not the same, and merging them would let the brief claim a bigger pattern
 * than the evidence supports. Over-merging is the more expensive mistake here:
 * it puts a number in front of a team leader that they cannot verify.
 */
export function issueKey(point: string): string {
  return behaviourWords(point).sort().join('-').slice(0, 80);
}

/**
 * How the brief says it. The analysis already writes these as short imperatives,
 * so this mostly leaves them alone — it only trims the trailing full stop and
 * caps the length a text can carry.
 */
export function issueTitle(point: string): string {
  const t = point.trim().replace(/[.\s]+$/, '');
  return t.length <= 60 ? t : `${t.slice(0, 57).trimEnd()}...`;
}

// ── Extracting issues from one report ───────────────────────────────────────

export interface ReportPoint {
  text?: string;
  findingIndexes?: number[];
}
export interface ReportFinding {
  agentName?: string;
  leadName?: string;
  occurredAt?: string;
}
export interface ReportAgent {
  agentName?: string;
  coachingActions?: Array<ReportPoint | string>;
  objections?: Array<ReportPoint | string>;
}

export interface ExtractedIssue {
  agentName: string;
  issueKey: string;
  title: string;
  sourceKind: 'coachingAction' | 'objection';
  /** Distinct buyers this was seen with in THIS report. */
  leads: string[];
  /** Latest call this point points at, which is what dates the evidence. */
  latestOccurredAt: string | null;
}

const asPoint = (p: ReportPoint | string): ReportPoint =>
  typeof p === 'string' ? { text: p } : p;

/**
 * Pull the behavioural issues out of one report.
 *
 * Leads are collected rather than counted because "three different buyers" is a
 * far stronger thing to put to an agent than "three times", and because the
 * dates on those findings are what later prove a behaviour continued AFTER a
 * conversation rather than merely being reported again.
 */
export function extractIssues(payload: {
  agents?: ReportAgent[];
  findings?: ReportFinding[];
}): ExtractedIssue[] {
  const findings = payload.findings ?? [];
  const out = new Map<string, ExtractedIssue>();

  for (const agent of payload.agents ?? []) {
    const agentName = (agent.agentName ?? '').trim();
    if (!agentName) continue;

    const sources: Array<[ExtractedIssue['sourceKind'], Array<ReportPoint | string>]> = [
      ['coachingAction', agent.coachingActions ?? []],
      ['objection', agent.objections ?? []],
    ];

    for (const [sourceKind, points] of sources) {
      for (const raw of points) {
        const p = asPoint(raw);
        const text = (p.text ?? '').trim();
        if (!text || !isBehavioural(text)) continue;

        const key = issueKey(text);
        if (!key) continue;
        const mapKey = `${agentName}::${key}`;

        const leads = new Set(out.get(mapKey)?.leads ?? []);
        let latest = out.get(mapKey)?.latestOccurredAt ?? null;
        for (const i of p.findingIndexes ?? []) {
          const f = findings[i];
          if (!f) continue;
          if (f.leadName) leads.add(f.leadName);
          if (f.occurredAt && (!latest || f.occurredAt > latest)) latest = f.occurredAt;
        }

        out.set(mapKey, {
          agentName,
          issueKey: key,
          title: out.get(mapKey)?.title ?? issueTitle(text),
          sourceKind,
          leads: [...leads],
          latestOccurredAt: latest,
        });
      }
    }
  }
  return [...out.values()];
}

// ── Deciding what an incoming issue does to a stored one ────────────────────

export interface StoredIssue {
  id?: string;
  status: 'open' | 'raised' | 'contacted' | 'recurring' | 'resolved';
  times_seen: number;
  distinct_leads: number;
  occurrences: Array<{ reportDate: string; leads: string[]; n: number }>;
  last_raised_at: string | null;
  raised_count: number;
}

export interface MergeResult {
  status: StoredIssue['status'];
  times_seen: number;
  distinct_leads: number;
  occurrences: StoredIssue['occurrences'];
  /** True when this sighting is fresh evidence after a conversation. */
  recurredAfterRaise: boolean;
  /** True when nothing changed, so nothing should be written. */
  duplicate: boolean;
}

/**
 * Fold one report's sighting into what we already knew.
 *
 * The rule that matters: an issue that has been RAISED stays silent, and the
 * only thing that wakes it is evidence from a call that happened AFTER the
 * conversation. Not a clock, and not the same old calls being described again
 * in tomorrow's report — which they will be, because a rolling window re-reports
 * the same week every day. Confusing those two would make the brief cry wolf
 * every morning about something already dealt with, which is precisely the
 * failure that makes people stop reading it.
 */
export function mergeSighting(
  stored: StoredIssue | null,
  sighting: { reportDate: string; leads: string[]; latestOccurredAt: string | null },
): MergeResult {
  const occ = stored?.occurrences ?? [];
  const already = occ.find((o) => o.reportDate === sighting.reportDate);

  // The same report seen twice is not new evidence. Ingest is retried freely
  // (run_id makes the write idempotent upstream), so this has to be safe.
  if (already && already.leads.join('|') === sighting.leads.join('|')) {
    return {
      status: stored?.status ?? 'open',
      times_seen: stored?.times_seen ?? 0,
      distinct_leads: stored?.distinct_leads ?? 0,
      occurrences: occ,
      recurredAfterRaise: false,
      duplicate: true,
    };
  }

  const occurrences = [
    ...occ.filter((o) => o.reportDate !== sighting.reportDate),
    { reportDate: sighting.reportDate, leads: sighting.leads, n: sighting.leads.length },
  ].sort((a, b) => a.reportDate.localeCompare(b.reportDate));

  const allLeads = new Set(occurrences.flatMap((o) => o.leads));
  const times_seen = occurrences.length;

  // Fresh evidence is a call dated after the conversation happened. Without a
  // date on the call we cannot tell, and we say no — silence is the safer error
  // when the alternative is telling a leader someone ignored them.
  const raisedAt = stored?.last_raised_at ?? null;
  const recurredAfterRaise = !!raisedAt
    && !!sighting.latestOccurredAt
    && sighting.latestOccurredAt > raisedAt;

  let status: StoredIssue['status'] = stored?.status ?? 'open';
  if (status === 'resolved') status = 'open';           // it came back
  if (recurredAfterRaise) status = 'recurring';

  return {
    status,
    times_seen,
    distinct_leads: allLeads.size,
    occurrences,
    recurredAfterRaise,
    duplicate: false,
  };
}

/**
 * Is this worth a team leader's morning?
 *
 * Two buyers, not one — a habit needs more than a single instance, and one
 * instance is the to-do the app already carries. Anything already raised stays
 * out unless it recurred, which is the suppression rule made concrete.
 */
export function worthRaising(i: {
  status: StoredIssue['status']; distinct_leads: number;
}): boolean {
  if (i.status === 'resolved' || i.status === 'contacted') return false;
  if (i.status === 'raised') return false;             // silenced until it recurs
  if (i.status === 'recurring') return true;           // always worth saying
  return i.distinct_leads >= 2;
}
