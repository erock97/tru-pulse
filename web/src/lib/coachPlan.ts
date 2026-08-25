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
 * "coach them on…". The same taxonomy has a habit-shaped label in the SMS
 * brief ("no time set to talk again"); this is the coaching-conversation shape
 * of the same idea. An unknown key falls back to its own words rather than
 * being dropped — Hermes owns the taxonomy and can add to it.
 */
export const COACH_ON: Record<string, string> = {
  lead_e: 'being specific when setting meeting times',
  lead_a: 'asking the questions that surface motivation and timing',
  lead_l: 'opening every call with who they are',
  lead_d: 'ending with the plan restated and a follow-up time',
  call_first: 'calling before texting when a buyer wants to talk',
  call_quality: 'staying on the line long enough to start a real conversation',
  next_steps: 'asking for a next step before the conversation ends',
  objection: 'working an objection instead of letting it end the thread',
  text_transition: 'talking to a lead before sending property details',
  negative_property_pivot: 'following bad news with what is still possible',
  premature_financing: 'holding financing talk until the goals are clear',
  premature_representation: 'promising only what they can actually deliver',
};

export function coachOn(patternKey: string): string {
  return COACH_ON[patternKey] ?? patternKey.replace(/_/g, ' ').trim();
}

const firstName = (full: string): string => full.trim().split(/\s+/)[0] ?? full;

/** "3 times since Aug 18" — the long-term record, in the sentence. */
function record(p: AgentPattern): string {
  const n = p.occurrences;
  const since = p.firstSeen
    ? new Date(p.firstSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  if (n <= 1) return 'Came up once this week.';
  return since ? `${n} times since ${since}.` : `${n} times on record.`;
}

export interface PlanPoint {
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
export function buildAgentPlan(all: AgentPattern[], agentId: string, agentName: string): PlanPoint[] {
  const wanted = agentName.trim().toLowerCase();
  const mine = all.filter((p) =>
    p.current
    && (p.agentId === agentId || p.agentName.trim().toLowerCase() === wanted));

  mine.sort((a, b) =>
    Number(b.recurring) - Number(a.recurring)
    || b.occurrences - a.occurrences
    || a.patternKey.localeCompare(b.patternKey));

  return mine.map((p, i) => ({
    // "them", not a guessed pronoun: the roster does not record pronouns, and
    // a wrong guess in a coaching directive lands in front of the person.
    text: `Sit down with ${firstName(p.agentName)} this week — coach them on ${coachOn(p.patternKey)}. ${record(p)}`,
    coach: p.coachingMove,
    evidence: p.findings
      .filter((f) => f.quote)
      .map((f, j) => ({
        findingIndex: i * 100 + j,
        agentName: p.agentName,
        leadName: f.lead_name ?? undefined,
        occurredAt: f.occurred_at ?? undefined,
        channel: f.channel ?? undefined,
        quote: f.quote ?? undefined,
      } as BriefFinding)),
  }));
}
