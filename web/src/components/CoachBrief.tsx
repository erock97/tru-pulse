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
import { useEffect, useMemo, useState } from 'react';
import {
  agentBrief,
  briefRangeLabel,
  loadCoachBrief,
  NOT_ENOUGH_REVIEWED,
} from '../lib/coachBriefData';
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
   same latest bundle; cache the promise so the page asks the Worker once. */
let latestBundle: Promise<BriefBundle> | null = null;
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

function EvidenceList({ evidence }: { evidence: BriefFinding[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="brief-evidence">
      {evidence.map((f, i) => (
        <li key={i}>
          {f.quote && <blockquote>“{f.quote}”</blockquote>}
          <span className="brief-evidence-meta">
            {f.leadName && (f.leadUrl
              ? <a href={f.leadUrl} target="_blank" rel="noreferrer">{f.leadName}</a>
              : f.leadName)}
            {f.occurredAt && <> · {dateLabel(f.occurredAt)}</>}
            {f.channel && <> · {f.channel}</>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PointList({ points, tone }: { points: BriefPointView[]; tone: 'good' | 'work' | 'watch' }) {
  const [open, setOpen] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="brief-none">{NOT_ENOUGH_REVIEWED}.</p>;
  }
  return (
    <ul className={`brief-points is-${tone}`}>
      {points.map((p, i) => (
        <li key={i}>
          <p className="brief-point-text">{p.text}</p>
          {p.coach && <p className="brief-coach"><b>Coach:</b> {p.coach}</p>}
          {p.evidence.length > 0 && (
            <>
              <button
                className="brief-evidence-toggle"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {open === i ? 'Hide the evidence' : `See the evidence (${p.evidence.length})`}
              </button>
              {open === i && <EvidenceList evidence={p.evidence} />}
            </>
          )}
        </li>
      ))}
    </ul>
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

/* ════════ The team scan, on the Coach roster page ════════ */

export function TeamBriefSection({ onOpenAgent }: {
  onOpenAgent?: (agentId: string) => void;
}) {
  const [reportId, setReportId] = useState<string | null>(null);
  const { bundle, loading } = useBrief(reportId);
  const [printing, setPrinting] = useState(false);
  const view = bundle?.latest ?? null;

  if (loading && !view) return null; // never a spinner for an optional section
  if (!view) {
    return (
      <div className="dk-sec brief-sec">
        <h2>The weekly brief</h2>
        <p className="brief-none">
          No coaching brief yet — the first one appears here after the weekly review runs.
        </p>
      </div>
    );
  }

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

      <div className="brief-scan" role="table" aria-label="Team coaching scan">
        {view.agents.map((a) => {
          const priority = priorityLabel(a);
          const clickable = !!(a.agentId && onOpenAgent);
          return (
            <div
              className={clickable ? 'brief-scan-row is-link' : 'brief-scan-row'}
              role="row"
              key={a.agentName}
              onClick={clickable ? () => onOpenAgent!(a.agentId!) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onOpenAgent!(a.agentId!); } : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <span className="brief-scan-name" role="cell">{a.agentName}</span>
              <span className="brief-scan-cov" role="cell">{coverageLabel(a)}</span>
              <span className="brief-scan-obj" role="cell">
                {a.objections.length > 0
                  ? `${a.objections.length} objection${a.objections.length === 1 ? '' : 's'} heard`
                  : '—'}
              </span>
              <span className="brief-scan-pri" role="cell">
                {priority ?? <i className="brief-none-inline">{NOT_ENOUGH_REVIEWED}</i>}
              </span>
            </div>
          );
        })}
      </div>

      {printing && <BriefPrintSheet view={view} onClose={() => setPrinting(false)} />}
    </div>
  );
}

/* ════════ One agent's brief, inside the drill-in sheet ════════ */

export function AgentBriefPanel({ agentId, agentName }: {
  agentId: string;
  agentName: string;
}) {
  const [reportId, setReportId] = useState<string | null>(null);
  const { bundle } = useBrief(reportId);
  const view = bundle?.latest ?? null;
  const mine = useMemo(
    () => (view ? agentBrief(view, agentId, agentName) : null),
    [view, agentId, agentName],
  );

  // No brief system in play yet → no panel at all (teams without the weekly
  // automation shouldn't see an empty frame). A running system where THIS agent
  // has no section is different: that's the not-enough-data state, shown below.
  if (!view) return null;

  return (
    <section className="card ad-panel reveal brief-panel" data-delay="180">
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
          <div className="brief-cols">
            <div>
              <span className="ad-swot-k">Keep doing</span>
              <PointList points={mine.doingRight} tone="good" />
            </div>
            <div>
              <span className="ad-swot-k">Priority opportunities</span>
              <PointList points={mine.opportunities} tone="work" />
            </div>
            <div>
              <span className="ad-swot-k">Objections heard</span>
              <PointList points={mine.objections} tone="watch" />
            </div>
            <div>
              <span className="ad-swot-k">This week’s coaching plan</span>
              <PointList points={mine.coachingActions} tone="work" />
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
                  {f.leadName}{f.occurredAt && <>, {dateLabel(f.occurredAt)}</>}{f.channel && <> ({f.channel})</>}
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
              <tr><th>Agent</th><th>Review coverage</th><th>Objections</th><th>Coaching priority</th></tr>
            </thead>
            <tbody>
              {view.agents.map((a) => (
                <tr key={a.agentName}>
                  <td>{a.agentName}</td>
                  <td>{coverageLabel(a)}</td>
                  <td>{a.objections.length || '—'}</td>
                  <td>{priorityLabel(a) ?? NOT_ENOUGH_REVIEWED}</td>
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
            <PrintPoints label="Keep doing" points={a.doingRight} />
            <PrintPoints label="Priority opportunities" points={a.opportunities} />
            <PrintPoints label="Objections heard" points={a.objections} />
            <PrintPoints label="This week’s coaching plan" points={a.coachingActions} />
          </section>
        ))}

        <footer className="bp-foot">
          Generated by TRU Coach · evidence cites link to Follow Up Boss in the app.
        </footer>
      </div>
    </div>
  );
}
