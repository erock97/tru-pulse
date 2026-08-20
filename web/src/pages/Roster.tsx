/**
 * Pulse — the roster.
 *
 * This replaces the old overview, which showed six stat cards, a bubble chart
 * and a commission figure, and buried the only genuinely useful thing (the
 * per-agent table) below all of it.
 *
 * The page answers one question: who do I need to talk to, and why. It opens
 * with a short priority list, then the numbers behind it, then the whole roster
 * dense enough to scan in one screen.
 *
 * Two rules it holds to, because breaking them is what made the old page
 * untrustworthy:
 *   - Every number on screen is measured. Nothing is a placeholder and nothing
 *     is derived from an assumption without saying so.
 *   - An agent it cannot resolve is shown, not dropped.
 */

import { useEffect, useMemo, useState } from 'react';

import { useReveal } from '../hqHooks';
import { HqShell } from '../components/hqShell';
import { loadDashboard, signOutClean } from '../lib/api';
import { loadRoster, type RosterAgent } from '../lib/coachData';
import { isClosing, isOfferPlus, stageClass, isStuckStage } from '../../../shared/flags';

/* ── the line ──────────────────────────────────────────────────────────────
   Leads-per-contract worse than this is "past the line". Set per team in
   settings; the fallback is Eric's stated standard of one in thirty. */
const DEFAULT_LINE = 30;

type Health = 'past-line' | 'behind' | 'holding' | 'no-volume';

interface Row {
  agentId: string | null;
  name: string;
  leads: number;
  worked: number;
  workedPct: number;
  stuck: number;
  offers: number;
  contracts: number;
  perContract: number | null;
  lastDays: number | null;
  arch: string | null;
  archName: string | null;
  health: Health;
}

interface Priority {
  row: Row;
  reason: string;
  action: string;
  approach: string | null;
  severity: 'high' | 'medium';
}

const norm = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function healthOf(perContract: number | null, teamRate: number | null, line: number): Health {
  if (perContract === null) return 'no-volume';
  if (perContract > line) return 'past-line';
  if (teamRate !== null && perContract > teamRate * 1.12) return 'behind';
  return 'holding';
}

/* ── the priority list ─────────────────────────────────────────────────────
   Ranked on signals that are all genuinely measured today. Trend is absent on
   purpose: Follow Up Boss carries no stage history, so it cannot be computed
   without inventing it. It arrives once the weekly Hustle rows accumulate. */
function prioritise(rows: readonly Row[]): Priority[] {
  const out: Priority[] = [];

  for (const r of rows) {
    if (r.health === 'past-line') {
      out.push({
        row: r,
        severity: 'high',
        reason: r.workedPct >= 95
          ? `Worked ${r.workedPct}% of ${r.leads} leads and closed ${r.contracts}. Nothing is being dropped before the call, so the loss is on it.`
          : `One contract from ${r.leads} leads, and ${100 - r.workedPct}% of them were never worked.`,
        action: r.workedPct >= 95 ? 'Listen to a recent call before the next 1:1.' : 'Start with the untouched leads.',
        approach: approachFor(r),
      });
    } else if (r.stuck > 10) {
      out.push({
        row: r,
        severity: 'high',
        reason: `${r.stuck} of ${r.leads} leads are still sitting in Lead.`,
        action: 'Work the stuck list with them, oldest first.',
        approach: approachFor(r),
      });
    } else if (r.lastDays !== null && r.lastDays > 45) {
      out.push({
        row: r,
        severity: 'medium',
        reason: `${r.lastDays} days since their last 1:1.`,
        action: 'Book one this week.',
        approach: approachFor(r),
      });
    } else if (r.health === 'no-volume' && r.leads < 5) {
      out.push({
        row: r,
        severity: 'medium',
        reason: `${r.leads} lead${r.leads === 1 ? '' : 's'} in this window. There is nothing here to coach from.`,
        action: 'Check how leads are being routed before anything else.',
        approach: null,
      });
    }
  }

  const rank = { high: 0, medium: 1 } as const;
  return out
    .sort((a, b) => rank[a.severity] - rank[b.severity]
      || (b.row.perContract ?? 0) - (a.row.perContract ?? 0))
    .slice(0, 4);
}

/** The personality angle comes from the assessment; without one, say nothing. */
function approachFor(r: Row): string | null {
  if (!r.arch) return null;
  if (r.arch === 'Striver') return 'A Striver — lead with momentum and a specific next rep, not a target.';
  if (r.arch === 'Achiever') return 'An Achiever — give them the number and the autonomy to hit it.';
  if (r.arch === 'Independent') return 'Independent — agree the outcome, then stay out of the method.';
  return null;
}

export default function Roster({
  orgName, onOpenPulse, onOpenCoach, onOpenRep,
}: {
  orgName: string;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const line = DEFAULT_LINE;
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: 'perContract', dir: -1 });

  // The shell's heading is a `.reveal` element and stays hidden until this runs.
  useReveal([rows]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The coaching roster is a separate read and is allowed to fail: a team
        // with Coach switched off still gets its pipeline.
        const [data, coach] = await Promise.all([
          loadDashboard(),
          loadRoster().catch((): RosterAgent[] => []),
        ]);
        if (!alive) return;

        // NOTE: org_settings.close_rate is a percentage, not a ratio - reading
        // it here produced "your line is 1 : 2". The per-team line needs its own
        // settings field; until it exists this holds the stated standard.

        const byName = new Map(coach.map((c) => [norm(c.name), c]));
        const bucket = new Map<string, Row>();

        for (const l of data.leads) {
          const owner = l.assigned_to?.trim();
          if (!owner) continue;
          const key = norm(owner);
          let r = bucket.get(key);
          if (!r) {
            const c = byName.get(key);
            r = {
              agentId: c?.id ?? null,
              name: owner,
              leads: 0, worked: 0, workedPct: 0, stuck: 0, offers: 0, contracts: 0,
              perContract: null,
              lastDays: c && c.lastDays < 99 ? c.lastDays : null,
              arch: c?.quad ?? null,
              archName: c?.archName ?? null,
              health: 'no-volume',
            };
            bucket.set(key, r);
          }
          r.leads += 1;
          const cls = stageClass(l.stage);
          if (isOfferPlus(cls)) r.offers += 1;
          if (isClosing(cls)) r.contracts += 1;
          if (isStuckStage(l.stage)) r.stuck += 1;
          if (l.flag !== 'zero_contact') r.worked += 1;
        }

        const list = [...bucket.values()].map((r) => ({
          ...r,
          workedPct: r.leads ? Math.round((r.worked / r.leads) * 100) : 0,
          perContract: r.contracts ? r.leads / r.contracts : null,
        }));

        const totalLeads = list.reduce((a, r) => a + r.leads, 0);
        const totalContracts = list.reduce((a, r) => a + r.contracts, 0);
        const teamRate = totalContracts ? totalLeads / totalContracts : null;

        setRows(list.map((r) => ({ ...r, health: healthOf(r.perContract, teamRate, line) })));
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not load the roster.');
      }
    })();
    return () => { alive = false; };
    // `line` is read inside but only as a fallback; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    if (!rows) return null;
    const leads = rows.reduce((a, r) => a + r.leads, 0);
    const worked = rows.reduce((a, r) => a + r.worked, 0);
    const contracts = rows.reduce((a, r) => a + r.contracts, 0);
    const offers = rows.reduce((a, r) => a + r.offers, 0);
    const stuck = rows.reduce((a, r) => a + r.stuck, 0);
    return {
      leads, worked, contracts, offers, stuck,
      workedPct: leads ? Math.round((worked / leads) * 100) : 0,
      perContract: contracts ? leads / contracts : null,
      pastLine: rows.filter((r) => r.health === 'past-line').length,
      stale: rows.filter((r) => r.lastDays !== null && r.lastDays > 30).length,
    };
  }, [rows]);

  const priorities = useMemo(
    () => (rows ? prioritise(rows) : []),
    [rows],
  );

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null && y === null) return 0;
      if (x === null) return 1;          // no-volume always sits at the bottom
      if (y === null) return -1;
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * sort.dir * -1;
      }
      return ((y as number) - (x as number)) * sort.dir;
    });
  }, [rows, sort]);

  const nav = { onOpenPulse, onOpenCoach, onOpenRep };
  // The shell already renders an eyebrow and an h1. The page used to render its
  // own as well, which stacked two headings. One heading, and it says the thing
  // that actually matters this week.
  const wrap = (body: React.ReactNode, title: string) => (
    <div className="tru-dark">
      <HqShell
        orgName={orgName}
        eyebrow={`${orgName} · rolling window`}
        title={title}
        onSignOut={() => signOutClean()}
        nav={nav}
      >
        {body}
      </HqShell>
    </div>
  );

  if (err) return wrap(<div className="ps-emptyview"><h3>{err}</h3></div>, 'Pulse');
  if (!rows || !totals) return wrap(<div className="spinner" />, 'Pulse');

  // Fit the axis to what is actually on screen, with a little air either side,
  // so the dots spread across the bar instead of bunching at one end.
  const rates = rows.map((r) => r.perContract).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.min(line, ...rates) - 4);
  const hi = Math.max(line, ...rates) + 4;
  const scale = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
  const th = (key: keyof Row, label: string) => (
    <th
      className={`sortable${sort.key === key ? ' on' : ''}`}
      tabIndex={0}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 })); } }}
    >
      {label}<span className="sortcaret">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
    </th>
  );

  return wrap(
    <>
      <div className="rs-canvas">
        <header className="rs-mast">
          <p className="rs-sub">
            {priorities.length === 0
              ? `All ${rows.length} agents are inside one in ${line}, and nobody has gone more than 45 days without a 1:1.`
              : `Ranked on what your numbers can show today. Your line is one in ${line}; the team runs ${totals.perContract ? `one in ${Math.round(totals.perContract)}` : 'no closings yet'}.`}
          </p>
        </header>

        {priorities.length > 0 && (
          <section className="rs-queue">
            {priorities.map((p, i) => (
              <article
                key={p.row.name}
                className={`rs-q${p.severity === 'high' ? ' crit' : ''}`}
                tabIndex={0}
                onClick={() => setOpen(p.row)}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(p.row); }}
              >
                <div className={`rs-rank ${p.severity}`}>{i + 1}</div>
                <div className="rs-q-body">
                  <div className="rs-q-name">{p.row.name}</div>
                  <p className="rs-q-why">{p.reason}</p>
                  <p className="rs-q-do"><b>Do:</b> {p.action}</p>
                  {p.approach && <p className="rs-q-how">{p.approach}</p>}
                </div>
                <div className="rs-q-fig">
                  <b>{p.row.perContract ? `1 : ${Math.round(p.row.perContract)}` : '—'}</b>
                  <s>per contract</s>
                </div>
              </article>
            ))}
          </section>
        )}

        <section className="rs-strip">
          {[
            ['Leads in play', String(totals.leads), ''],
            ['Worked', `${totals.workedPct}%`, `${totals.worked} of ${totals.leads}`],
            ['Under contract', String(totals.contracts), ''],
            ['Leads per contract', totals.perContract ? `1 : ${Math.round(totals.perContract)}` : '—', `your line is 1 : ${line}`],
            ['Still in Lead', String(totals.stuck), ''],
            ['Past your line', String(totals.pastLine), totals.stale ? `${totals.stale} stale 1:1s` : ''],
          ].map(([k, v, u]) => (
            <div className={`rs-fact${k === 'Past your line' && totals.pastLine > 0 ? ' hot' : ''}`} key={k}>
              <span className="k">{k}</span><span className="v">{v}</span>{u ? <span className="u">{u}</span> : null}
            </div>
          ))}
        </section>

        <div className="panel-head rs-head">
          <h3>The roster</h3>
          <span className="panel-sub">Bar is leads per contract · the mark is your line at 1 : {line}</span>
        </div>

        <div className="hqcard rs-table">
          <table className="tru-table">
            <thead>
              <tr>
                {th('name', 'Agent')}{th('leads', 'Leads')}{th('workedPct', 'Worked')}
                {th('stuck', 'In Lead')}{th('offers', 'Offers')}{th('contracts', 'Contracts')}
                {th('perContract', 'Leads per contract')}{th('lastDays', 'Last 1:1')}
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.name} className="rowlink" tabIndex={0}
                    onClick={() => setOpen(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r); }}>
                  <td>
                    <div className="cell-name">{r.name}</div>
                    <div className="rs-sub2">{r.archName ?? 'Not assessed'}</div>
                  </td>
                  <td>{r.leads}</td>
                  <td className={r.workedPct < 90 ? 'cell-warn' : ''}>{r.workedPct}%</td>
                  <td className={r.stuck > 10 ? 'cell-warn' : ''}>{r.stuck || '—'}</td>
                  <td>{r.offers || '—'}</td>
                  <td>{r.contracts || '—'}</td>
                  <td>
                    <div className="rs-rate">
                      <b className={r.health === 'past-line' ? 'cell-warn' : ''}>
                        {r.perContract ? `1 : ${Math.round(r.perContract)}` : '—'}
                      </b>
                      <span className="rs-scale">
                        <hr />
                        <u style={{ left: `${scale(line)}%` }} />
                        {r.perContract !== null && (
                          <i style={{ left: `${scale(r.perContract)}%` }} className={`h-${r.health}`} />
                        )}
                      </span>
                    </div>
                  </td>
                  <td className={r.lastDays !== null && r.lastDays > 45 ? 'cell-warn' : ''}>
                    {r.lastDays === null ? '—' : `${r.lastDays}d`}
                  </td>
                  <td><span className={`rs-tag h-${r.health}`}>{
                    r.health === 'past-line' ? 'past the line'
                      : r.health === 'behind' ? 'behind team'
                        : r.health === 'no-volume' ? 'no volume' : 'holding'
                  }</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Team</td><td><b>{totals.leads}</b></td><td><b>{totals.workedPct}%</b></td>
                <td><b>{totals.stuck}</b></td><td><b>{totals.offers}</b></td><td><b>{totals.contracts}</b></td>
                <td><b>{totals.perContract ? `1 : ${Math.round(totals.perContract)}` : '—'}</b></td>
                <td><b>{totals.stale} stale</b></td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {open && (
        <>
          <div className="rs-scrim on" onClick={() => setOpen(null)} />
          <aside className="rs-pane on">
            <div className="rs-pane-h">
              <button className="x" onClick={() => setOpen(null)} aria-label="Close">✕</button>
              <h3>{open.name}</h3>
              <p>{open.archName ?? 'Not assessed'} · {open.leads} leads</p>
            </div>
            <div className="rs-pane-b">
              <div className="rs-grp">
                <div className="rs-grp-k">Pipeline</div>
                {[
                  ['Leads assigned', String(open.leads)],
                  ['Worked', `${open.workedPct}%`],
                  ['Sitting in Lead', open.stuck ? String(open.stuck) : 'none'],
                  ['Reached an offer', open.offers ? String(open.offers) : 'none'],
                  ['Under contract', open.contracts ? String(open.contracts) : 'none'],
                  ['Leads per contract', open.perContract ? `1 : ${Math.round(open.perContract)}` : '—'],
                ].map(([k, v]) => (
                  <div className="rs-ln" key={k}><s>{k}</s><b>{v}</b></div>
                ))}
              </div>
              <div className="rs-grp">
                <div className="rs-grp-k">Coaching</div>
                <div className="rs-ln"><s>Archetype</s><b>{open.arch ?? '—'}</b></div>
                <div className="rs-ln"><s>Last 1:1</s><b>{open.lastDays === null ? 'no record' : `${open.lastDays} days ago`}</b></div>
                {approachFor(open) && <p className="rs-msg">{approachFor(open)}</p>}
                {open.agentId
                  ? <a className="hqbtn hqbtn-primary rs-go" href={`#/coach/${open.agentId}`}>Open {open.name.split(' ')[0]} in Coach</a>
                  : <p className="rs-msg">No coaching record is linked to this name, so there is nothing to open.</p>}
              </div>
            </div>
          </aside>
        </>
      )}
    </>,
    priorities.length === 0
      ? 'Nobody is past your line.'
      : `${priorities.length} ${priorities.length === 1 ? 'conversation' : 'conversations'} this week.`,
  );
}
