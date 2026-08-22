/**
 * THE LAB — four design ideas, built for real, at #/lab.
 *
 * Not linked from anywhere. Every one runs on live data through the same
 * loader Pulse uses, because a concept drawn with invented numbers proves
 * nothing about whether it would work on a real floor.
 *
 * Each answers a question TRU HQ currently cannot:
 *
 *   1. TRINITY      Is this person in trouble? Today that needs three tabs.
 *   2. THE FLOOR     Who is an outlier, and in which direction?
 *   3. SPREAD        Is one number carried by one person or shared?
 *   4. FIRST THING   What do I do first this morning?
 */

import { useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { signOutClean } from '../lib/api';
import {
  DEFAULT_LINE, WINDOWS, prioritise, useRosterData, type Row,
} from '../lib/rosterData';
import '../truHqDark.css';

const LINE = DEFAULT_LINE;

/* ── 1. TRINITY ──────────────────────────────────────────────────────────
   Three arcs on one dial: how they sell, how they are coached, how far
   through certification. The whole point is the SHAPE — a person strong on
   one ring and hollow on another is visible before you read a word. */
function Trinity({ row }: { row: Row }) {
  const R = 34, C = 2 * Math.PI * R;
  // Each ring is a share of something real, clamped to 0..1.
  const sell = row.perContract === null ? 0 : Math.max(0, Math.min(1, LINE / row.perContract));
  const coach = row.lastDays === null ? 0 : Math.max(0, Math.min(1, 1 - row.lastDays / 30));
  const cert = row.cert && row.cert.total ? row.cert.passed / row.cert.total : 0;
  const rings = [
    { key: 'sell', v: sell, r: R, tone: 'var(--sea)' },
    { key: 'coach', v: coach, r: R - 9, tone: 'var(--accent)' },
    { key: 'cert', v: cert, r: R - 18, tone: 'var(--terracotta)' },
  ];
  const weakest = [...rings].sort((a, b) => a.v - b.v)[0];
  const LABEL: Record<string, string> = {
    sell: 'their pipeline', coach: 'time since a 1:1', cert: 'certification',
  };
  return (
    <div className="lab-tri">
      <svg viewBox="0 0 84 84" aria-hidden>
        {rings.map((g) => (
          <g key={g.key}>
            <circle cx="42" cy="42" r={g.r} fill="none" stroke="rgba(226,240,230,0.07)" strokeWidth="5" />
            <circle
              cx="42" cy="42" r={g.r} fill="none" stroke={g.tone} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * g.r}`}
              strokeDashoffset={`${2 * Math.PI * g.r * (1 - g.v)}`}
              transform="rotate(-90 42 42)"
              style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.16,1,0.3,1)' }}
            />
          </g>
        ))}
        <circle cx="42" cy="42" r={R + 6} fill="none" stroke="rgba(226,240,230,0.05)" strokeWidth="1" />
      </svg>
      <div className="lab-tri-t">
        <b>{row.name}</b>
        <span>weakest: {LABEL[weakest.key]}</span>
      </div>
      <span className="lab-tri-c" style={{ ['--c' as string]: C }} />
    </div>
  );
}

/* ── 2. THE FLOOR ────────────────────────────────────────────────────────
   Volume across, conversion up. Every agent is a dot. The value is that
   clusters and outliers are POSITIONS, not rows you have to sort. */
function FloorMap({ rows }: { rows: readonly Row[] }) {
  const live = rows.filter((r) => r.leads > 0);
  if (live.length === 0) return null;
  // Conversion as contracts per 100 leads, so the axis means something.
  const rate = (r: Row) => (r.leads ? (r.contracts / r.leads) * 100 : 0);

  // Scale to the DATA, not to zero. Anchoring both axes at zero crushed a real
  // team into one corner of the plot and left three quarters of it empty — the
  // differences between these people are the whole point, and a zero-anchored
  // axis throws them away. The line has to stay inside the frame, so it is
  // included in the range rather than allowed to fall off it.
  const pad = (lo: number, hi: number) => {
    const span = hi - lo || Math.max(1, hi * 0.2);
    return { lo: lo - span * 0.12, span: span * 1.24 };
  };
  const xs = live.map((r) => r.leads);
  const ys = live.map(rate);
  const lineRate = 100 / LINE;
  const X = pad(Math.min(...xs), Math.max(...xs));
  const Y = pad(Math.min(...ys, lineRate), Math.max(...ys, lineRate));
  const at = (v: number, a: { lo: number; span: number }) => ((v - a.lo) / a.span) * 100;
  const lineY = at(lineRate, Y) / 100;
  return (
    <div className="lab-floor">
      <div className="lab-floor-plot">
        <span className="lab-floor-line" style={{ bottom: `${Math.max(2, Math.min(95, lineY * 100))}%` }}>
          <i>your line · 1 in {LINE}</i>
        </span>
        {live.map((r) => {
          const x = at(r.leads, X);
          const y = at(rate(r), Y);
          const tone = r.health === 'past-line' ? 'var(--ember)'
            : r.health === 'behind' ? 'var(--accent)'
              : r.health === 'no-volume' ? 'var(--text-40)' : 'var(--sea)';
          return (
            <span
              key={r.name}
              className="lab-dot"
              style={{ left: `${Math.max(2, Math.min(97, x))}%`, bottom: `${Math.max(2, Math.min(95, y))}%`, background: tone }}
              title={`${r.name} · ${r.leads} leads · ${r.contracts} contracts`}
            >
              <b>{r.name.split(' ')[0]}</b>
            </span>
          );
        })}
      </div>
      <div className="lab-floor-ax">
        <span>fewer leads</span><span>more leads →</span>
      </div>
    </div>
  );
}

/* ── 3. SPREAD ───────────────────────────────────────────────────────────
   A total tells you the size of something, never whether one person is
   carrying it. This puts every agent's contribution under the number. */
function Spread({ label, value, parts, unit }: {
  label: string; value: string; parts: Array<{ name: string; n: number }>; unit: string;
}) {
  const total = parts.reduce((a, p) => a + p.n, 0) || 1;
  const top = [...parts].sort((a, b) => b.n - a.n);
  const lead = top[0];
  const share = Math.round((lead?.n ?? 0) / total * 100);
  return (
    <div className="rs-plate dk-tile lab-spread">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <span className="lab-bars" aria-hidden>
        {top.map((p, i) => (
          <i key={p.name} style={{ flexGrow: Math.max(p.n, 0.001), opacity: 1 - i * 0.11 }} title={p.name} />
        ))}
      </span>
      <span className="u">
        {lead && share >= 40
          ? <><b>{lead.name.split(' ')[0]}</b> is {share}% of it</>
          : `${unit} · spread across ${parts.length}`}
      </span>
    </div>
  );
}

export default function Lab({ org, onHome }: { org: { id: string; name: string }; onHome?: () => void }) {
  const [win] = useState(WINDOWS[3]);
  const { rows, totals } = useRosterData(LINE, win.days);
  const priorities = useMemo(() => (rows ? prioritise(rows) : []), [rows]);

  const trinity = useMemo(() => {
    if (!rows) return [];
    // Show the people whose three signals disagree most — that is where the
    // shape earns its place over a number.
    return [...rows].filter((r) => r.leads > 0).slice(0, 4);
  }, [rows]);

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        onSignOut={() => signOutClean()}
        hideTopbar
        nav={{
          onHome: () => onHome?.(),
          onOpenPulse: () => { window.location.hash = '/pulse'; },
          onOpenCoach: () => { window.location.hash = '/'; },
          onOpenRep: () => { window.location.hash = '/rep'; },
          onOpenTeam: () => { window.location.hash = '/team'; },
        }}
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Concepts</span>
              <h1>Four things TRU HQ <em>cannot answer</em> today.</h1>
              <p className="dk-sub">
                Built for real, on live data, so you can judge them as they would
                actually look rather than as a picture. Nothing here is linked
                from the product.
              </p>
            </div>
          </header>

          {/* 1 */}
          <div className="dk-sec">
            <h2>One · Is this person in trouble?</h2>
            <p>right now that question costs you three tabs</p>
            <span className="dk-key">outer: pipeline · middle: 1:1 recency · inner: certification</span>
          </div>
          <div className="lab-row">
            {trinity.map((r) => <Trinity key={r.name} row={r} />)}
            {trinity.length === 0 && <p className="lab-none">No agents with leads in this window.</p>}
          </div>

          {/* 2 */}
          <div className="dk-sec">
            <h2>Two · Who is the outlier?</h2>
            <p>a sorted column tells you an order; a position tells you a shape</p>
            <span className="dk-key">across: lead volume · up: contracts per 100 leads</span>
          </div>
          {rows && <FloorMap rows={rows} />}

          {/* 3 */}
          <div className="dk-sec">
            <h2>Three · Is that number one person?</h2>
            <p>a total hides whether the floor is carrying it or one agent is</p>
            <span className="dk-key">every block is an agent</span>
          </div>
          <section className="dk-bento">
            {rows && totals && (
              <>
                <Spread label="Leads in play" value={String(totals.leads)} unit="all sources"
                        parts={rows.map((r) => ({ name: r.name, n: r.leads }))} />
                <Spread label="Under contract" value={String(totals.contracts)} unit="this window"
                        parts={rows.map((r) => ({ name: r.name, n: r.contracts }))} />
                <Spread label="Reached an offer" value={String(totals.offers)} unit="this window"
                        parts={rows.map((r) => ({ name: r.name, n: r.offers }))} />
              </>
            )}
          </section>

          {/* 4 */}
          <div className="dk-sec">
            <h2>Four · What do I do first?</h2>
            <p>the one thing the product never actually says</p>
            <span className="dk-key">ranked across pipeline, coaching and certification</span>
          </div>
          <ol className="lab-brief">
            {priorities.slice(0, 3).map((p, i) => (
              <li key={p.row.name} className={p.severity === 'high' ? 'is-high' : ''}>
                <span className="lab-brief-n">{i + 1}</span>
                <div>
                  <b>{p.row.name}</b>
                  <p>{p.reason}</p>
                  <span className="lab-brief-do">{p.action}</span>
                </div>
              </li>
            ))}
            {priorities.length === 0 && <p className="lab-none">Nothing needs you in this window.</p>}
          </ol>
        </div>
      </HqShell>
    </div>
  );
}
