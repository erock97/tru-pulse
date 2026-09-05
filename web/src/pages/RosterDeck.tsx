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
 *
 * The six tiles and the table are ONE instrument now rather than two pictures
 * of the same team (see components/deckFocus.tsx). Point at a row and that
 * agent's dot swells on the scale and says its name, and their bar lights in
 * all five strips. The arrow keys walk the roster and the dot walks with
 * them. `p` holds a person lit so the rest of the page can be read against
 * them.
 */

import { useMemo, useRef, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { signOutClean } from '../lib/api';
import { initials } from '../lib/coachData';
import {
  DEFAULT_LINE, WINDOWS, approachFor, prioritise, useRosterData,
  type Row, type Window,
} from '../lib/rosterData';
import { Strip } from '../components/rosterViz';
import { ScaleMarks } from '../components/scaleMarks';
import { PersonPane } from '../components/personPane';
import {
  DeckFocusProvider, focusBinding, useDeckFocus, useDeckKeys, useRounded,
} from '../components/deckFocus';
import { TargetControl, useSavedTarget } from '../components/TargetControl';
import { Odometer } from '../components/odometer';
import { useFlip, useGlide } from '../lib/deckMotion';

export default function RosterDeck(props: {
  orgId: string;
  orgName: string;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  // The provider wraps the shell as well as the page, so the tiles, the marks
  // and the table all sit inside one focus scope rather than three.
  return (
    <DeckFocusProvider>
      <Deck {...props} />
    </DeckFocusProvider>
  );
}

function Deck({
  orgId, orgName, onOpenPulse, onOpenCoach, onOpenRep,
}: {
  orgId: string;
  orgName: string;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  /* The threshold every agent on this page is judged against. It was a
     constant; it is state now, because the marker on the lead tile's scale can
     be dragged. Nothing is written anywhere — `useRosterData` already takes
     the line as a parameter and re-derives from the data it has, so moving it
     re-judges the whole page without a request. It is a question you can ask
     of today's numbers, not a setting you are changing. */
  const target = useSavedTarget(orgId, 'leads-per-contract', DEFAULT_LINE);
  const { value: line, setValue: setLine } = target;
  const [win, setWin] = useState<Window>(WINDOWS[3]);
  const { rows, err, undated, departed, totals } = useRosterData(line, win.days);
  const [open, setOpen] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: 'perContract', dir: -1 });
  const focus = useDeckFocus();

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

  /* Rows travel to their new place when you sort, rather than the table
     redrawing. The order itself is the signature, so re-sorting to the same
     order — which is what a window change does — correctly moves nothing. */
  const tableRef = useRef<HTMLDivElement | null>(null);
  useFlip(tableRef, sorted.map((r) => r.name).join('|'));

  /* Every figure in the table changes when the window does, and until now they
     all changed silently while the tiles above them rolled. This counter
     advances ONLY on a window change; re-keying a cell on it remounts a small
     span and replays one CSS animation, so the new numbers drop into place in
     a wave down the roster.
     It starts at zero and the cells only wear the class once it has moved, so
     the very first paint is left to the row entrance it already has — two
     entrances at once on arrival read as a stutter, which is the exact mistake
     the page transition was built to fix. */
  const gen = useRef(0);
  const lastWin = useRef(win.key);
  if (lastWin.current !== win.key) { lastWin.current = win.key; gen.current += 1; }
  const cell = (value: React.ReactNode, rowIndex: number) => (
    gen.current === 0
      ? value
      : <span className="cell-roll" key={gen.current} style={{ '--r': Math.min(rowIndex, 14) } as React.CSSProperties}>{value}</span>
  );

  /* Up and down walk the roster, and because walking POINTS at each person in
     turn, the dot travels along the scale beside you. Enter opens them, `p`
     holds them lit, Escape lets go — or closes the panel if one is open. */
  useDeckKeys({
    keys: sorted.map((r) => r.name),
    onOpen: (name) => setOpen(sorted.find((r) => r.name === name) ?? null),
    onEscape: () => setOpen(null),
    enabled: !!rows,
    // `f` sends the rest of the page away. Only offered when there is somebody
    // to be left alone with — dimming a page down to nothing is not a feature.
    canQuiet: priorities.length > 0,
  });

  // The headline rate travels between windows rather than being swapped, so 30
  // days and 90 days read as one team measured over a different stretch of
  // time — which is what actually happened.
  const rateShown = useRounded(totals?.perContract ?? null);

  /* Just the window tabs now — the shell draws the bar.
     The lit pill is one element that travels between them rather than a
     highlight that blinks out here and in over there. This is the control that
     changes every figure on the page, so the selection moving is the first
     half of the answer; the numbers rolling underneath is the second. */
  const winRef = useRef<HTMLSpanElement | null>(null);
  const winGlide = useGlide(winRef, 'button.on', 'x', win.key);
  const windowTabs = (
    <span className="dk-win" ref={winRef}>
      <i className="dk-win-glide" style={winGlide} aria-hidden />
      {WINDOWS.map((w) => (
        <button key={w.key} className={w.key === win.key ? 'on' : ''} onClick={() => setWin(w)}>
          {w.label}
        </button>
      ))}
    </span>
  );

  const frame = (body: React.ReactNode) => (
    <div className="tru-dark">
      <HqShell
        orgName={orgName}
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep, onOpenTeam: () => { window.location.hash = '/team'; } }}
        hideTopbar
        islandSlot={windowTabs}
        // The room warms with the floor: ember once somebody is past your line,
        // amber while there are conversations owed, sea when nobody needs you.
        mood={!totals ? 'calm' : totals.pastLine > 0 ? 'hot' : priorities.length > 0 ? 'watch' : 'calm'}
      >
        <div className="dk-main">
          {body}
        </div>
      </HqShell>
    </div>
  );

  if (err) return frame(<div className="ps-emptyview"><h3>{err}</h3></div>);
  if (!rows || !totals) return frame(<div className="spinner" />);

  // Fit the axis to what is actually on screen, with a little air either side,
  // so the dots spread across the bar instead of bunching at one end.
  //
  // Anchored on DEFAULT_LINE rather than on the LIVE line, which matters now
  // that the line can be dragged: an axis that rescaled as you moved the
  // marker would slide the marker out from under the cursor, and the control
  // would feel like it was resisting you.
  const rates = rows.map((r) => r.perContract).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.min(DEFAULT_LINE, target.saved, ...rates) - 4);
  const hi = Math.max(DEFAULT_LINE, target.saved, ...rates) + 6;
  const scale = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));

  const resort = (key: keyof Row) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));

  const th = (key: keyof Row, label: string) => (
    <th
      className={`sortable${sort.key === key ? ' on' : ''}`}
      tabIndex={0}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => resort(key)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resort(key); } }}
    >
      {/* The caret used to appear only on the column already sorting, so every
          other header read as a label and nobody clicked one. It is on all of
          them now, and shows itself faintly under the cursor. */}
      {label}<span className="sortcaret">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '▾'}</span>
    </th>
  );

  // Every supporting tile draws the same team in the same order, so a bar in
  // one lines up with the bar directly under it in the next.
  const stripKeys = strip.map((r) => r.name);
  /* Every tile summarises a column of the table underneath it, so every tile
     is also the control for that column. Click one and the roster re-ranks by
     it. The bento stops being a read-only headline and becomes the table's
     control surface — which is what a leader is reaching for anyway when they
     look at "Still in Lead: 12" and want to know who. */
  const tiles: Array<{
    k: string; n: number; suffix?: string; u: string; sortKey: keyof Row;
    tone: string; values: number[]; say: (r: Row) => string;
  }> = [
    { k: 'Leads in play', n: totals.leads, u: 'all sources', tone: 'sea', sortKey: 'leads',
      values: strip.map((r) => r.leads), say: (r) => `${r.name} · ${r.leads} leads` },
    { k: 'Worked', n: totals.workedPct, suffix: '%', u: `${totals.worked} of ${totals.leads}`, tone: 'sea', sortKey: 'workedPct',
      values: strip.map((r) => r.workedPct), say: (r) => `${r.name} · ${r.workedPct}% worked` },
    { k: 'Under contract', n: totals.contracts, u: 'this window', tone: 'amber', sortKey: 'contracts',
      values: strip.map((r) => r.contracts), say: (r) => `${r.name} · ${r.contracts} under contract` },
    { k: 'Reached an offer', n: totals.offers, u: 'this window', tone: 'amber', sortKey: 'offers',
      values: strip.map((r) => r.offers), say: (r) => `${r.name} · ${r.offers} reached an offer` },
    { k: 'Still in Lead', n: totals.stuck, u: totals.stuck ? '48h+ untouched' : 'nothing sitting', tone: 'ember', sortKey: 'stuck',
      values: strip.map((r) => r.stuck), say: (r) => `${r.name} · ${r.stuck} still in Lead` },
  ];

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
              ? <>One contract per <em>{rateShown ?? Math.round(totals.perContract)}</em> leads.</>
              : <>No contracts in this window yet.</>}
          </h1>
          <p className="dk-sub">
            Your target is one contract per {line} leads. <b>{totals.workedPct}%</b> of {totals.leads} leads are marked worked.
            {' '}Use the signals below to decide what to review; conversation quality needs interaction evidence.
            {undated > 0 && <> <s className="dk-note">{undated} leads carry no date and sit outside this window.</s></>}
            {departed.names.length > 0 && (
              <> <s className="dk-note">
                Totals include {departed.leads} leads from {departed.names.join(' and ')}, no longer on the team.
              </s></>
            )}
          </p>
        </div>
      </header>

      <section className="dk-bento">
        <div className="rs-plate dk-tile dk-tile-lead">
          {/* The heading sorts; the scale below it does NOT, because the scale
              is a drag target and a click that both re-ranked the table and
              moved your line would be two answers to one gesture. */}
          <span
            className={`k k-do${sort.key === 'perContract' ? ' is-sorting' : ''}`}
            role="button"
            tabIndex={0}
            title="Rank the roster by leads per contract"
            onClick={() => resort('perContract')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resort('perContract'); } }}
          >Leads per contract</span>
          <span className="v"><Odometer value={totals.perContract} prefix="1 : " /></span>
          {/* One dot per agent, on the same scale as your line. The light comes
              from the room behind this card; the card only has to be true.
              Every dot knows whose it is now, so pointing at one — with the
              cursor, or with the arrow keys from the table — names them. */}
          <ScaleMarks
            lo={lo} hi={hi} line={line}
            lineLabel={`Target · 1 : ${line}`}
            onLineChange={setLine}
            lineName={`your line, currently one in ${line}`}
            marks={rows.map((r) => ({
              key: r.name,
              value: r.perContract,
              label: r.name,
              reading: r.perContract ? `1 : ${Math.round(r.perContract)}` : undefined,
              tone: r.health === 'past-line' ? 'bad'
                : r.health === 'behind' ? 'warn'
                  : r.health === 'holding' ? 'ok' : 'none',
            }))}
          />
          <TargetControl target={target} label="Leads per contract" defaultValue={DEFAULT_LINE} />
        </div>
        {tiles.map((t) => (
          <div
            className={`rs-plate dk-tile dk-tile-do${sort.key === t.sortKey ? ' is-sorting' : ''}`}
            key={t.k}
            role="button"
            tabIndex={0}
            aria-pressed={sort.key === t.sortKey}
            title={`Rank the roster by ${t.k.toLowerCase()}`}
            onClick={() => resort(t.sortKey)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resort(t.sortKey); } }}
          >
            <span className="k">{t.k}</span>
            <span className="v"><Odometer value={t.n} suffix={t.suffix} /></span>
            <Strip
              values={t.values}
              tone={t.tone}
              keys={stripKeys}
              labels={strip.map(t.say)}
              onPick={(name) => setOpen(rows.find((r) => r.name === name) ?? null)}
            />
            <span className="u">{t.u}</span>
            <span className="dk-tile-rank" aria-hidden>
              {sort.key === t.sortKey ? (sort.dir === 1 ? 'ranking ▲' : 'ranking ▼') : 'rank by this'}
            </span>
          </div>
        ))}
      </section>

      <div className="dk-sec">
        <h2>The roster</h2>
        <p>
          {priorities.length === 0
            ? 'No priority signals in this view.'
            : `${priorities.length} need you · ${totals.stale} past thirty days without a 1:1`}
        </p>
        <span className="dk-key">
          {focus.quiet ? (
            <span className="dk-quiet-out">
              Just the {priorities.length} who need you
              <button onClick={() => focus.setQuiet(false)}>Bring it back</button>
            </span>
          ) : focus.pinned ? (
            <span className="dk-pinned">
              Holding {focus.pinned}
              <button onClick={() => focus.pin(null)}>Let go</button>
            </span>
          ) : (
            <span className="dk-keys">
              <kbd>↑</kbd><kbd>↓</kbd> <b>walk</b>
              <kbd>↵</kbd> <b>open</b>
              <kbd>P</kbd> <b>hold</b>
              {priorities.length > 0 && <><kbd>F</kbd> <b>just these</b></>}
            </span>
          )}
          <s className="rs-key team" /> the team{totals.perContract ? ` at 1 : ${Math.round(totals.perContract)}` : ''}
          <s className="rs-key line" /> your line at 1 : {line}
        </span>
      </div>

      {priorities.length > 0 && (
        <div className="dk-focus">
          {priorities.map((p) => (
            <article
              key={p.row.name}
              className={[
                'dk-fr',
                p.severity === 'high' ? 'crit' : '',
                focus.active === p.row.name ? 'is-on' : '',
              ].filter(Boolean).join(' ')}
              tabIndex={0}
              {...focusBinding(p.row.name, focus)}
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

      <div className="rs-plate dk-table" ref={tableRef}>
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
                  data-flip={r.name}
                  className={[
                    'rowlink',
                    priorities.some((p) => p.row.name === r.name) ? 'crit' : '',
                    focus.active === r.name ? 'is-on' : '',
                    focus.pinned === r.name ? 'is-pinned' : '',
                  ].filter(Boolean).join(' ')}
                  tabIndex={0}
                  style={{ animationDelay: `${Math.min(i, 8) * 18}ms` }}
                  {...focusBinding(r.name, focus)}
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
                <td>{cell(r.leads, i)}</td>
                <td className={r.workedPct < 90 ? 'cell-warn' : ''}>{cell(`${r.workedPct}%`, i)}</td>
                <td className={r.stuck > 10 ? 'cell-warn' : ''}>{cell(r.stuck || '—', i)}</td>
                <td>{cell(r.offers || '—', i)}</td>
                <td>{cell(r.contracts || '—', i)}</td>
                <td>
                  <div className="rs-rate">
                    <b className={r.health === 'past-line' ? 'cell-warn' : ''}>
                      {cell(r.perContract ? '1 : ' + Math.round(r.perContract) : '—', i)}
                    </b>
                    {/* Placed by `--at` rather than by `left`, exactly like the
                        big scale in the lead tile — so changing the window
                        slides every mark in the table to its new place instead
                        of redrawing the column. That travel IS the table
                        registering the change. */}
                    <span className="rs-scale">
                      <hr />
                      {totals.perContract && <s style={{ '--at': scale(totals.perContract) } as React.CSSProperties} />}
                      <u style={{ '--at': scale(line) } as React.CSSProperties} />
                      {r.perContract !== null && (
                        <i style={{ '--at': scale(r.perContract) } as React.CSSProperties} className={'h-' + r.health} />
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

      <PersonPane
        row={open}
        onClose={() => setOpen(null)}
        approach={open ? approachFor(open) : null}
        line={line}
        teamRate={totals.perContract}
      />
    </>,
  );
}
