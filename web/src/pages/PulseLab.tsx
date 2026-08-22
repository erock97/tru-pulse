/**
 * PULSE LAB — a different answer to the same question.
 *
 * Not wired into the sidebar. Reachable only at #/pulse/lab, so production
 * Pulse is untouched while this is being judged.
 *
 * The premise: Pulse's job is to answer "where is the business going?", and
 * today it answers with six tiles and a table. Six tiles of equal size make a
 * 93% collapse read as six facts of equal weight. It is one fact.
 *
 * So this page has exactly one picture, drawn at true scale, and everything
 * else on the page is subordinate to it — including the roster, which is
 * reduced to one row per person carrying that same shape in miniature. You
 * find the person to talk to by spotting the shape that is wrong, not by
 * sorting a column.
 *
 * Every number is the same loader Pulse itself uses (useRosterData). Nothing
 * here is invented, and nothing is recomputed differently — if this and Pulse
 * ever disagree, this is wrong.
 */

import { useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { signOutClean } from '../lib/api';
import { DropFlow, DropSpark, type Stage } from '../components/dropFlow';
import {
  DEFAULT_LINE, WINDOWS, useRosterData, type Window,
} from '../lib/rosterData';
import '../truHqDark.css';

const TONE = {
  good: 'rgba(143, 176, 162, 0.9)',
  warn: 'rgba(242, 178, 60, 0.9)',
  bad: 'rgba(255, 106, 69, 0.9)',
  none: 'rgba(226, 240, 230, 0.22)',
};

export default function PulseLab({
  org, onHome,
}: {
  org: { id: string; name: string };
  onHome?: () => void;
}) {
  const line = DEFAULT_LINE;
  const [win, setWin] = useState<Window>(WINDOWS[3]);
  const { rows, err, totals } = useRosterData(line, win.days);

  const stages: Stage[] = useMemo(() => {
    if (!totals) return [];
    return [
      { key: 'in', label: 'Came in', value: totals.leads, note: 'every lead in this window' },
      { key: 'worked', label: 'Worked', value: totals.worked, note: 'someone actually made contact' },
      { key: 'offer', label: 'Reached an offer', value: totals.offers, note: 'got as far as writing one' },
      { key: 'uc', label: 'Under contract', value: totals.contracts, note: 'the business' },
    ];
  }, [totals]);

  // Ranked by the size of the hole, not by a score. The person losing the most
  // real leads is the person to talk to, and that is not always the person with
  // the worst ratio — a bad ratio on four leads is noise.
  const ranked = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .map((r) => {
        const lostAtOffer = Math.max(0, r.worked - r.offers);
        const tone: keyof typeof TONE = r.leads < 5 ? 'none'
          : r.perContract === null ? 'bad'
            : r.perContract > line ? 'bad'
              : r.perContract > line * 0.7 ? 'warn' : 'good';
        return { r, lostAtOffer, tone };
      })
      .sort((a, b) => b.lostAtOffer - a.lostAtOffer);
  }, [rows, line]);

  const worstGate = useMemo(() => {
    if (stages.length < 2) return null;
    let best = { label: '', lost: -1, from: '' };
    for (let i = 1; i < stages.length; i++) {
      const lost = stages[i - 1].value - stages[i].value;
      if (lost > best.lost) best = { label: stages[i].label, lost, from: stages[i - 1].label };
    }
    return best;
  }, [stages]);

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        onSignOut={() => signOutClean()}
        hideTopbar
        islandSlot={
          <>
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                className={win.key === w.key ? 'dk-win is-on' : 'dk-win'}
                onClick={() => setWin(w)}
              >
                {w.label}
              </button>
            ))}
          </>
        }
        nav={{
          onHome: () => onHome?.(),
          onOpenPulse: () => { window.location.hash = '/pulse'; },
          onOpenCoach: () => { window.location.hash = '/'; },
          onOpenRep: () => { window.location.hash = '/rep'; },
          onOpenTeam: () => { window.location.hash = '/team'; },
        }}
      >
        <div className="dk-main pl-main">
          {err && <div className="ad-inline-err" style={{ marginBottom: 14 }}>{err}</div>}

          <header className="dk-mast pl-mast">
            <div>
              <span className="dk-eyebrow"><i />Where it goes</span>
              <h1>
                {worstGate && worstGate.lost > 0
                  ? <>{worstGate.lost.toLocaleString()} died on the way to <em>{worstGate.label.toLowerCase()}</em>.</>
                  : <>The floor, end to end.</>}
              </h1>
              <p className="dk-sub">
                {totals
                  ? <>
                    {totals.leads.toLocaleString()} leads came in and {totals.contracts.toLocaleString()}{' '}
                    became business. Height below is volume, at true scale — the
                    narrowing is the loss, drawn rather than described.
                  </>
                  : 'Reading the pipeline.'}
              </p>
            </div>
          </header>

          {stages.length > 0 && <DropFlow stages={stages} />}

          <div className="dk-sec pl-sec">
            <h2>Who is losing it</h2>
            <p>ranked by leads lost between worked and an offer — not by ratio</p>
            <span className="dk-key">each shape is that person's own pipeline</span>
          </div>

          <div className="rs-plate dk-table pl-plate">
            <div className="pl-head">
              <span>Agent</span>
              <span>Their shape</span>
              <span className="pl-n">Leads</span>
              <span className="pl-n">Worked</span>
              <span className="pl-n">Offers</span>
              <span className="pl-n">Contracts</span>
              <span className="pl-n">Lost at the offer</span>
            </div>
            {ranked.map(({ r, lostAtOffer, tone }) => (
              <div className="pl-row" key={r.name}>
                <span className="pl-who">{r.name}</span>
                <span className="pl-shape">
                  <DropSpark
                    stages={[r.leads, r.worked, r.offers, r.contracts]}
                    tone={TONE[tone]}
                  />
                </span>
                <span className="pl-n">{r.leads}</span>
                <span className="pl-n">{r.worked}</span>
                <span className="pl-n">{r.offers}</span>
                <span className="pl-n">{r.contracts}</span>
                <span className={lostAtOffer > 0 ? 'pl-n pl-lost' : 'pl-n'}>
                  {lostAtOffer > 0 ? `−${lostAtOffer}` : '—'}
                </span>
              </div>
            ))}
            {rows && rows.length === 0 && (
              <div className="pl-row"><span className="pl-who">Nobody in this window.</span></div>
            )}
          </div>

          <p className="tm-foot">
            A mock, at #/pulse/lab. Same loader as Pulse, same numbers — if this
            and Pulse ever disagree, this one is wrong.
          </p>
        </div>
      </HqShell>
    </div>
  );
}
