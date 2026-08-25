// "What to do with this agent" — the leader's move, built from the habit store.
//
// The report's per-call moves ("Ask Ashley to choose between two specific
// times") tell the AGENT what to do with one lead, and yesterday's version of
// this lane showed their headline fragments, which read as noise. What a
// leader wants from this lane is Eric's sentence, verbatim from his ask:
// "Sit down with Joseph this week, coach him on the value of being specific
// when setting meeting times" — the habit, not the incident, backed by how
// often the long-term record says it happened.
//
// So this lane reads the ninety-day pattern store, not the morning's report:
// one directive per habit, worst first, with the latest concrete drill as the
// sub-line and the actual conversations as evidence.
import type { BriefFinding } from '../../../shared/coachBrief';
import { claimSupport, recordShows } from '../../../shared/claimCheck';

export interface AgentPattern {
  agentId: string | null;
  agentName: string;
  patternKey: string;
  explanation: string | null;
  coachingMove: string | null;
  firstSeen: string | null;
  latestEvidence: string | null;
  occurrences: number;
  thisWindow: number;
  current: boolean;
  recurring: boolean;
  findings: Array<{
    lead_name: string | null;
    channel: string | null;
    occurred_at: string | null;
    quote: string | null;
  }>;
}

export interface PatternsBundle {
  window: { start: string; end: string } | null;
  patterns: AgentPattern[];
}

/**
 * Each coaching category as the SUBJECT of a sit-down, finishing the sentence
 * "coach them on…".
 *
 * THESE ARE NOT WORDING CHOICES. `lead_l/e/a/d` are the four steps of LEAD,
 * TRU's own first-call framework; the rest map to named failures in
 * docs/SALES_DOCTRINE.md. An earlier version of this table was written by
 * guessing what the keys meant, went to production, and told agents the
 * opposite of what TRU teaches — "being specific when setting meeting times"
 * for `lead_e`, when E is extending the invitation EARLY in the call. Read the
 * doctrine before touching a line here.
 *
 * An unknown key falls back to its own words rather than being dropped —
 * Hermes owns the taxonomy and can add to it.
 */
export const COACH_ON: Record<string, string> = {
  // The four LEAD steps, in TRU's own words. See docs/SALES_DOCTRINE.md §2.
  lead_l: 'leading with who they are — name, brokerage, Zillow partner, why they called',
  lead_e: 'extending the invitation early, with a this-or-that choice',
  lead_a: 'asking permission, then asking real questions and listening',
  lead_d: 'delivering the summary back and confirming what happens next',

  call_first: 'why a call comes before a text, not just that it does',
  call_quality: 'staying on long enough for a conversation to start',
  next_steps: 'why the buyer did not feel safe committing to anything',
  objection: 'working through the hard moment instead of retreating from it',
  text_transition: 'getting to a live conversation before sending details',
  negative_property_pivot: 'telling the truth and then keeping the meeting alive',
  premature_financing: 'leaving money alone until the buyer knows them',
  premature_representation: 'promising only what they can actually deliver',
};

export function coachOn(patternKey: string): string {
  return COACH_ON[patternKey] ?? patternKey.replace(/_/g, ' ').trim();
}

const firstName = (full: string): string => full.trim().split(/\s+/)[0] ?? full;

/** The week's first-touch split, as the report counted it. */
export interface AgentMetrics {
  callFirst?: number;
  textFirst?: number;
  noOutreach?: number;
}

/**
 * The proportion behind the habit, in words.
 *
 * Eric's model directive does not say "texts too much" -- it says "he
 * frequently makes about one phone call attempt on average, and the bulk of
 * his communication is done through text." A rate is what turns an assertion
 * into something a leader can repeat to the agent without arguing about it.
 *
 * Only stated where the numbers actually support it, and only for the habits
 * it speaks to. A rate attached to the wrong finding is worse than none.
 */
export function rateLine(patternKey: string, m: AgentMetrics | undefined): string | null {
  if (!m) return null;
  const calls = m.callFirst ?? 0;
  const texts = m.textFirst ?? 0;
  const touched = calls + texts;
  if (touched < 3) return null;   // too few to describe as a tendency

  if (patternKey === 'call_first' || patternKey === 'text_transition') {
    if (texts > calls) {
      return calls === 0
        ? `Every one of ${touched} first touches this week was a text — not a single call.`
        : `${texts} of ${touched} first touches this week were texts; ${calls} `
          + `${calls === 1 ? 'was a call' : 'were calls'}.`;
    }
    return null;   // they are calling. Do not coach them for it.
  }

  const untouched = m.noOutreach ?? 0;
  if (untouched > 0 && untouched >= Math.max(2, touched * 0.15)) {
    return `${untouched} of ${touched + untouched} new leads got no outreach at all this week.`;
  }
  return null;
}

/**
 * The long-term record, in the sentence — but only once it says something.
 *
 * The store opened on 2026-08-25, so for its first week every pattern's
 * first-seen date is days old and "3 times since Aug 25" reads as noise (Eric,
 * on day one: the date was TODAY). Under a week of history the honest words
 * are "this week"; the date earns its place when it is far enough back to be
 * a record rather than a timestamp.
 */
export function record(p: AgentPattern, now = new Date()): string {
  const n = p.occurrences;
  if (n <= 1) return 'Came up once this week.';
  const seen = p.firstSeen ? new Date(p.firstSeen) : null;
  const days = seen ? (now.getTime() - seen.getTime()) / 86_400_000 : 0;
  if (!seen || days < 7) return `${n} times this week.`;
  const since = seen.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${n} times since ${since}.`;
}

export interface PlanPoint {
  /** The coaching category, as a small label over the card. */
  kicker?: string;
  text: string;
  coach: string | null;
  evidence: BriefFinding[];
  /**
   * The analysis asserted what somebody said, and the only evidence on file is
   * a description of the call. The card shows the record and asks rather than
   * repeating a claim nobody can stand behind.
   */
  unverified?: boolean;
}

/**
 * The directives for one agent, worst habit first.
 *
 * Ranking is the same one the SMS brief uses: a recurring habit outranks a
 * one-off, more occurrences outrank fewer, and the key breaks ties so a
 * re-render cannot reorder the list. Only current patterns qualify — a habit
 * whose evidence has all aged out belongs in the trend area, not in this
 * week's sit-down list.
 */
export function buildAgentPlan(
  all: AgentPattern[],
  agentId: string,
  agentName: string,
  metrics?: AgentMetrics,
): PlanPoint[] {
  const wanted = agentName.trim().toLowerCase();
  const mine = all.filter((p) =>
    p.current
    && (p.agentId === agentId || p.agentName.trim().toLowerCase() === wanted));

  mine.sort((a, b) =>
    Number(b.recurring) - Number(a.recurring)
    || b.occurrences - a.occurrences
    || a.patternKey.localeCompare(b.patternKey));

  return mine.map((p, i) => {
    const quotes = p.findings.map((f) => f.quote);
    const evidence = p.findings
      .filter((f) => f.quote)
      .map((f, j) => ({
        findingIndex: i * 100 + j,
        agentName: p.agentName,
        leadName: f.lead_name ?? undefined,
        occurredAt: f.occurred_at ?? undefined,
        channel: f.channel ?? undefined,
        quote: f.quote ?? undefined,
      } as BriefFinding));
    const who = firstName(p.agentName);

    // THE INTEGRITY GATE. If the analysis asserted what somebody said and the
    // only evidence on file is a description of the call, the claim does not
    // get repeated. Live example this was written for: "He told Bishoy Yacoub
    // a completely blank seller disclosure was not a red flag" -- backed by a
    // 79-second call whose stored evidence reads only "The agent is working on
    // an offer for a condo. The seller's disclosure is completely blank."
    //
    // A broker who repeats a fabricated quote to their own agent stops
    // trusting every other row on this page, permanently. So the card shows
    // what the record shows, says plainly that the words are not on file, and
    // sends them to ask.
    if (claimSupport(p.explanation, quotes) === 'unsupported') {
      const shows = recordShows(quotes);
      return {
        kicker: coachOn(p.patternKey),
        unverified: true,
        text: shows
          ? `The record shows: ${shows} This call was not transcribed, so what `
            + `${who} actually said is not on file. Worth asking ${who} how they `
            + `handled it before treating it as a coaching point.`
          : `Something was flagged for ${who} here, but the call was not `
            + `transcribed and nothing on file shows what was said. Worth asking `
            + `${who} directly rather than acting on this.`,
        coach: null,
        evidence,
      };
    }

    return {
      // The directive leads with WHAT HAPPENED, in the analysis's own specific
      // words, because the category version alone reads as vague. The category
      // names the card via `kicker`, so the lane stays scannable.
      kicker: coachOn(p.patternKey),
      // Built in the order Eric's model directive uses: what we noticed, how
      // often or how widely, then the sit-down and what it is ABOUT -- the why,
      // not the instruction. See docs/SALES_DOCTRINE.md section 6a.
      // "them", not a guessed pronoun: the roster does not record pronouns.
      text: [
        p.explanation ? p.explanation.trim().replace(/[.\s]+$/, '') + '.' : null,
        rateLine(p.patternKey, metrics),
        record(p),
        `Worth sitting down with ${who} this week to talk through `
          + `${coachOn(p.patternKey)} — and why it matters, not just that we ask for it.`,
      ].filter(Boolean).join(' '),
      coach: p.coachingMove,
      evidence,
    };
  });
}
