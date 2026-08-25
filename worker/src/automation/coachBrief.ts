// The daily brief a broker actually reads: what do I need to do today.
//
// Built from the Coach analysis — Hermes scrapes the conversations, a local
// model reads them, Grok analyses them, and the result arrives through
// /coach/weekly-report. That is the material. Lead counts are NOT: those already
// go out to agents by text and to brokers by email, so putting them in front of
// a broker again is asking them to read the same thing twice.
//
// It reads the STORED PATTERNS, not the morning's report. That distinction is
// the whole design:
//
//   The report covers a rolling seven days, so the same conversation arrives
//   seven mornings running. Rendered straight from the report, a brief would
//   name the same three agents all week for the same reasons — and a channel
//   that repeats itself is a channel people stop opening.
//
//   The store already collapses repeated evidence to one occurrence, and now
//   remembers what it has already said. So this names a habit when it is new
//   or when it has genuinely happened again, and stays quiet otherwise.
//
// What a broker gets is an agent, the habit, and how often it happened this
// week. Not a buyer's objection — that is the lead's status rather than the
// agent's behaviour, and it does not tell anybody who to go and talk to.
//
// It has to fit in a text message, which is the hard part: the analysis is rich
// and a text is 160 characters a segment. So this compresses hard and lets the
// app carry the rest — the exact wording, the quote, and everyone past the
// third name.

import { isGsm7, segments, toGsm7 } from './morningBrief.js';
import type { Db } from '../db.js';

/** One stored habit, as `coach_patterns_live` holds it. */
export interface BriefPattern {
  agentName: string;
  patternKey: string;
  /** The analysis's own wording. Display in the app; too long for a text. */
  explanation?: string | null;
  /** Distinct occurrences inside the analysis window. */
  thisWeek: number;
  recurring?: boolean;
}

export interface PatternBriefInput {
  teamName: string;
  dateLabel: string;
  /** Already filtered: agents only, current, and not already said. */
  patterns: BriefPattern[];
  appUrl?: string;
}

/**
 * The coaching categories in a broker's words.
 *
 * The analysis writes a sentence per instance — "Her text to Nick McQuinn asked
 * permission to send listings instead of giving him a chance to pick a specific
 * time to meet." True, useful in the app, and three of those is the entire text
 * message. These are the same thought at the length a text can carry.
 *
 * An unknown key falls back to its own words rather than being dropped. Hermes
 * owns this taxonomy and can add to it; a brief that silently omits a whole
 * category because we had not heard of it yet is the worse failure.
 */
export const PATTERN_LABEL: Record<string, string> = {
  lead_l: 'not saying who they are on the call',
  lead_e: 'no time set to talk again',
  lead_a: 'not asking what would move it forward',
  lead_d: 'ending without restating the plan',
  call_first: 'texting when the buyer asked for a call',
  call_quality: 'calls ending before a conversation starts',
  next_steps: 'no next step asked for',
  objection: 'letting an objection end the conversation',
  text_transition: 'sending details before talking to them',
  negative_property_pivot: 'leaving it at the bad news',
  premature_financing: 'raising financing before asking what they need',
  premature_representation: 'promising what they can only ask for',
};

export function labelFor(patternKey: string): string {
  return PATTERN_LABEL[patternKey] ?? toGsm7(patternKey).replace(/_/g, ' ').trim();
}

/** First name only. In a text, "Cara" is unambiguous and "Cara B." is not shorter. */
export function firstName(full: string): string {
  return toGsm7(full).trim().split(/\s+/)[0] ?? '';
}

/**
 * The shortest form of a habit that a broker can still act on.
 *
 * Cutting at the first joining word keeps the subject and the event, which is
 * the part a broker needs to know a conversation is owed. The rest is in the app
 * and this is not trying to replace it.
 */
export function tighten(s: string, max = 78): string {
  let out = toGsm7(s).replace(/\s+/g, ' ').trim();
  out = out.replace(/^(.{18,}?)(,? and | but | then | while | unless | because ).*/i, '$1');
  out = out.replace(/[.\s]+$/, '');
  if (out.length > max) {
    const cut = out.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    out = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '...';
  }
  return out;
}

export interface TeamLine {
  line: string | null;
  patternKey: string | null;
  agents: number;
}

/**
 * What the team is doing, as opposed to what one agent is doing.
 *
 * Only stated when enough of the team shares one habit that it is a training
 * subject rather than a conversation. Three agents is the floor: two people
 * doing the same thing is a coincidence a broker handles by talking to both,
 * and calling that a team pattern devalues the phrase for the week it matters.
 */
export function teamLine(patterns: BriefPattern[]): TeamLine {
  const byKey = new Map<string, Set<string>>();
  for (const p of patterns) {
    if (!byKey.has(p.patternKey)) byKey.set(p.patternKey, new Set());
    byKey.get(p.patternKey)!.add(p.agentName);
  }
  const roster = new Set(patterns.map((p) => p.agentName)).size;

  let best: { key: string; n: number } | null = null;
  for (const [key, who] of byKey) {
    if (who.size >= 3 && (!best || who.size > best.n)) best = { key, n: who.size };
  }
  if (!best) return { line: null, patternKey: null, agents: 0 };

  return {
    line: `${best.n} of ${roster} agents: ${labelFor(best.key)}.`,
    patternKey: best.key,
    agents: best.n,
  };
}

export interface CoachBriefResult {
  body: string;
  segments: number;
  /** Agents named in the message. The rest are behind the link. */
  named: string[];
  /** Agents with something worth a conversation this morning. */
  needing: number;
}

/** Four segments. Past that a broker is scrolling, not reading. */
const CAP = 612;

/**
 * Worst first.
 *
 * Recurring outranks one-off — a habit is a conversation, a single slip is
 * usually a bad afternoon. Within that, more occurrences this week outranks
 * fewer. The name is the tiebreak, so the order is stable rather than whatever
 * the database happened to return.
 */
export function rankPatterns(patterns: BriefPattern[]): BriefPattern[] {
  return [...patterns].sort((a, b) =>
    Number(!!b.recurring) - Number(!!a.recurring)
    || b.thisWeek - a.thisWeek
    || a.agentName.localeCompare(b.agentName)
    || a.patternKey.localeCompare(b.patternKey));
}

export function renderPatternBrief(input: PatternBriefInput): CoachBriefResult {
  const app = input.appUrl ?? 'app.truhq.co/#/coach';
  const head = `TRU Coach - ${toGsm7(input.teamName)} - ${input.dateLabel}`;
  const ranked = rankPatterns(input.patterns);

  // One line per agent, their worst habit. Naming somebody twice spends a
  // second line saying something the first line already made the broker's job:
  // go and have a conversation with that person.
  const worstPerAgent: BriefPattern[] = [];
  const seenAgent = new Set<string>();
  for (const p of ranked) {
    if (seenAgent.has(p.agentName)) continue;
    seenAgent.add(p.agentName);
    worstPerAgent.push(p);
  }

  const team = teamLine(input.patterns);

  if (!worstPerAgent.length) {
    const body = `${head}\nNothing new in the calls since yesterday.`;
    return { body, segments: segments(body), named: [], needing: 0 };
  }

  // Build up to three agents, then stop. Three is what fits while each still
  // carries its reason; a fourth turns every line into a name and a number,
  // which is the thing this brief exists to not be.
  const named: string[] = [];
  const lines: string[] = [head, ''];
  for (const p of worstPerAgent) {
    if (named.length >= 3) break;
    const count = p.thisWeek > 1 ? `, ${p.thisWeek} this week` : '';
    const line = `${firstName(p.agentName)}: ${tighten(labelFor(p.patternKey), 60)}${count}`;
    const tail = buildTail(worstPerAgent.length - named.length - 1, team.line, app);
    if ([...lines, line, ...tail].join('\n').length > CAP) break;
    lines.push(line);
    named.push(firstName(p.agentName));
  }

  lines.push(...buildTail(worstPerAgent.length - named.length, team.line, app));
  const body = lines.join('\n');
  return { body, segments: segments(body), named, needing: worstPerAgent.length };
}

function buildTail(remaining: number, team: string | null, app: string): string[] {
  const out: string[] = [];
  if (remaining > 0) out.push(`+${remaining} more in the app`);
  if (team) { out.push(''); out.push(team); }
  out.push('');
  out.push(app);
  return out;
}

/** Exported for the test that pins the encoding, and for the preview route. */
export { isGsm7 };

// ── Reading the store ────────────────────────────────────────────────────────

export interface TeamBrief {
  teamId: string;
  team: string;
  analysisWindow: string;
  lastUpdate: string | null;
  /** Everything current for the team, before the already-said filter. */
  currentPatterns: number;
  /** What this brief would speak for. Zero means send nothing. */
  needing: number;
  named: string[];
  chars: number;
  segments: number;
  body: string;
  /** Pattern ids a real send would mark as told. */
  patternIds: string[];
}

/**
 * Build the brief for every team with a stored analysis. Reads only; writes
 * nothing, sends nothing, and — importantly — marks nothing. Looking at what
 * would be sent must not consume it, or opening the preview silences the real
 * send an hour later.
 */
export async function previewCoachBriefs(
  database: Db,
  dateLabel: string,
): Promise<TeamBrief[]> {
  const [rows, teams, roster] = await Promise.all([
    database.select('coach_patterns_live', 'select=*') as Promise<any[]>,
    database.select('teams', 'is_active=eq.true&select=id,name') as Promise<any[]>,
    database.select('agents', 'select=id,role') as Promise<any[]>,
  ]);

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  // Same rule as the Coach view: the broker, their lead and their office staff
  // are analysed but not coached. A brief telling a broker to go and speak to
  // themselves is not one they read twice.
  const notCoachable = new Set(
    roster.filter((a) => a.role && a.role !== 'agent').map((a) => a.id),
  );

  const byTeam = new Map<string, any[]>();
  for (const r of rows) {
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id)!.push(r);
  }

  const out: TeamBrief[] = [];
  for (const [teamId, all] of byTeam) {
    const coachable = all.filter((r) => !r.agent_id || !notCoachable.has(r.agent_id));
    const current = coachable.filter((r) => r.is_current);
    const fresh = current.filter((r) => r.brief_worthy);

    const patterns: BriefPattern[] = fresh.map((r) => ({
      agentName: r.agent_name,
      patternKey: r.pattern_key,
      explanation: r.explanation,
      thisWeek: Number(r.occurrences_this_window ?? 0),
      recurring: !!r.is_recurring,
    }));

    const rendered = renderPatternBrief({
      teamName: teamName.get(teamId) ?? teamId,
      dateLabel,
      patterns,
    });

    const state = all[0];
    out.push({
      teamId,
      team: teamName.get(teamId) ?? teamId,
      analysisWindow: `${state?.window_start ?? '?'} to ${state?.window_end ?? '?'}`,
      lastUpdate: state?.last_update ?? null,
      currentPatterns: current.length,
      needing: rendered.needing,
      named: rendered.named,
      chars: rendered.body.length,
      segments: rendered.segments,
      body: rendered.body,
      // Everything the message spoke for, including the agents folded into
      // "+N more" — those were counted, so repeating them tomorrow would be
      // the same repetition this exists to stop.
      patternIds: fresh.map((r) => r.id as string),
    });
  }
  out.sort((a, b) => a.team.localeCompare(b.team));
  return out;
}

/**
 * Record that a brief said these things. Called only after a message actually
 * left — never from a preview.
 *
 * It stores the evidence count as well as the time, so "has this moved since we
 * last mentioned it" is a comparison of counts. A report redelivering an
 * identical week changes no count, and therefore says nothing.
 */
export async function markBriefed(database: Db, patternIds: string[]): Promise<number> {
  if (!patternIds.length) return 0;
  const now = new Date().toISOString();
  const counts = (await database.select(
    'coach_patterns_live',
    `id=in.(${patternIds.join(',')})&select=id,occurrences`,
  )) as any[];
  for (const row of counts) {
    await database.update('coach_patterns', `id=eq.${row.id}`, {
      last_briefed_at: now,
      briefed_occurrences: Number(row.occurrences ?? 0),
    });
  }
  return counts.length;
}
