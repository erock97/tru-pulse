// The weekly coaching brief in the Coach tab — the Hermes report, rendered.
//
// Two surfaces + one document:
//   <TeamBriefSection>  — the team scan on the Coach roster page
//   <AgentBriefPanel>   — one agent's brief inside their drill-in sheet
//   <BriefPrintSheet>   — OUR print-designed document (browser print-to-PDF);
//                         the laptop's own PDF is never parsed or shown.
//
// The rule that shapes every empty state here, in Eric's words: a blank section
// means there was not enough reviewed activity to say anything — it is data, not
// a failure — so it always renders the "not enough reviewed" line, never an
// empty box and never an error.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthChange } from '../lib/auth';
import { identityChanged, userIdOf } from '../lib/authIdentity';
import {
  agentBrief,
  briefRangeLabel,
  channelLabel,
  loadCoachBrief,
  NOT_ENOUGH_REVIEWED,
} from '../lib/coachBriefData';
import { workerFetch } from '../lib/api';
import { buildAgentPlan, type PatternsBundle } from '../lib/coachPlan';
import type {
  BriefAgentView,
  BriefBundle,
  BriefFinding,
  BriefPointView,
  BriefView,
  BriefWeek,
} from '../lib/coachBriefData';

/* ── One shared load per page view ──────────────────────────────────────────
   The roster section and (after a click-through) the agent panel both need the
   same latest bundle; cache the promise so the page asks the Worker once.

   The cache MUST die when the person changes. Sign-out, sign-in and admin
   act-as all swap the session without reloading the page, and a brief fetched
   under the previous identity is another team's report. The roster and
   dashboard caches key by org; this one holds a promise before any org is
   known, so it subscribes to auth instead and drops itself on any change. */
let latestBundle: Promise<BriefBundle> | null = null;
let bundleUser: string | null | undefined;
onAuthChange((s) => {
  const id = userIdOf(s);
  if (identityChanged(bundleUser, id)) latestBundle = null;
  bundleUser = id;
});
function loadLatestOnce(): Promise<BriefBundle> {
  if (!latestBundle) {
    latestBundle = loadCoachBrief().catch((e) => {
      latestBundle = null; // a failed load shouldn't poison later visits
      throw e;
    });
  }
  return latestBundle;
}

function useBrief(reportId: string | null): { bundle: BriefBundle | null; loading: boolean } {
  const [bundle, setBundle] = useState<BriefBundle | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    (reportId ? loadCoachBrief(reportId) : loadLatestOnce())
      .then((b) => { if (live) { setBundle(b); setLoading(false); } })
      .catch(() => { if (live) { setBundle({ latest: null, weeks: [] }); setLoading(false); } });
    return () => { live = false; };
  }, [reportId]);
  return { bundle, loading };
}

const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function WeekPicker({ weeks, current, onPick }: {
  weeks: BriefWeek[];
  current: string | null;
  onPick: (reportId: string | null) => void;
}) {
  if (weeks.length < 2) return null;
  return (
    <select
      className="brief-week-pick"
      aria-label="Which week's brief"
      value={current ?? weeks[0].reportId}
      onChange={(e) => onPick(e.target.value === weeks[0].reportId ? null : e.target.value)}
    >
      {weeks.map((w, i) => (
        <option key={w.reportId} value={w.reportId}>
          {briefRangeLabel(w.weekStart, w.weekEnd)}{i === 0 ? ' · latest' : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Link each contact named in a point's prose to their FUB record — quietly.
 * A team lead reading "Answered Rais Faizan by text" wants to land on Rais
 * without opening the proof. Exact evidence-name matches only: anything looser
 * would link words to the wrong person, and only the first mention per contact
 * so the sentence stays prose rather than a link farm.
 */
function linkLeads(text: string, evidence: BriefFinding[]): ReactNode {
  const leads = new Map<string, string>();
  for (const f of evidence) {
    if (f.leadName && f.leadUrl && !leads.has(f.leadName)) leads.set(f.leadName, f.leadUrl);
  }
  if (leads.size === 0) return text;
  // Longest first, so a longer name is never split by a shorter one inside it.
  const names = [...leads.keys()].sort((a, b) => b.length - a.length);
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    let at = -1;
    let hit = '';
    for (const n of names) {
      const i = rest.indexOf(n);
      if (i !== -1 && (at === -1 || i < at)) { at = i; hit = n; }
    }
    if (at === -1) { nodes.push(rest); break; }
    if (at > 0) nodes.push(rest.slice(0, at));
    nodes.push(
      <a key={key++} className="brief-lead-link" href={leads.get(hit)} target="_blank" rel="noreferrer">
        {hit}
      </a>,
    );
    names.splice(names.indexOf(hit), 1);
    rest = rest.slice(at + hit.length);
  }
  return nodes;
}

/** Past this length a quote is a transcript, not a line — clamp it and let
    the reader open the rest. Full transcripts arrived with the 1.2 batch
    (schema's sourceQuote can be an entire call) and rendered as a wall. */
const QUOTE_CLAMP_CHARS = 420;

function EvidenceList({ evidence }: { evidence: BriefFinding[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (evidence.length === 0) return null;
  return (
    <ul className="brief-evidence">
      {evidence.map((f, i) => (
        <li key={i}>
          {f.quote && (
            <>
              <blockquote className={
                f.quote.length > QUOTE_CLAMP_CHARS && expanded !== i ? 'is-clamped' : undefined
              }>“{f.quote}”</blockquote>
              {f.quote.length > QUOTE_CLAMP_CHARS && (
                <button
                  className="brief-evidence-toggle"
                  onClick={() => setExpanded(expanded === i ? null : i)}
                >
                  {expanded === i ? 'Show less' : 'Read the whole exchange'}
                </button>
              )}
            </>
          )}
          <span className="brief-evidence-meta">
            {channelLabel(f.channel)}
            {f.leadName && <>{f.channel ? ' with ' : ''}{f.leadUrl
              ? <a href={f.leadUrl} target="_blank" rel="noreferrer">{f.leadName}</a>
              : f.leadName}</>}
            {f.occurredAt && <> · {dateLabel(f.occurredAt)}</>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The evidence is ALWAYS one click deep. See docs/SALES_DOCTRINE.md section 6b.
 *
 * It used to print under every point in the agent sheet, on the theory that
 * the evidence was the product. Reading the result, Eric's verdict was that the
 * page alternates coaching action, proof, coaching action, proof until the
 * thread is lost -- the proof is louder than the insight and there is three
 * times more of it.
 *
 *   "The proof should be quiet. The broker wants to see proof, he clicks the
 *    proof and it shows the proof. But the real insight is the focus of the
 *    message."
 *
 * It still has to BE there -- a finding nobody can verify fails his own test
 * for a usable one -- but as a footnote the reader opens, never the body.
 */
function PointList({ points, tone, maxVisible }: {
  points: BriefPointView[];
  tone: 'good' | 'work' | 'watch';
  /** Show only this many, the rest behind a reader-operated "show more".
      The 2026-08-26 shape decision: one headline, at most two secondary,
      depth one click away — never the wall. */
  maxVisible?: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (points.length === 0) {
    return <p className="brief-none">{NOT_ENOUGH_REVIEWED}.</p>;
  }
  const hidden = maxVisible && !showAll ? Math.max(0, points.length - maxVisible) : 0;
  const shown = hidden > 0 ? points.slice(0, maxVisible) : points;
  return (
    <>
    <ul className={`brief-points is-${tone}`}>
      {shown.map((p, i) => (
        <li
          key={i}
          className="rs-plate brief-card"
          /* Staggered entry on the app's own .reveal timing tokens, so a column
             assembles rather than appearing. Reduced motion handled in CSS. */
          style={{ animationDelay: `${Math.min(i, 8) * 90}ms` }}
        >
          {(p as { kicker?: string }).kicker && (
            <p className="brief-lead-line">{(p as { kicker?: string }).kicker}</p>
          )}
          <p className="brief-point-text">{linkLeads(p.text, p.evidence)}</p>
          {p.coach && <p className="brief-coach"><b>Coach:</b> {linkLeads(p.coach, p.evidence)}</p>}
          {p.evidence.length > 0 && (
            <>
              <button
                className="brief-evidence-toggle"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {open === i ? 'Hide the proof' : `Proof (${p.evidence.length})`}
              </button>
              {open === i && <EvidenceList evidence={p.evidence} />}
            </>
          )}
        </li>
      ))}
    </ul>
    {hidden > 0 && (
      <button className="brief-more" onClick={() => setShowAll(true)}>
        Show {hidden} more
      </button>
    )}
    </>
  );
}

function OutreachRow({ a }: { a: BriefAgentView }) {
  const m = a.metrics;
  const parts: string[] = [];
  if (m.callFirst !== undefined) parts.push(`${m.callFirst} called first`);
  if (m.textFirst !== undefined) parts.push(`${m.textFirst} texted first`);
  if (m.noOutreach !== undefined) parts.push(`${m.noOutreach} untouched`);
  if (m.unclassified !== undefined && m.unclassified > 0) parts.push(`${m.unclassified} unclear`);
  if (parts.length === 0) return null;
  return <p className="brief-outreach">First touch on new leads: {parts.join(' · ')}.</p>;
}

/** Reviewed-coverage words for the team scan. */
function coverageLabel(a: BriefAgentView): string {
  const r = a.metrics.reviewedContacts;
  if (r === undefined) return NOT_ENOUGH_REVIEWED;
  const s = a.metrics.substantiveContacts;
  return s !== undefined ? `${r} reviewed · ${s} substantive` : `${r} reviewed`;
}

/** The team-scan "coaching priority": the report's top opportunity, verbatim. */
function priorityLabel(a: BriefAgentView): string | null {
  return a.opportunities[0]?.text ?? null;
}

/**
 * Why this cell is blank, in the words that answer the actual question.
 *
 * "Not enough reviewed this week" was doing two jobs, and the second one was a
 * lie. It is right when nothing of this agent's was read — there was nothing to
 * judge. It is wrong when conversations WERE read and none of them raised
 * anything, because it reads as a failure to collect and sends a leader
 * hunting for missing data that was never missing.
 */
function emptyPriorityLabel(a: BriefAgentView): string {
  const reviewed = a.metrics.reviewedContacts;
  if (reviewed === undefined || reviewed === 0) return NOT_ENOUGH_REVIEWED;
  return 'Nothing to flag this week';
}

/**
 * What each column means, on screen, where the question gets asked.
 *
 * The print sheet has had headers since it was written; the on-screen grid
 * never did — four unlabelled cells, so "what is this column" had no answer
 * short of reading the code. The titles carry the definition on hover; the
 * words themselves have to survive without it.
 */
/** Now only the PRINT sheet's table header; the on-screen scan is cards. */
const SCAN_COLUMNS: Array<{ label: string; help: string; className: string }> = [
  { label: 'Agent', className: 'brief-scan-name',
    help: 'The name on the conversations, as Follow Up Boss records it.' },
  { label: 'Reviewed', className: 'brief-scan-cov',
    help: 'How many of their conversations were read this week, and how many of '
        + 'those went beyond a one-line exchange. A low number means little to '
        + 'judge from, not that they did nothing.' },
  { label: 'Objections', className: 'brief-scan-obj',
    help: 'Times a buyer raised something real - already have an agent, pausing '
        + 'the search, not ready. Counted from what they said, not the outcome.' },
  { label: 'Coaching priority', className: 'brief-scan-pri',
    help: 'The one habit worth raising with them first. Blank means either '
        + 'nothing was read, or nothing read raised a concern - the cell says which.' },
];

/* ════════ Skills Training summary, team level ════════
   Hermes writes a specific skill flag ("Skill opportunity — Confidence.",
   "Skill opportunity — Service.") right inside its normal per-agent
   coaching-actions list. That list also carries the report's coachingMove
   text and, in the agent panel, gets superseded again by the ninety-day habit
   store the moment either has anything to say -- so a skill flag can be
   published every week and still never win the one lane it rendered into.
   coachBriefData.ts now reads the flags straight off the raw payload instead
   (agentView.skillOpportunities), so they exist on screen independent of
   whatever wins that lane. This section is where they surface: grouped by
   skill, one place a leader can see who needs which kind of work this week,
   without hunting through 15 agent panels for a sentence that starts the
   same way every time.

   Eric's evidence rule applies here same as everywhere else in the brief: a
   flag with no resolved finding behind it is dropped, not shown unproven. */
function SkillsTrainingSection({ view, onOpenAgent }: {
  view: BriefView;
  onOpenAgent?: (agentId: string, agentName: string) => void;
}) {
  const bySkill = useMemo(() => {
    const map = new Map<string, Array<{ agentName: string; agentId: string | null; point: BriefPointView }>>();
    for (const a of view.agents) {
      for (const s of a.skillOpportunities) {
        if (s.evidence.length === 0) continue;
        const list = map.get(s.skill) ?? [];
        list.push({ agentName: a.agentName, agentId: a.agentId, point: s });
        map.set(s.skill, list);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [view]);

  if (bySkill.length === 0) return null;

  return (
    <div className="dk-sec brief-sec brief-skills-sec">
      <h2>Skills training this week</h2>
      <p>Every flagged skill gap, grouped by skill — each one backed by the call or text it came from.</p>
      <div className="brief-skills-grid">
        {bySkill.map(([skill, rows]) => (
          <div className="rs-plate brief-skill-card" key={skill}>
            <h3 className="brief-skill-h">{skill}</h3>
            <ul className="brief-skill-agents">
              {rows.map(({ agentName, agentId, point: p }, i) => {
                const clickable = !!(agentId && onOpenAgent);
                return (
                  <li key={`${agentName}-${i}`} className="brief-skill-agent">
                    {clickable ? (
                      <button
                        type="button"
                        className="brief-skill-agent-link"
                        onClick={() => onOpenAgent!(agentId!, agentName)}
                      >
                        {agentName}
                      </button>
                    ) : (
                      <span className="brief-skill-agent-link is-static">{agentName}</span>
                    )}
                    {p.text && <p className="brief-skill-detail">{linkLeads(p.text, p.evidence)}</p>}
                    <EvidenceList evidence={p.evidence} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════ The team scan, on the Coach roster page ════════ */

/** The cohort's half of an agent's card: assessment + 1:1 state. */
export interface CohortMeta {
  archName: string;
  health: number;
  lastDays: number;
  needsYou: boolean;
}

export function TeamBriefSection({ onOpenAgent, cohort, preferredAgent }: {
  onOpenAgent?: (agentId: string, agentName: string) => void;
  cohort?: Map<string, CohortMeta>;
  preferredAgent?: string | null;
}) {
  const [reportId, setReportId] = useState<string | null>(null);
  const { bundle } = useBrief(reportId);
  const [printing, setPrinting] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(preferredAgent ?? '');
  const view = bundle?.latest ?? null;
  if (!view) return null;
  const people = [...view.agents].filter(a => (a.agentName+' '+(priorityLabel(a) ?? '')).toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b) => Number(!!priorityLabel(b))-Number(!!priorityLabel(a)) || a.agentName.localeCompare(b.agentName));
  const person = people.find(a => a.agentName === selected) ?? people[0];
  const meta = person ? cohort?.get(person.agentId ?? '') ?? cohort?.get(person.agentName.trim().toLowerCase()) : undefined;
  return <section className="dk-sec brief-sec">
    <div className="brief-workspace-heading"><div><h2>The weekly review</h2><p>{briefRangeLabel(view.weekStart, view.weekEnd)} · {view.agents.length} agents reviewed</p></div>
      <div className="brief-actions"><WeekPicker weeks={bundle?.weeks ?? []} current={reportId} onPick={setReportId} /><button className="brief-pdf" onClick={() => setPrinting(true)}>Download PDF</button></div></div>
    <div className="coaching-workspace">
      <aside className="coaching-queue" aria-label="People to review"><header><h3>People to review <small>{people.length}</small></h3><label>Find an agent<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or coaching focus" /></label></header>
        <div className="coaching-people">{people.map(a=><button key={a.agentId || a.agentName} aria-pressed={person?.agentName===a.agentName} onClick={()=>setSelected(a.agentName)}><strong>{a.agentName}</strong><span>{priorityLabel(a) ?? 'No coaching focus in this report'}</span></button>)}</div>
        <p className="coaching-order-note">Reported focus first, then alphabetical. This is not a severity ranking.</p>
      </aside>
      <div className="coaching-review" key={(view.reportId ?? '')+person?.agentName}>
        {person ? <><header className="coaching-review-head"><div><span className="coaching-eyebrow">Coaching review</span><h3>{person.agentName}</h3><p>{person.metrics.reviewedContacts ?? 'Unspecified'} contacts reviewed · Last 1:1: {!meta || meta.lastDays>=99 ? 'not recorded' : meta.lastDays===0 ? 'today' : meta.lastDays+' days ago'}</p></div>
          {person.agentId && onOpenAgent && <button className="brief-open" onClick={()=>onOpenAgent(person.agentId!,person.agentName)}>Prepare 1:1 →</button>}</header>
          <div className="coaching-review-body"><h4>What to work on</h4><PointList points={person.coachingActions.length ? person.coachingActions : person.opportunities} tone="work" maxVisible={3} />
          {!!person.objections.length && <><h4>Where the conversation gets difficult</h4><PointList points={person.objections} tone="watch" maxVisible={2} /></>}
          {!!person.doingRight.length && <><h4>Keep building on</h4><PointList points={person.doingRight} tone="good" maxVisible={2} /></>}
          <p className="coaching-order-note">Open the evidence beside each observation before using it in a coaching conversation. A linked source does not by itself establish the claim.</p></div>
        </> : <div className="coaching-empty"><h3>No agents match</h3><p>Try another name or coaching focus.</p><button className="brief-open" onClick={()=>setQuery('')}>Clear search</button></div>}
      </div>
    </div>
    <details className="brief-training-details"><summary>Training themes across the team</summary><SkillsTrainingSection view={view} onOpenAgent={onOpenAgent} /></details>
    {printing && <BriefPrintSheet view={view} onClose={()=>setPrinting(false)} />}
  </section>;
}

/* ── The ninety-day habit store, one fetch per page view ─────────────────────
   Same lifecycle as the brief cache above: shared promise, dropped on any auth
   change so an act-as swap cannot show another org's habits. A failed fetch
   resolves to null and the plan lane falls back to the report's moves — worse
   copy, never a blank lane. */
let patternsPromise: Promise<PatternsBundle | null> | null = null;
function loadPatterns(): Promise<PatternsBundle | null> {
  if (!patternsPromise) {
    patternsPromise = workerFetch('/data/coach/patterns')
      .then((r) => (r.ok ? (r.json() as Promise<PatternsBundle>) : null))
      .catch(() => null);
  }
  return patternsPromise;
}
onAuthChange(() => { patternsPromise = null; });

/* ════════ One agent's brief, inside the drill-in sheet ════════ */

export function AgentBriefPanel({ agentId, agentName }: {
  agentId: string;
  agentName: string;
}) {
  const [reportId, setReportId] = useState<string | null>(null);
  const { bundle } = useBrief(reportId);
  const [patterns, setPatterns] = useState<PatternsBundle | null>(null);
  useEffect(() => { let on = true; void loadPatterns().then((b) => { if (on) setPatterns(b); }); return () => { on = false; }; }, [agentId]);
  const view = bundle?.latest ?? null;
  const mine = useMemo(
    () => (view ? agentBrief(view, agentId, agentName) : null),
    [view, agentId, agentName],
  );
  // The leader's directives, from the habit store. The report's per-lead moves
  // remain the fallback for a week the store has nothing on.
  const plan = useMemo(
    () => (patterns ? buildAgentPlan(patterns.patterns, agentId, agentName, mine?.metrics) : []),
    [patterns, agentId, agentName, mine],
  );

  // No brief system in play yet → no panel at all (teams without the weekly
  // automation shouldn't see an empty frame). A running system where THIS agent
  // has no section is different: that's the not-enough-data state, shown below.
  if (!view) return null;

  return (
    // No `reveal` class here: this panel mounts AFTER its data loads, which is
    // after the page's reveal observer has already swept — it would stay at
    // opacity 0 forever and read as a giant hole in the page.
    <section className="card ad-panel brief-panel">
      <div className="ad-panel-head">
        <h3>The weekly coaching brief</h3>
        <span className="panel-sub">
          {briefRangeLabel(view.weekStart, view.weekEnd)}
        </span>
        <WeekPicker weeks={bundle?.weeks ?? []} current={reportId} onPick={setReportId} />
      </div>

      {!mine ? (
        <p className="brief-none">
          {NOT_ENOUGH_REVIEWED} for {agentName.split(' ')[0]} — nothing was reviewed in this window.
        </p>
      ) : (
        <>
          <OutreachRow a={mine} />
          {/* Four lanes read LEFT TO RIGHT, one per category, each under its
              own heavy header. They were a 2x2 grid with 10px labels, and in
              live use the labels disappeared into the points -- the categories
              are the structure of the whole panel, so they get to look like it. */}
          {/* TWO columns, not three. "Priority opportunities" and "What to do
              with this agent" were saying the same thing twice: the second is
              the first, expanded into a directive. So the directive wins, and
              the opportunities list only appears when there is no plan to
              replace it. What is left is the two questions a leader actually
              has -- what do I do, and what did buyers push back on.
              No "Keep doing" lane either: zero of the 181 agent reviews ever
              published carried a single point for it. */}
          <div className="brief-lanes">
            <div className="brief-lane is-work">
              <h4 className="brief-lane-h">What to do with this agent</h4>
              <PointList
                points={plan.length
                  ? plan
                  : (mine.coachingActions.length ? mine.coachingActions : mine.opportunities)}
                tone="work"
                maxVisible={3}
              />
            </div>
            <div className="brief-lane is-watch">
              <h4 className="brief-lane-h">Objections heard</h4>
              <PointList points={mine.objections} tone="watch" />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ════════ The printable brief — our own PDF ════════
   A light "paper" document over the whole team, opened as an overlay; the
   browser's Print → Save as PDF produces the shareable file. @media print rules
   in truHqDark.css hide everything but this sheet. */

function PrintPoints({ label, points }: { label: string; points: BriefPointView[] }) {
  return (
    <div className="bp-block">
      <h4>{label}</h4>
      {points.length === 0 ? (
        <p className="bp-none">{NOT_ENOUGH_REVIEWED}.</p>
      ) : (
        <ul>
          {points.map((p, i) => (
            <li key={i}>
              <p>{p.text}</p>
              {p.coach && <p className="bp-coach">Coach: {p.coach}</p>}
              {p.evidence.map((f, j) => (
                <p className="bp-evidence" key={j}>
                  {f.quote && <>“{f.quote}” — </>}
                  {f.leadName}{f.occurredAt && <>, {dateLabel(f.occurredAt)}</>}{channelLabel(f.channel) && <> ({channelLabel(f.channel)})</>}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BriefPrintSheet({ view, onClose }: { view: BriefView; onClose: () => void }) {
  // Mark the body so print CSS can isolate the sheet from the app behind it.
  useEffect(() => {
    document.body.classList.add('brief-printing');
    return () => document.body.classList.remove('brief-printing');
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="brief-print-wrap" role="dialog" aria-label="Printable coaching brief">
      <div className="brief-print-bar">
        <span>Print → “Save as PDF” makes the shareable file.</span>
        <span>
          <button className="brief-pdf" onClick={() => window.print()}>Print / Save as PDF</button>
          <button className="brief-pdf is-ghost" onClick={onClose}>Close</button>
        </span>
      </div>
      <div className="brief-print">
        <header className="bp-head">
          <span className="bp-mark" aria-hidden>
            <img src="/tru-mark.png" alt="" />
          </span>
          <div>
            <h1>Weekly Coaching Brief</h1>
            <p>
              {view.teamName ?? 'Team'} · {briefRangeLabel(view.weekStart, view.weekEnd)}
            </p>
          </div>
        </header>

        <section className="bp-scan">
          <h2>Team coaching scan</h2>
          <table>
            <thead>
              {/* Same four labels as the screen, from the same list, so the
                  printed sheet and the page can never drift apart. */}
              <tr>{SCAN_COLUMNS.map((c) => <th key={c.label}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {view.agents.map((a) => (
                <tr key={a.agentName}>
                  <td>{a.agentName}</td>
                  <td>{coverageLabel(a)}</td>
                  <td>{a.objections.length || '—'}</td>
                  <td>{priorityLabel(a) ?? emptyPriorityLabel(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {view.agents.map((a) => (
          <section className="bp-agent" key={a.agentName}>
            <h2>{a.agentName}</h2>
            {(() => {
              const m = a.metrics;
              const bits: string[] = [];
              if (m.reviewedContacts !== undefined) bits.push(`${m.reviewedContacts} contacts reviewed`);
              if (m.callFirst !== undefined) bits.push(`${m.callFirst} called first`);
              if (m.textFirst !== undefined) bits.push(`${m.textFirst} texted first`);
              if (m.noOutreach !== undefined) bits.push(`${m.noOutreach} untouched`);
              return bits.length ? <p className="bp-metrics">{bits.join(' · ')}</p> : null;
            })()}
            <PrintPoints label="Priority opportunities" points={a.opportunities} />
            <PrintPoints label="Objections heard" points={a.objections} />
            <PrintPoints label="What to do with this agent" points={a.coachingActions} />
          </section>
        ))}

        <footer className="bp-foot">
          Generated by TRU Coach · evidence cites link to Follow Up Boss in the app.
        </footer>
      </div>
    </div>
  );
}
