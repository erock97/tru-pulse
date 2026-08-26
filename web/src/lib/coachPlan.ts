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
    /** Deep link to the contact in Follow Up Boss. */
    lead_url?: string | null;
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
  lead_l: 'leading with who they are: name, brokerage, Zillow partner, why they called',
  lead_e: 'asking for a specific time, with a this-or-that choice',
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

  // Tonality — the two flags Eric chose in the 2026-08-26 interview, and only
  // these two. See docs/SALES_DOCTRINE.md, "The reasoning walk-through".
  tone_rushed: 'giving the call real attention instead of hurrying it to a close',
  tone_curt: 'warmth in their texts — a person, not a one-word reply',
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
        ? `Every one of ${touched} first touches this week was a text. Not one call.`
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

const COUNT_WORDS = ['zero', 'once', 'twice', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * The long-term record as a sentence a person would say, naming the contacts.
 *
 * "3 times this week." was Eric's word-for-word example of robotic output. And
 * worse: the story names ONE lead while the proof holds three different ones,
 * so a broker reading about Nick McQuinn opens the proof and meets Tiana
 * Womack and Vincent Walker with no explanation. Naming the contacts in the
 * sentence is what reconciles the two.
 *
 * Once is silence: the story above it already IS the one occurrence, and
 * "came up once" restates it robotically. The date only appears when it is a
 * week or more back; before that it is a timestamp, not a record.
 */
export function record(p: AgentPattern, now = new Date()): string {
  const n = p.occurrences;
  if (n <= 1) return '';
  const seen = p.firstSeen ? new Date(p.firstSeen) : null;
  const days = seen ? (now.getTime() - seen.getTime()) / 86_400_000 : 0;
  const when = (!seen || days < 7)
    ? 'this week'
    : `since ${seen.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const leads = [...new Set(
    p.findings.map((f) => (f.lead_name ?? '').trim()).filter(Boolean),
  )];
  const times = n === 2 ? 'twice' : `${COUNT_WORDS[n] ?? n} separate times`;

  if (leads.length >= 2) {
    const named = leads.slice(0, 3);
    const list = named.length === 2
      ? `${named[0]} and ${named[1]}`
      : `${named.slice(0, -1).join(', ')}, and ${named[named.length - 1]}`;
    const contacts = leads.length === n
      ? `with ${list}`
      : `across ${leads.length} contacts, including ${list}`;
    return `This has come up ${times} ${when}, ${contacts}.`;
  }
  return `This has come up ${times} ${when}.`;
}

export interface PlanPoint {
  /**
   * The coaching category. Rendered as sentence-case body text, never as an
   * uppercase tracked micro-label above every card -- that templated rhythm is
   * the single most recognisable "an AI built this" signature, and Eric named
   * this panel as reading exactly that way.
   */
  kicker?: string;
  text: string;
  coach: string | null;
  evidence: BriefFinding[];
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
/**
 * Is this piece of evidence a voicemail rather than a conversation?
 *
 * Live case: Erica Stevens's ENTIRE coaching profile was two points built on
 * one 61-character note, "Left message offering to help her pick up where she
 * left off." Eric's verdict: there is nothing there to assess an agent on.
 *
 * A voicemail still counts as an attempt for persistence (doctrine 5.1). It
 * cannot support coaching about how a conversation was handled, because no
 * conversation happened.
 */
export function isVoicemail(quote: string | null | undefined): boolean {
  const q = (quote ?? '').trim().toLowerCase();
  if (!q) return false;
  return /^(left (a |another )?(message|vm|voicemail)|voicemail|lvm|left vm)/.test(q);
}

export function buildAgentPlan(
  all: AgentPattern[],
  agentId: string,
  agentName: string,
  metrics?: AgentMetrics,
): PlanPoint[] {
  const wanted = agentName.trim().toLowerCase();
  const mine = all.filter((p) =>
    p.current
    && (p.agentId === agentId || p.agentName.trim().toLowerCase() === wanted)
    // A habit standing entirely on voicemails is not a coachable habit.
    && !(p.findings.length > 0 && p.findings.every((f) => isVoicemail(f.quote))));

  mine.sort((a, b) =>
    Number(b.recurring) - Number(a.recurring)
    || b.occurrences - a.occurrences
    || a.patternKey.localeCompare(b.patternKey));

  return mine.map((p, i) => {
    const evidence = p.findings
      .filter((f) => f.quote)
      .map((f, j) => ({
        findingIndex: i * 100 + j,
        agentName: p.agentName,
        leadName: f.lead_name ?? undefined,
        // The whole point of proof is that a leader can go and look. Follow Up
        // Boss is where they look.
        leadUrl: f.lead_url ?? undefined,
        occurredAt: f.occurred_at ?? undefined,
        channel: f.channel ?? undefined,
        quote: f.quote ?? undefined,
      } as BriefFinding));
    const who = firstName(p.agentName);

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
          + `${coachOn(p.patternKey)}, and why it matters rather than just that we ask for it.`,
      ].filter(Boolean).join(' '),
      coach: p.coachingMove,
      evidence,
    };
  });
}
