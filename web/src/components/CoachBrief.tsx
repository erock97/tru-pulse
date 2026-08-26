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

/* ════════ The team scan, on the Coach roster page ════════ */

/** The cohort's half of an agent's card: assessment + 1:1 state. */
export interface CohortMeta {
  archName: string;
  health: number;
  lastDays: number;
  needsYou: boolean;
}

export function TeamBriefSection({ onOpenAgent, cohort }: {
  onOpenAgent?: (agentId: string, agentName: string) => void;
  /** Keyed by agent id AND lowercased name; absent for unprofiled agents. */
  cohort?: Map<string, CohortMeta>;
}) {
  const [reportId, setReportId] = useState<string | null>(null);
  const { bundle } = useBrief(reportId);
  const [printing, setPrinting] = useState(false);
  const view = bundle?.latest ?? null;

  // No published brief for this org → no section at all. Teams that aren't on
  // the weekly review (most customers) must never see an empty "no brief"
  // frame; the section simply starts existing the week their first report lands.
  if (!view) return null;

  return (
    <div className="dk-sec brief-sec">
      <h2>The weekly brief</h2>
      <p>
        {briefRangeLabel(view.weekStart, view.weekEnd)}
        {' · '}{view.agents.length} agent{view.agents.length === 1 ? '' : 's'} reviewed
      </p>
      <span className="dk-key brief-actions">
        <WeekPicker weeks={bundle?.weeks ?? []} current={reportId} onPick={setReportId} />
        <button className="brief-pdf" onClick={() => setPrinting(true)}>Download PDF</button>
      </span>

      {/* One CARD per agent, not a cramped four-column table. The old scan ran
          names at 15px and the coaching line at 14px truncated to one line
          with an ellipsis, on the same page where every Pulse tile runs
          20-22px. This section is the reason a leader opens the tab; it now
          looks like it. Cards arrive on the house fade-up, staggered, and the
          coaching line wraps in full instead of being cut. */}
      <div className="brief-scan" role="list" aria-label="Team coaching scan">
        {[...view.agents]
          .map((a) => ({
            a,
            meta: cohort?.get(a.agentId ?? '') ?? cohort?.get(a.agentName.trim().toLowerCase()),
          }))
          /* One order for one list: the people who need a leader first, then
             the coached cohort by health (worst up), then everyone else by how
             much the week saw of them. This replaces the separate focus row
             and roster table -- ONE list, sorted by who deserves attention. */
          .sort((x, y) => {
            const ax = x.meta?.needsYou ? 0 : x.meta ? 1 : 2;
            const ay = y.meta?.needsYou ? 0 : y.meta ? 1 : 2;
            if (ax !== ay) return ax - ay;
            if (x.meta && y.meta) return x.meta.health - y.meta.health;
            const wx = (x.a.metrics.reviewedContacts ?? 0) + x.a.objections.length * 3;
            const wy = (y.a.metrics.reviewedContacts ?? 0) + y.a.objections.length * 3;
            return wy - wx;
          })
          .map(({ a, meta }, i) => {
          const priority = priorityLabel(a);
          const clickable = !!(a.agentId && onOpenAgent);
          const reviewed = a.metrics.reviewedContacts;
          return (
            <article
              className={[
                'rs-plate', 'brief-agent-card',
                clickable ? 'is-link' : '',
                meta?.needsYou ? 'needs-you' : '',
                /* Tone edges break the sea of identical tiles: ember for the
                   people who need a leader, amber where buyers pushed back,
                   and a QUIET card for an agent with nothing to flag -- a calm
                   week should look calm, not identical to a loaded one. */
                !meta?.needsYou && a.objections.length > 0 ? 'has-watch' : '',
                !priority ? 'is-quiet' : '',
              ].filter(Boolean).join(' ')}
              role="listitem"
              key={a.agentName}
              style={{ animationDelay: `${Math.min(i, 10) * 70}ms` }}
              onClick={clickable ? () => onOpenAgent!(a.agentId!, a.agentName) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onOpenAgent!(a.agentId!, a.agentName); } : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <header className="brief-agent-top">
                <h3 className="brief-agent-name">{a.agentName}</h3>
                <span className="brief-agent-stats">
                  {reviewed !== undefined && (
                    <span className="brief-stat">
                      <b>{reviewed}</b> reviewed
                    </span>
                  )}
                  {a.objections.length > 0 && (
                    <span className="brief-stat is-watch">
                      <b>{a.objections.length}</b> objection{a.objections.length === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
              </header>
              {/* The agent's own first-touch mix, in the page's segmented-strip
                  language (the Independent/Striver/Achiever bar above). This is
                  what un-flattens the wall: every card carries a different
                  shape, and the shape is the behaviour TRU coaches hardest --
                  calls before texts. Sea = called first, amber = texted. */}
              {(() => {
                const c = a.metrics.callFirst ?? 0;
                const t = a.metrics.textFirst ?? 0;
                if (c + t < 2) return null;
                return (
                  <span className="brief-mix" aria-label={`${c} called first, ${t} texted first`}>
                    <span className="brief-mix-bar">
                      {c > 0 && <i className="is-call" style={{ flexGrow: c }} />}
                      {t > 0 && <i className="is-text" style={{ flexGrow: t }} />}
                    </span>
                    <span className="brief-mix-cap"><b>{c}</b> called first · <b>{t}</b> texted</span>
                  </span>
                );
              })()}
              <p className="brief-agent-pri">
                {priority ?? <i className="brief-none-inline">{emptyPriorityLabel(a)}</i>}
              </p>
              {/* The dashboard, folded into the card. This line IS the old
                  cohort table: archetype, coaching health, last 1:1. Absent for
                  the unprofiled rather than pretending with dashes. */}
              {meta ? (
                <p className="brief-agent-meta">
                  <span className="bam-arch">{meta.archName}</span>
                  <span className="bam-dot" aria-hidden />
                  <span>health <b>{meta.health}</b></span>
                  <span className="bam-dot" aria-hidden />
                  <span>{meta.lastDays >= 99 ? 'no 1:1 yet' : meta.lastDays === 0 ? '1:1 today' : `1:1 ${meta.lastDays}d ago`}</span>
                  {meta.needsYou && <span className="bam-needs">needs you</span>}
                </p>
              ) : (
                <p className="brief-agent-meta is-quiet">Not assessed yet</p>
              )}
              {clickable && <span className="brief-agent-go" aria-hidden>Open their brief</span>}
            </article>
          );
        })}
      </div>

      {printing && <BriefPrintSheet view={view} onClose={() => setPrinting(false)} />}
    </div>
  );
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
