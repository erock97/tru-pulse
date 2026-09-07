import './pauseRecommendation.css';
import { ConversionComparison } from '../components/ConversionComparison';
import { ContactSpeedPanel } from '../components/ContactSpeedPanel';
import { HustlePanel } from '../components/HustlePanel';
import { pauseRecommendation } from '../lib/pauseRecommendation';
import { ProductionPanel } from '../components/ProductionPanel';
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

import { useEffect, useMemo, useRef, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { PeriodSelect } from '../components/PeriodSelect';
import { signOutClean, isDemo, workerFetch } from '../lib/api';
import { initials } from '../lib/coachData';
import {
  DEFAULT_LINE, WINDOWS, PERIOD_OPTIONS, prioritise, useRosterData,
  type Row, type Window,
} from '../lib/rosterData';
import { PulseProof } from '../components/PulseProof';
import { norm } from '../lib/rosterData';
import {
  DeckFocusProvider, focusBinding, useDeckFocus, useDeckKeys,
} from '../components/deckFocus';
import { contractRateLabel, contractSortValue } from '../lib/minimumExpectation';
import { TargetControl, useSavedTarget } from '../components/TargetControl';
import { useFlip } from '../lib/deckMotion';

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
  const line = target.saved;
  const pauseTarget = useSavedTarget(orgId, 'mtd-new-assignment-pause', 15);
  const [assignmentCounts,setAssignmentCounts]=useState<Map<string,number>>(new Map());
  const [assignmentStatus,setAssignmentStatus]=useState('Connecting live assignment history...');
  useEffect(()=>{let active=true;setAssignmentCounts(new Map());
    const refresh=async()=>{try{const response=await workerFetch(`/data/assignments?orgId=${encodeURIComponent(orgId)}&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);if(!response.ok)throw Error();const data=await response.json() as {reports:{agents:{agentName:string;count:number}[];lastSyncAt:string|null;uncertain:number}[]};if(!active)return;if(data.reports.some(r=>!r.lastSyncAt))void workerFetch(`/data/assignments/initialize?orgId=${encodeURIComponent(orgId)}`,{method:'POST'});const counts=new Map<string,number>();for(const report of data.reports)for(const a of report.agents)counts.set(norm(a.agentName),(counts.get(norm(a.agentName))||0)+a.count);setAssignmentCounts(counts);setAssignmentStatus(data.reports.some(r=>r.lastSyncAt)?'Live assignment tracking is active. Counts include confirmed assignments this month; older assignments with uncertain dates are excluded.':'Waiting for the first connected assignment sync.');}catch{if(active){setAssignmentCounts(new Map());setAssignmentStatus('Live assignment counts could not be loaded.');}}};
    void refresh();const timer=setInterval(refresh,60000);return()=>{active=false;clearInterval(timer);};
  },[orgId]);
  const [mode,setMode] = useState<'cohort'|'production'|'hustle'|'speed'>('cohort');
  const [hasHustle,setHasHustle]=useState(isDemo);
  useEffect(()=>{if(isDemo)return;let active=true;setHasHustle(false);workerFetch(`/data/hustle?orgId=${encodeURIComponent(orgId)}`).then(async r=>r.ok?await r.json() as {scores:unknown[]}:null).then(d=>{if(active)setHasHustle(!!d?.scores.length);}).catch(()=>{});return()=>{active=false;};},[orgId]);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [win, setWin] = useState<Window>(WINDOWS[1]);
  const { rows, err, undated, departed, totals, proof, teams, historyInfo } = useRosterData(line, win.days, orgId);
  const overall = useRosterData(line, null, orgId);
  const overallByName = new Map((overall.rows ?? []).map(row=>[norm(row.name),row]));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: 'perContract', dir: -1 });
  const focus = useDeckFocus();

  const priorities = useMemo(() => (overall.rows ? prioritise(overall.rows) : []), [overall.rows]);
  const sorted = useMemo(() => {
    if (!rows) return [];
    return rows.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()) && (!reviewOnly || priorities.some(p=>p.row.name===r.name))).sort((a, b) => {
      const x = sort.key === 'perContract' ? contractSortValue(overallByName.get(norm(a.name))) : a[sort.key], y = sort.key === 'perContract' ? contractSortValue(overallByName.get(norm(b.name))) : b[sort.key];
      if (x === y) return 0;
      if (x === null) return 1;          // no-volume always sits at the bottom
      if (y === null) return -1;
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * sort.dir * -1;
      }
      return ((y as number) - (x as number)) * sort.dir;
    });
  }, [rows, sort, query, reviewOnly, priorities, overall.rows]);

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

  // Keep roster focus navigation; rows no longer open a drawer.
  useDeckKeys({
    keys: sorted.map((r) => r.name),
    enabled: !!rows,
    // `f` sends the rest of the page away. Only offered when there is somebody
    // to be left alone with — dimming a page down to nothing is not a feature.
    canQuiet: priorities.length > 0,
  });

  // The headline rate travels between windows rather than being swapped, so 30
  // days and 90 days read as one team measured over a different stretch of
  // time — which is what actually happened.


  // Keep the selected reporting period visible without a crowded button row.
  const windowTabs = (
    <PeriodSelect value={win.key} options={PERIOD_OPTIONS} onChange={key=>setWin(WINDOWS.find(w=>w.key===key)!)} />
  );

  const frame = (body: React.ReactNode) => (
    <div className="tru-dark pulse-refined">
      <HqShell
        orgName={orgName}
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep, onOpenTeam: () => { window.location.hash = '/team'; } }}
        hideTopbar
        islandSlot={mode === 'speed' || mode === 'hustle' ? undefined : windowTabs}
        // The room warms with the floor: ember once somebody is past your line,
        // amber while there are conversations owed, sea when nobody needs you.
        mood={!totals ? 'calm' : (overall.totals?.pastLine ?? 0) > 0 ? 'hot' : priorities.length > 0 ? 'watch' : 'calm'}
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

  return frame(
    <>
      <header className="pulse-heading"><div><span className="pulse-kicker">Pulse</span><h1>Team performance.</h1><p>{mode === 'speed' ? 'Verified personal outreach, with the calculation behind each result' : mode === 'hustle' ? 'Latest published weekly report' : 'Lead cohorts and recorded production · ' + win.label + ' view'}</p></div><div className="pulse-thresholds"><details className="pulse-target"><summary>Minimum expectation <strong>1 : {line}</strong><span>Edit</span></summary><TargetControl target={target} label="Maximum leads per contract" defaultValue={DEFAULT_LINE} /></details><details className="pulse-target"><summary>Leads before pause <strong>{pauseTarget.saved}</strong><span>Edit</span></summary><TargetControl target={pauseTarget} label="New assignments per agent · month to date" defaultValue={15} /><p className="pause-setting-note">Review for pause when the agent reaches this count. Saving this setting does not pause anyone in Zillow. {assignmentStatus}</p></details></div></header>
      {historyInfo&&<p className="pulse-data-notes">Verified history through {historyInfo.through} · Active roster at collection. Sources: {Object.entries(historyInfo.sourceStarts).map(([source,start])=>source+' since '+start).join('; ')}. New activity after this snapshot is not included.</p>}<div className="operations-tabs"><button aria-pressed={mode==='speed'} onClick={()=>setMode('speed')}>Contact timing</button><button aria-pressed={mode==='cohort'} onClick={()=>setMode('cohort')}>Lead cohorts</button><button aria-pressed={mode==='production'} onClick={()=>setMode('production')}>Recorded production</button>{hasHustle&&<button aria-pressed={mode==='hustle'} onClick={()=>setMode('hustle')}>Weekly Hustle</button>}<button onClick={()=>{window.location.hash='/earnings';}}>Earnings ↗</button></div>{mode === 'speed' ? <ContactSpeedPanel orgId={orgId}/> : mode === 'hustle' ? <HustlePanel orgId={orgId}/> : mode === 'production' ? <ProductionPanel period={win.days} orgId={orgId}/> : <><section className="pulse-summary" aria-label="Team performance summary">
        <div><span>Leads</span><strong>{totals.leads.toLocaleString()}</strong><small>Created in this reporting window</small></div>
        <div><span>Reached an offer</span><strong>{totals.offers.toLocaleString()}</strong><small>Among leads created in this window</small></div>
        <div><span>Under contract</span><strong>{totals.contracts.toLocaleString()}</strong><small>Among leads created in this window</small></div>
        <div><span>Overall leads per contract</span>{overall.totals?<ConversionComparison current={overall.totals} leads={[...overall.proof.values()].flat()} history={overall.historyInfo} period={win.days} through={overall.historyInfo?.through}/>:<strong>{overall.err?'Unavailable':'Loading…'}</strong>}<small>Minimum: 1 contract per {line} leads</small></div>
      </section>
      <div className="pulse-roster-tools"><div><h2>Your agents</h2><span>{sorted.length} of {rows.length} shown</span></div><div className="pulse-filter-controls"><button aria-pressed={!reviewOnly} onClick={()=>setReviewOnly(false)}>All agents</button><button aria-pressed={reviewOnly} onClick={()=>setReviewOnly(true)}>Review signals <span>{priorities.length}</span></button><input aria-label="Find an agent in Pulse" placeholder="Find an agent…" value={query} onChange={e=>setQuery(e.target.value)} /></div></div>
      <div className="rs-plate dk-table" ref={tableRef}>
        <table className="tru-table">
          <thead>
            <tr>
              {th('name', 'Agent')}{th('leads', 'Leads')}
              {th('offers', 'Offers')}{th('contracts', 'Under contract')}{th('closed', 'Closed')}
              {th('perContract', 'Overall leads per contract')}{th('rawConversion', 'Raw conversion')}{th('lastDays', 'Last 1:1')}
            </tr>
          </thead>
          <tbody>
            {query.trim() && !sorted.length && <tr><td colSpan={8}>No agents match “{query}”. <button className="brief-open" onClick={()=>setQuery('')}>Clear search</button></td></tr>}
            {sorted.map((r, i) => (
              <tr key={r.name}
                  data-flip={r.name}
                  className={[

                    focus.active === r.name ? 'is-on' : '',
                    focus.pinned === r.name ? 'is-pinned' : '',
                  ].filter(Boolean).join(' ')}
                  tabIndex={0}
                  style={{ animationDelay: `${Math.min(i, 8) * 18}ms` }}
                  {...focusBinding(r.name, focus)}
                  >
                <td>
                  <div className="rs-who">
                    <span className={'rs-av h-' + (overallByName.get(norm(r.name))?.health ?? 'no-volume')}>{initials(r.name)}</span>
                    <div>
                      <span className="cell-name">{r.name}</span>
                      {pauseRecommendation(overallByName.get(norm(r.name)),target.ready?line:null,assignmentCounts.get(norm(r.name))??null,pauseTarget.ready?pauseTarget.saved:null) && <a className="pulse-pause-recommendation" href="https://premieragent.zillow.com/leads/routing/routing" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>{pauseRecommendation(overallByName.get(norm(r.name)),target.ready?line:null,assignmentCounts.get(norm(r.name))??null,pauseTarget.ready?pauseTarget.saved:null)} ↗</a>}
                      <PulseProof row={r} leads={proof.get(norm(r.name)) ?? []} teams={teams} />
                      <div className="pulse-row-reason">{!pauseRecommendation(overallByName.get(norm(r.name)),target.ready?line:null,null,null) && priorities.find(p=>p.row.name===r.name)?.reason}</div>
                    </div>
                  </div>
                </td>
                <td>{cell(r.leads, i)}</td>
                
                <td>{cell(r.offers, i)}</td>
                <td>{cell(r.contracts, i)}</td><td>{cell(r.closed??0, i)}</td>
                <td>
                  <div className="rs-rate">
                    {overallByName.has(norm(r.name))?<ConversionComparison current={overallByName.get(norm(r.name))!} leads={overall.proof.get(norm(r.name)) ?? []} history={overall.historyInfo} period={win.days} through={overall.historyInfo?.through}/>:<span>{overall.err?'Unavailable':'Loading…'}</span>}
                  </div>
                </td>
                <td title={`${r.contracts} leads that reached under contract or closed ÷ ${r.leads} leads`}>{r.leads ? (r.rawConversion??0).toFixed(1)+'%' : '—'}</td>
                <td className={r.lastDays !== null && r.lastDays > 45 ? 'cell-warn' : ''}>
                  {r.lastDays === null ? <span className="pulse-missing">Not recorded</span> : r.lastDays + 'd ago'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Full team total</td><td><b>{totals.leads}</b></td>
              <td><b>{totals.offers}</b></td><td><b>{totals.contracts}</b></td><td><b>{totals.closed}</b></td>
              <td><b>{overall.totals?contractRateLabel(overall.totals.perContract,overall.totals.leads):'—'}</b><small> · overall</small></td>
              <td>{totals.leads ? (totals.contracts/totals.leads*100).toFixed(1)+'%' : '—'}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>

      <details className="pulse-data-notes"><summary>About these numbers</summary><p>Raw conversion is the percentage of leads that reached under contract or closed. Each lead counts once, even if it reached both. Closed is shown separately and is included in the cumulative Under contract count. This view groups leads by their creation date. When verified history is loaded, it counts cumulative milestones, including achievements before a return to Nurture. It is not a count of contracts signed during the period. The overall leads-per-contract column uses all available history, independent of this filter. Its supporting counts are available in the comparison details. Historical comparisons use recorded lead creation and milestone dates, attributed to the current owner in both counts. Past reassignments are not reconstructed. Fewer leads per contract means stronger conversion; the minimum expectation is a floor, not an ideal performance goal. Month to date starts on the 1st in your browser timezone. The six-month view includes this month and the previous five calendar months. A missing 1:1 record does not prove that no coaching happened.</p>{undated>0 && <p>{undated} leads have no date and are excluded from this window.</p>}{departed.names.length>0 && <p>Team totals include {departed.leads} leads from former team members: {departed.names.join(', ')}.</p>}</details>
      </>}
    </>,
  );
}
