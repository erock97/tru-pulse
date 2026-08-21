/**
 * Pulse — the Command Deck layout.
 *
 * The alternative to `Roster.tsx`, running on the same loader so the two can
 * be compared on identical numbers. What differs is the arrangement:
 *
 *   - No sidebar. Navigation and the window tabs live in one floating island
 *     centred at the top, which gives the table the full width of the page.
 *   - The stat tiles run as one row of six rather than an unequal grid, and
 *     the leads-per-contract tile carries the rendered dial.
 *   - The people who need you are one line each instead of a card each, so
 *     the whole roster clears the fold.
 *
 * The backdrop is the shell's own field — the same room every other screen
 * sits in, not the animated gradient the original mockup used.
 */

import { useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { signOutClean } from '../lib/api';
import { initials } from '../lib/coachData';
import {
  DEFAULT_LINE, WINDOWS, approachFor, prioritise, useRosterData,
  type Row, type Window,
} from '../lib/rosterData';
import { Strip } from '../components/rosterViz';
import { PersonPane } from '../components/personPane';

export default function RosterDeck({
  orgName, onOpenPulse, onOpenCoach, onOpenRep,
}: {
  orgName: string;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const line = DEFAULT_LINE;
  const [win, setWin] = useState<Window>(WINDOWS[3]);
  const { rows, err, undated, departed, totals } = useRosterData(line, win.days);
  const [open, setOpen] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: 'perContract', dir: -1 });

  const priorities = useMemo(() => (rows ? prioritise(rows) : []), [rows]);
  const strip = useMemo(
    () => (rows ? [...rows].sort((a, b) => b.leads - a.leads) : []),
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

  /* The island carries the mark and the window tabs and nothing else.
     Navigation, the org and sign-out live in the sidebar; putting them here
     too was two of everything. */
  const island = (
    <div className="dk-island">
      <span className="dk-mk"><i>tru</i><b>TRU <em>HQ</em></b></span>
      <span className="dk-div" />
      <span className="dk-win">
        {WINDOWS.map((w) => (
          <button key={w.key} className={w.key === win.key ? 'on' : ''} onClick={() => setWin(w)}>
            {w.label}
          </button>
        ))}
      </span>
    </div>
  );

  const frame = (body: React.ReactNode) => (
    <div className="tru-dark">
      <HqShell
        orgName={orgName}
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep }}
        hideTopbar
      >
        <div className="dk-main">
          {island}
          {body}
        </div>
      </HqShell>
    </div>
  );

  if (err) return frame(<div className="ps-emptyview"><h3>{err}</h3></div>);
  if (!rows || !totals) return frame(<div className="spinner" />);

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

  const top = priorities[0];

  return frame(
    <>
      <header className="dk-mast">
        <div>
          <span className={totals.pastLine > 0 ? 'dk-eyebrow hot' : 'dk-eyebrow'}>
            <i />
            {totals.pastLine > 0
              ? `${totals.pastLine} past your line`
              : priorities.length > 0
                ? `${priorities.length} ${priorities.length === 1 ? 'conversation' : 'conversations'} this week`
                : 'Nobody is past your line'}
          </span>
          <h1>
            {totals.perContract
              ? <>The floor turns one lead in <em>{Math.round(totals.perContract)}</em>.</>
              : <>No contracts in this window yet.</>}
          </h1>
          <p className="dk-sub">
            Your line is one in {line}. <b>{totals.workedPct}%</b> of {totals.leads} leads have been worked
            {totals.workedPct >= 95
              ? <>, so almost nothing is being dropped before the call — what is being lost is being lost on it.</>
              : <>, so {100 - totals.workedPct}% never got a first touch. Start there before coaching anybody on the call.</>}
            {undated > 0 && <> <s className="dk-note">{undated} leads carry no date and sit outside this window.</s></>}
            {departed.names.length > 0 && (
              <> <s className="dk-note">
                Totals include {departed.leads} leads from {departed.names.join(' and ')}, no longer on the team.
              </s></>
            )}
          </p>
        </div>
        {top && (
          <button className="rs-cta" onClick={() => setOpen(top.row)}>
            Prep the 1:1 with {top.row.name.split(' ')[0]}
            <span aria-hidden>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
        )}
      </header>

      <section className="dk-bento">
        <div className="rs-plate dk-tile dk-tile-lead">
          <span className="k">Leads per contract</span>
          <span className="v">{totals.perContract ? '1 : ' + Math.round(totals.perContract) : '—'}</span>
          <span className="u">your line is 1 : {line}</span>
        </div>
        {([
          ['Leads in play', String(totals.leads), 'all sources', 'sea', strip.map((r) => r.leads)],
          ['Worked', totals.workedPct + '%', totals.worked + ' of ' + totals.leads, 'sea', strip.map((r) => r.workedPct)],
          ['Under contract', String(totals.contracts), 'this window', 'amber', strip.map((r) => r.contracts)],
          ['Reached an offer', String(totals.offers), 'this window', 'amber', strip.map((r) => r.offers)],
          ['Still in Lead', String(totals.stuck), totals.stuck ? '48h+ untouched' : 'nothing sitting', 'ember', strip.map((r) => r.stuck)],
        ] as const).map(([k, v, u, tone, values]) => (
          <div className="rs-plate dk-tile" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
            <Strip values={values} tone={tone} />
            <span className="u">{u}</span>
          </div>
        ))}
      </section>

      <div className="dk-sec">
        <h2>The roster</h2>
        <p>
          {priorities.length === 0
            ? 'Nobody needs you this week.'
            : `${priorities.length} need you · ${totals.stale} past thirty days without a 1:1`}
        </p>
        <span className="dk-key">
          <s className="rs-key team" /> the team{totals.perContract ? ` at 1 : ${Math.round(totals.perContract)}` : ''}
          <s className="rs-key line" /> your line at 1 : {line}
        </span>
      </div>

      {priorities.length > 0 && (
        <div className="dk-focus">
          {priorities.map((p) => (
            <article
              key={p.row.name}
              className={p.severity === 'high' ? 'dk-fr crit' : 'dk-fr'}
              tabIndex={0}
              onClick={() => setOpen(p.row)}
              onKeyDown={(e) => { if (e.key === 'Enter') setOpen(p.row); }}
            >
              <span className={'rs-av h-' + p.row.health}>{initials(p.row.name)}</span>
              <span className="dk-fr-name">{p.row.name}</span>
              <span className="dk-fr-why">{p.reason}</span>
              <span className="dk-fr-do">{p.action}</span>
            </article>
          ))}
        </div>
      )}

      <div className="rs-plate dk-table">
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
            {sorted.map((r, i) => (
              <tr key={r.name}
                  className={priorities.some((p) => p.row.name === r.name) ? 'rowlink crit' : 'rowlink'}
                  tabIndex={0}
                  style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r); }}>
                <td>
                  <div className="rs-who">
                    <span className={'rs-av h-' + r.health}>{initials(r.name)}</span>
                    <div>
                      <div className="cell-name">{r.name}</div>
                      <div className="rs-sub2">{r.archName ?? 'Not assessed'}</div>
                    </div>
                  </div>
                </td>
                <td>{r.leads}</td>
                <td className={r.workedPct < 90 ? 'cell-warn' : ''}>{r.workedPct}%</td>
                <td className={r.stuck > 10 ? 'cell-warn' : ''}>{r.stuck || '—'}</td>
                <td>{r.offers || '—'}</td>
                <td>{r.contracts || '—'}</td>
                <td>
                  <div className="rs-rate">
                    <b className={r.health === 'past-line' ? 'cell-warn' : ''}>
                      {r.perContract ? '1 : ' + Math.round(r.perContract) : '—'}
                    </b>
                    <span className="rs-scale">
                      <hr />
                      {totals.perContract && <s style={{ left: scale(totals.perContract) + '%' }} />}
                      <u style={{ left: scale(line) + '%' }} />
                      {r.perContract !== null && (
                        <i style={{ left: scale(r.perContract) + '%' }} className={'h-' + r.health} />
                      )}
                    </span>
                  </div>
                </td>
                <td className={r.lastDays !== null && r.lastDays > 45 ? 'cell-warn' : ''}>
                  {r.lastDays === null ? 'never' : r.lastDays + 'd'}
                </td>
                <td><span className={'rs-tag h-' + r.health}>{
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
              <td><b>{totals.perContract ? '1 : ' + Math.round(totals.perContract) : '—'}</b></td>
              <td><b>{totals.stale} stale</b></td><td />
            </tr>
          </tfoot>
        </table>
      </div>

      <PersonPane row={open} onClose={() => setOpen(null)} approach={open ? approachFor(open) : null} />
    </>,
  );
}
