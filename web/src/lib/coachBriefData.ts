// The weekly coaching brief — loading and view-shaping for the Coach tab.
//
// The report itself is produced OFF this system (the Hermes automation reviews a
// team's Follow Up Boss activity weekly) and lands in coach_weekly_reports via the
// Worker's ingest endpoint. This module only reads what's published: RLS on the
// table already hides held rows and personal on-demand runs, so everything that
// arrives here is safe to show.
import { isDemo, workerFetch } from './api';
import {
  channelLabel,
  findingsByIndex,
  findingsById,
  opportunityAsPoint,
  pointEvidence,
  NOT_ENOUGH_REVIEWED,
} from '../../../shared/coachBrief';
import type {
  BriefAgent,
  BriefFinding,
  BriefMetrics,
  BriefPoint,
  CoachBrief,
} from '../../../shared/coachBrief';

export { channelLabel, NOT_ENOUGH_REVIEWED };
export type { BriefAgent, BriefFinding, BriefPoint };

/** One row of coach_weekly_reports as the data route returns it. */
export interface BriefReportRow {
  id: string;
  team_id: string | null;
  team_slug: string;
  week_start: string;
  week_end: string;
  generated_at: string | null;
  received_at: string;
  payload?: CoachBrief;
  agent_links?: Record<string, string>;
}

/** A point with its evidence resolved, ready to render. */
export interface BriefPointView {
  text: string;
  coach: string | null;
  evidence: BriefFinding[];
}

export interface BriefAgentView {
  agentName: string;
  /** agents.id when the ingest matched this name unambiguously; null otherwise. */
  agentId: string | null;
  metrics: Partial<BriefMetrics>;
  doingRight: BriefPointView[];
  opportunities: BriefPointView[];
  objections: BriefPointView[];
  coachingActions: BriefPointView[];
}

export interface BriefView {
  reportId: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string | null;
  teamName: string | null;
  agents: BriefAgentView[];
}

export interface BriefWeek {
  reportId: string;
  weekStart: string;
  weekEnd: string;
}

export interface BriefBundle {
  latest: BriefView | null;
  weeks: BriefWeek[];
}

/** Exported for the test that pins the shapes older reports were stored in. */
export function toView(row: BriefReportRow): BriefView | null {
  const payload = row.payload;
  if (!payload) return null;
  const safePayload = { ...payload, findings: payload.findings ?? [] };
  const byIndex = findingsByIndex(safePayload);
  const byId = findingsById(safePayload);
  const links = row.agent_links ?? {};
  const point = (p: BriefPoint): BriefPointView => ({
    text: p.text,
    coach: p.coach ?? null,
    evidence: pointEvidence(p, byIndex),
  });

  // Schema 1.1 sends opportunities as {explanation, coachingMove, findingIds}
  // rather than as free text, and the validator files those under
  // `opportunityPoints`. Nothing on this side read that field, so every
  // coaching point in every 1.1 report rendered as "Not enough reviewed this
  // week" while its text sat in the payload untouched. Checked live on
  // 2026-08-25: 266 points across four teams, none of them reaching a screen.
  //
  // The 1.0 list still wins when it has anything, so a mixed or older report
  // renders exactly as it did before.
  //
  // `opportunityPoints` is defaulted rather than assumed. The type says it is
  // always there because the validator always writes it -- but what this
  // function actually receives is a payload STORED at ingest time, and every
  // report from before 1.1 landed was stored without the field. Reading it
  // straight took the whole brief section down when a leader picked an earlier
  // week: one undefined, one throw, and a section that renders nothing at all
  // rather than a week that renders badly.
  const opportunitiesOf = (a: BriefAgent): BriefPointView[] =>
    a.opportunities?.length
      ? a.opportunities.map(point)
      : (a.opportunityPoints ?? []).map((o) => opportunityAsPoint(o, byIndex, byId));
  return {
    reportId: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    generatedAt: row.generated_at,
    teamName: payload.run.teamName ?? null,
    // Every list is defaulted for the same reason: what arrives here is a
    // payload stored by whatever validator was live the day it was ingested,
    // not one built by today's. A field added later is simply absent in every
    // row written before it, and the types cannot see that.
    agents: (payload.agents ?? []).map((a) => ({
      agentName: a.agentName,
      agentId: links[a.agentName] ?? null,
      metrics: a.metrics ?? {},
      doingRight: (a.doingRight ?? []).map(point),
      opportunities: opportunitiesOf(a),
      objections: (a.objections ?? []).map(point),
      coachingActions: (a.coachingActions ?? []).map(point),
    })),
  };
}

/** The latest published brief plus the selectable history of past weeks. */
export async function loadCoachBrief(reportId?: string): Promise<BriefBundle> {
  if (isDemo) return demoBriefBundle();
  const query = reportId ? `?reportId=${encodeURIComponent(reportId)}` : '';
  const res = await workerFetch(`/data/coach/brief${query}`);
  // A team with no reports yet is a normal state, not an error — the Coach tab
  // shows its "no brief yet" line and everything else keeps working.
  if (!res.ok) return { latest: null, weeks: [] };
  const d = (await res.json()) as { reports: BriefReportRow[] | null; report: BriefReportRow | null };
  const weeks = (d.reports ?? []).map((r) => ({
    reportId: r.id, weekStart: r.week_start, weekEnd: r.week_end,
  }));
  return { latest: d.report ? toView(d.report) : null, weeks };
}

/** The brief slice for one agent's drill-in, matched by id first, then by name. */
export function agentBrief(view: BriefView | null, agentId: string, agentName: string): BriefAgentView | null {
  if (!view) return null;
  const byId = view.agents.find((a) => a.agentId === agentId);
  if (byId) return byId;
  const wanted = agentName.trim().toLowerCase();
  return view.agents.find((a) => a.agentName.trim().toLowerCase() === wanted) ?? null;
}

/** "Aug 16 – Aug 22" from the report's date range. */
export function briefRangeLabel(weekStart: string, weekEnd: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    // Local-date construction — new Date('YYYY-MM-DD') parses as UTC and can
    // render the day before in every US timezone.
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

// ── ?demo=1 — a believable brief over the demo roster, no backend ───────────

function demoBriefBundle(): BriefBundle {
  const day = 86400_000;
  const end = new Date(Date.now() - day);
  const start = new Date(end.getTime() - 6 * day);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fub = 'https://app.followupboss.com/2/people/view/';

  const finding = (
    findingIndex: number, agentName: string, leadName: string, personId: number,
    daysAgo: number, channel: string, quote: string,
  ): BriefFinding => ({
    findingIndex, agentName, leadName, leadUrl: fub + personId,
    occurredAt: new Date(Date.now() - daysAgo * day).toISOString(), channel, quote,
  });

  const findings: BriefFinding[] = [
    finding(0, 'Trevor Holland', 'Kelsey Munroe', 4211, 3, 'call',
      'Called four minutes after the Zillow connect and booked the showing on the first call.'),
    finding(1, 'Trevor Holland', 'Devonte Price', 4302, 5, 'call',
      '"I totally get wanting to wait — what if we just looked at the two on Kessler so you have a baseline?"'),
    finding(2, 'Dana Cole', 'Aria Thompson', 4187, 2, 'text',
      'First touch was a text 26 hours after assignment; no call logged in the window.'),
    finding(3, 'Dana Cole', 'Miguel Santos', 4250, 4, 'call',
      'Lead asked about interest rates twice; the conversation moved on without an answer.'),
    finding(4, 'Marcus Delgado', 'Beth Okafor', 4290, 6, 'call',
      '"Let\'s get you in Thursday at 5, or is Saturday morning better?" — booked on the spot.'),
  ];

  const p = (text: string, coach: string | null, idx: number[]): BriefPoint => ({
    text, ...(coach ? { coach } : {}), findingIndexes: idx,
  });

  const agents: BriefAgent[] = [
    {
      agentName: 'Trevor Holland',
      metrics: { reviewedContacts: 24, substantiveContacts: 7, callFirst: 14, textFirst: 6, noOutreach: 1, unclassified: 3 },
      doingRight: [
        p('Speed to lead is elite — first call inside minutes on new connects.', 'Name it out loud in the team meeting; make him the standard.', [0]),
        p('Handles "just looking" without dismissing the lead.', null, [1]),
      ],
      opportunityPoints: [],
      opportunities: [p('Follow-up cadence goes quiet after day three on non-responders.', 'Set a 3-5-7 touch plan together and inspect it Friday.', [])],
      objections: [p('"We want to wait until spring."', null, [1])],
      coachingActions: [p('Roleplay the wait-until-spring conversation using his own Devonte call as the script.', null, [1])],
    },
    {
      agentName: 'Dana Cole',
      metrics: { reviewedContacts: 18, substantiveContacts: 3, callFirst: 4, textFirst: 11, noOutreach: 2, unclassified: 1 },
      doingRight: [p('Consistent same-day responses once a conversation starts.', null, [])],
      opportunityPoints: [],
      opportunities: [
        p('Texts first on new leads — the phone comes out only after the lead replies.', 'Agree on call-first for all new assignments this week; review the log together Friday.', [2]),
        p('Rate questions get deflected instead of answered with a lender handoff.', 'Script the two-sentence lender bridge and practice it live.', [3]),
      ],
      objections: [p('"What are rates doing right now?"', null, [3])],
      coachingActions: [p('Call-first week: every new lead gets a dial before any text, tracked daily.', null, [2])],
    },
    {
      agentName: 'Marcus Delgado',
      metrics: { reviewedContacts: 21, substantiveContacts: 6, callFirst: 12, textFirst: 5, noOutreach: 0, unclassified: 4 },
      doingRight: [p('Closes for the appointment with an either/or on nearly every substantive call.', 'Have him teach the close in Friday\'s huddle.', [4])],
      opportunityPoints: [],
      opportunities: [],
      objections: [],
      coachingActions: [p('Capture one of his appointment closes for the team library.', null, [4])],
    },
    {
      agentName: 'Maria Lopez',
      metrics: { reviewedContacts: 2 },
      doingRight: [], opportunities: [], opportunityPoints: [], objections: [], coachingActions: [],
    },
  ];

  const row: BriefReportRow = {
    id: 'demo-brief-1',
    team_id: 'demo',
    team_slug: 'sample-realty',
    week_start: iso(start),
    week_end: iso(end),
    generated_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    payload: {
      schemaVersion: '1.0',
      run: {
        runId: 'demo-run-1', trigger: 'weekly', teamId: 'sample-realty',
        teamName: 'Sample Realty', startDate: iso(start), endDate: iso(end),
      },
      agents,
      findings,
    },
    agent_links: {
      'Trevor Holland': 'demo-c1',
      'Dana Cole': 'demo-c2',
      'Marcus Delgado': 'demo-c4',
      'Maria Lopez': 'demo-c5',
    },
  };
  const latest = toView(row);
  return {
    latest,
    weeks: latest ? [{ reportId: latest.reportId, weekStart: latest.weekStart, weekEnd: latest.weekEnd }] : [],
  };
}
