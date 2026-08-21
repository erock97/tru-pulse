/**
 * Pulse — the roster, sidebar layout.
 *
 * The page answers one question: who do I need to talk to, and why. It opens
 * with a short priority list, then the numbers behind it, then the whole
 * roster.
 *
 * `RosterDeck.tsx` is the same page arranged differently, and both read from
 * `lib/rosterData.ts` — a comparison running on two loaders is not a
 * comparison.
 */

import { useMemo, useState } from 'react';

import { useReveal } from '../hqHooks';
import { HqShell } from '../components/hqShell';
import { PersonPane } from '../components/personPane';
import { Burst, Strip } from '../components/rosterViz';
import { signOutClean } from '../lib/api';
import { initials } from '../lib/coachData';
import {
  DEFAULT_LINE, WINDOWS, approachFor, prioritise, totalsOf, useRosterData,
  type Row, type Window,
} from '../lib/rosterData';

export default function Roster({
  orgName, onOpenPulse, onOpenCoach, onOpenRep,
}: {
  orgName: string;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const line = DEFAULT_LINE;
  const [win, setWin] = useState<Window>(WINDOWS[3]);
  const { rows, err, undated } = useRosterData(line, win.days);
  const [open, setOpen] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: 'perContract', dir: -1 });

  // The shell's heading is a `.reveal` element and stays hidden until this runs.
  useReveal([rows]);

  const totals = useMemo(() => (rows ? totalsOf(rows) : null), [rows]);
  const priorities = useMemo(() => (rows ? prioritise(rows) : []), [rows]);

  // One fixed order for every strip, so the four cards are comparable to each
  // other rather than each being sorted by its own metric.
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

  const top = priorities[0];
  const context = (
    <>
      <span className="dk-win">
        {WINDOWS.map((w) => (
          <button key={w.key} className={w.key === win.key ? 'on' : ''} onClick={() => setWin(w)}>
            {w.label}
          </button>
        ))}
      </span>
      {top && (
        // Button-in-button: the arrow never sits naked beside the label.
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
    </>
  );

  const wrap = (body: React.ReactNode, title: string) => (
    <div className="tru-dark">
      <HqShell
        orgName={orgName}
        eyebrow={`${orgName} · ${win.days === null ? 'all time' : `last ${win.days} days`}`}
        title={title}
        context={context}
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep }}
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
        {/* The headline states a number; this says what it means and what it
            rules out. Without it a lead has to work that out themselves every
            single week, which is the job the page is supposed to do for them. */}
        <p className="rs-lede">
          {totals.perContract
            ? <>The team runs <b>one in {Math.round(totals.perContract)}</b> against your line of one in {line}. </>
            : <>Nobody has taken a contract in this window, so there is no rate to read yet. </>}
          <b>{totals.workedPct}%</b> of {totals.leads} leads have been worked
          {totals.workedPct >= 95
            ? <>, so almost nothing is being dropped before the call — what is being lost is being lost on it.</>
            : <>, so {100 - totals.workedPct}% never got a first touch. Start there before coaching anybody on the call.</>}
          {undated > 0 && <> <s className="dk-note">{undated} leads carry no date and sit outside this window.</s></>}
        </p>

        {/* Unequal on purpose. A row of six identical cards is the pattern
            that reads as generated; these are one lead card, one alert card,
            and four supporting ones sharing the remaining width. */}
        <div className="rs-stats">
          <div className="rs-plate rs-stat rs-s-lead">
            <Burst rows={rows} line={line} />
            <span className="k">Leads per contract</span>
            <span className="v">{totals.perContract ? '1 : ' + Math.round(totals.perContract) : '—'}</span>
            <span className="u">your line is 1 : {line}</span>
          </div>
          <div className={totals.pastLine > 0 ? 'rs-plate rs-stat rs-s-alert hot' : 'rs-plate rs-stat rs-s-alert'}>
            <span className="k">Past your line</span>
            <span className="v">{totals.pastLine}</span>
            <span className="u">{totals.stale ? totals.stale + ' stale 1:1s' : 'nobody drifting'}</span>
          </div>
          {([
            ['rs-s-a', 'Leads in play', String(totals.leads), 'all sources', 'sea', strip.map((r) => r.leads)],
            ['rs-s-b', 'Worked', totals.workedPct + '%', totals.worked + ' of ' + totals.leads, 'sea', strip.map((r) => r.workedPct)],
            ['rs-s-c', 'Under contract', String(totals.contracts), 'this window', 'amber', strip.map((r) => r.contracts)],
            ['rs-s-d', 'Still in Lead', String(totals.stuck), totals.stuck ? '48h+ untouched' : 'nothing sitting', 'ember', strip.map((r) => r.stuck)],
          ] as const).map(([cls, k, v, u, tone, values]) => (
            <div className={'rs-plate rs-stat ' + cls} key={k}>
              <span className="k">{k}</span>
              <span className="rs-stat-row">
                <span className="v">{v}</span>
                <Strip values={values} tone={tone} />
              </span>
              <span className="u">{u}</span>
            </div>
          ))}
        </div>

        {priorities.length > 0 && (
          <div className="rs-focus">
            {priorities.map((p, i) => (
              <article
                key={p.row.name}
                className={p.severity === 'high' ? 'rs-plate rs-fr crit' : 'rs-plate rs-fr'}
                tabIndex={0}
                onClick={() => setOpen(p.row)}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(p.row); }}
              >
                <span className={'rs-av h-' + p.row.health}>{initials(p.row.name)}</span>
                <div className="rs-fr-body">
                  <div className="rs-fr-top">
                    <span className="rs-fr-name">{p.row.name}</span>
                    <span className="rs-fr-idx">{i + 1} of {priorities.length}</span>
                  </div>
                  <p className="rs-fr-why">{p.reason}</p>
                  <p className="rs-fr-do"><b>Do:</b> {p.action}{p.approach ? <em> {p.approach}</em> : null}</p>
                </div>
              </article>
            ))}
          </div>
        )}

        {priorities.length === 0 && (
          <div className="rs-plate rs-clear">
            <i />
            <p>
              <b>Nothing needs you in this window.</b> Every agent is inside one in {line},
              everyone has had a 1:1 in the last 45 days, and no lead has been left untouched.
            </p>
          </div>
        )}

        <div className="rs-restbar">
          <span>The rest of the floor</span>
          <span className="rs-restbar-note">
            bar is leads per contract &middot; <s className="rs-key team" /> the team
            {totals.perContract ? ` at 1 : ${Math.round(totals.perContract)}` : ''} &middot;{' '}
            <s className="rs-key line" /> your line at 1 : {line}
          </span>
        </div>

        <div className="rs-plate rs-table">
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
              {sorted.filter((r) => !priorities.some((p) => p.row.name === r.name)).map((r) => (
                <tr key={r.name} className="rowlink" tabIndex={0}
                    onClick={() => setOpen(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r); }}>
                  <td>
                    <div className="rs-who">
                      <span className={'rs-av h-' + r.health}>{initials(r.name)}</span>
                      <div>
                        <div className="cell-name">{r.name}</div>
                        <div className="rs-sub2">{r.archName ?? 'Not assessed'} &middot; {r.leads} leads</div>
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
                        {/* two references, not one: where the team sits, and
                            where your line is. "behind team" was a tag with
                            nothing on screen to check it against. */}
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
      </div>

      <PersonPane row={open} onClose={() => setOpen(null)} approach={open ? approachFor(open) : null} />
    </>,
    priorities.length === 0
      ? 'Nobody is past your line.'
      : `${priorities.length} ${priorities.length === 1 ? 'conversation' : 'conversations'} this week.`,
  );
}
