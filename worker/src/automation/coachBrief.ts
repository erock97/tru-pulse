// The daily brief a broker actually reads: what do I need to do today.
//
// Built from the Coach analysis — Hermes scrapes the conversations, a local
// model reads them, Grok analyses them, and the result arrives through
// /coach/weekly-report. That is the material. Lead counts are NOT: those already
// go out to agents by text and to brokers by email, so putting them in front of
// a broker again is asking them to read the same thing twice.
//
// Two things go in, and nothing else:
//
//   1. Conversations to have with named agents, and WHY — the why being what the
//      buyer actually said, not a number. "Sadie Fine no-showed and is now
//      saying six months" is something a broker can act on this morning.
//   2. What the week's calls show the whole team doing — a pattern worth
//      raising once rather than four times.
//
// It has to fit in a text message, which is the hard part: the analysis is rich
// and a text is 160 characters a segment. So this compresses hard and lets the
// app carry the rest. Everything here is a judgement about what survives that
// squeeze.

import { isGsm7, segments, toGsm7 } from './morningBrief.js';

/** One agent's slice of the Coach analysis, as Hermes sends it. */
export interface CoachAgent {
  agentName: string;
  metrics?: {
    callFirst?: number;
    textFirst?: number;
    noOutreach?: number;
    reviewedContacts?: number;
    substantiveContacts?: number;
  };
  /** Real situations, in the buyer's own terms. The richest material here. */
  objections?: Array<{ text?: string } | string>;
  /** Terse imperatives the analysis already wrote. Effectively a to-do. */
  coachingActions?: Array<{ text?: string } | string>;
  opportunities?: Array<{ text?: string } | string>;
  doingRight?: Array<{ text?: string } | string>;
}

export interface CoachBriefInput {
  teamName: string;
  dateLabel: string;
  agents: CoachAgent[];
  /** How old the underlying analysis is. A brief must not imply it is fresher. */
  analysisEndDate?: string | null;
  appUrl?: string;
}

const textOf = (p: { text?: string } | string | undefined): string =>
  (typeof p === 'string' ? p : p?.text ?? '').trim();

/** First name only. In a text, "Cara" is unambiguous and "Cara B." is not shorter. */
export function firstName(full: string): string {
  return toGsm7(full).trim().split(/\s+/)[0] ?? '';
}

/**
 * The shortest form of a situation that a broker can still act on.
 *
 * The analysis writes full sentences — "Sadie Fine did not show last week and
 * said the timeline may be about six months unless something great appears."
 * That is 108 characters, and three of them would be the entire text message.
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

export interface TeamPattern {
  line: string | null;
  callFirst: number;
  textFirst: number;
  noOutreach: number;
}

/**
 * What the whole team is doing, from the metrics the analysis already counted.
 *
 * Only stated when it is lopsided enough to be worth a broker's attention. A
 * team split evenly between calling and texting first has no pattern, and
 * saying so every morning is noise that teaches people to stop reading.
 */
export function teamPattern(agents: CoachAgent[]): TeamPattern {
  let callFirst = 0, textFirst = 0, noOutreach = 0;
  for (const a of agents) {
    callFirst += a.metrics?.callFirst ?? 0;
    textFirst += a.metrics?.textFirst ?? 0;
    noOutreach += a.metrics?.noOutreach ?? 0;
  }
  const touched = callFirst + textFirst;
  let line: string | null = null;
  if (noOutreach > 0 && noOutreach >= Math.max(2, touched * 0.15)) {
    line = `${noOutreach} of ${touched + noOutreach} leads got no outreach at all.`;
  } else if (touched >= 6 && textFirst >= touched * 0.7) {
    line = `Team is texting first, not calling - ${textFirst} of ${touched} first touches.`;
  } else if (touched >= 6 && callFirst >= touched * 0.7) {
    line = `Team is calling first on ${callFirst} of ${touched} first touches.`;
  }
  return { line, callFirst, textFirst, noOutreach };
}

export interface CoachBriefResult {
  body: string;
  segments: number;
  /** Agents named in the message. The rest are behind the link. */
  named: string[];
  /** Total agents with something worth a conversation. */
  needing: number;
}

/** Four segments. Past that a broker is scrolling, not reading. */
const CAP = 612;

export function renderCoachBrief(input: CoachBriefInput): CoachBriefResult {
  const app = input.appUrl ?? 'app.truhq.co/#/coach';
  const head = `TRU Coach - ${toGsm7(input.teamName)} - ${input.dateLabel}`;

  // An agent is worth naming when the analysis found a real situation. A
  // coaching action alone is weaker evidence than a buyer objection, so
  // objections lead and actions fill in behind them.
  const candidates = input.agents
    .map((a) => {
      const objections = (a.objections ?? []).map(textOf).filter(Boolean);
      const actions = (a.coachingActions ?? []).map(textOf).filter(Boolean);
      return { name: firstName(a.agentName), objections, actions };
    })
    .filter((a) => a.name && (a.objections.length || a.actions.length))
    .sort((a, b) =>
      b.objections.length - a.objections.length
      || b.actions.length - a.actions.length
      || a.name.localeCompare(b.name));

  const pattern = teamPattern(input.agents);

  if (!candidates.length && !pattern.line) {
    const body = `${head}\nNothing needing you in this week's calls.`;
    return { body, segments: segments(body), named: [], needing: 0 };
  }

  // Build up to three agents, then stop. Three is what fits while each still
  // carries its reason; a fourth turns every line into a name and a number,
  // which is the thing this brief exists to not be.
  const named: string[] = [];
  const lines: string[] = [head, ''];
  for (const c of candidates) {
    if (named.length >= 3) break;
    const why = c.objections[0] ?? c.actions[0];
    const line = `${c.name}: ${tighten(why)}`;
    const trial = [...lines, line];
    const tail = buildTail(candidates.length - named.length - 1, pattern.line, app);
    if ([...trial, ...tail].join('\n').length > CAP) break;
    lines.push(line);
    named.push(c.name);
  }

  lines.push(...buildTail(candidates.length - named.length, pattern.line, app));
  const body = lines.join('\n');
  return { body, segments: segments(body), named, needing: candidates.length };
}

function buildTail(remaining: number, pattern: string | null, app: string): string[] {
  const out: string[] = [];
  if (remaining > 0) out.push(`+${remaining} more in the app`);
  if (pattern) { out.push(''); out.push(pattern); }
  out.push('');
  out.push(app);
  return out;
}

/** Exported for the test that pins the encoding, and for the preview route. */
export { isGsm7 };

// ── Preview, straight off the stored analysis ────────────────────────────────

import type { Db } from '../db.js';

/**
 * Render the daily brief for every team that has an analysis. Reads only;
 * writes nothing and sends nothing.
 *
 * Takes the most recent report per team regardless of status, deliberately: a
 * report sitting `held` because its slug was never set is still the freshest
 * thinking we have about that team, and hiding it from a preview would hide the
 * exact problem you want a preview to show you.
 */
export async function previewCoachBriefs(database: Db, dateLabel: string) {
  const [reports, teams] = await Promise.all([
    database.select('coach_weekly_reports',
      'select=team_slug,team_id,status,received_at,payload&order=received_at.desc&limit=40'),
    database.select('teams', 'is_active=eq.true&select=id,name,report_slug'),
  ]);
  const nameBySlug = new Map((teams as any[]).map((t) => [t.report_slug, t.name]));

  const seen = new Set<string>();
  const out = [];
  for (const r of reports as any[]) {
    if (seen.has(r.team_slug)) continue;
    seen.add(r.team_slug);
    const agents = (r.payload?.agents ?? []) as CoachAgent[];
    if (!agents.length) continue;
    const rendered = renderCoachBrief({
      teamName: nameBySlug.get(r.team_slug) ?? r.team_slug,
      dateLabel,
      agents,
    });
    out.push({
      team: nameBySlug.get(r.team_slug) ?? r.team_slug,
      reportStatus: r.status,
      analysisWindow: `${r.payload?.run?.startDate ?? '?'} to ${r.payload?.run?.endDate ?? '?'}`,
      agentsAnalysed: agents.length,
      needing: rendered.needing,
      named: rendered.named,
      chars: rendered.body.length,
      segments: rendered.segments,
      body: rendered.body,
    });
  }
  return out;
}
