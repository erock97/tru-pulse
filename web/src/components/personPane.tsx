/**
 * The person panel, shared by both roster layouts.
 *
 * Everything in it is measured. Certification comes from the Rep board; an
 * agent with no record there says so rather than being shown as nought passed.
 */

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { SOURCE_COLORS } from './viz';
import type { Row } from '../lib/rosterData';

/* One person's own axis. It has to hold three numbers — them, the floor and
   the line — with air either side, and it must not depend on the roster, which
   the panel does not have. */
function standAt(v: number, row: Row, line: number, team: number | null): number {
  const marks = [line, row.perContract ?? line, team ?? line];
  const lo = Math.max(0, Math.min(...marks) - 4);
  const hi = Math.max(...marks) + 4;
  return Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
}

/* The reading, said in a sentence, because a picture of three marks still
   leaves the leader to work out which way round is good. Every clause traces
   to a number on the panel — nothing here is an opinion. */
function verdict(row: Row, line: number, team: number | null): string {
  const first = row.name.split(' ')[0];
  if (row.perContract === null) {
    return `${first} has closed nothing in this window, so there is no rate to judge yet. ${row.leads} leads is the number to watch.`;
  }
  const rate = Math.round(row.perContract);
  const vsLine = rate > line
    ? `past your line of one in ${line}`
    : `inside your line of one in ${line}`;
  const vsTeam = team === null ? ''
    : rate > Math.round(team) ? `, and behind the floor at one in ${Math.round(team)}`
      : rate < Math.round(team) ? `, and ahead of the floor at one in ${Math.round(team)}`
        : `, level with the floor`;
  return `${first} turns one lead in ${rate} — ${vsLine}${vsTeam}.`;
}

export function PersonPane({
  row, onClose, approach, line, teamRate,
}: {
  row: Row | null;
  onClose: () => void;
  approach: string | null;
  /** The threshold in force right now — which on Pulse the leader can move. */
  line: number;
  /** What the whole floor is running at, so one person can be read against it. */
  teamRate: number | null;
}) {
  if (!row) return null;
  const first = row.name.split(' ')[0];

  // Escape closes the drill-in. Without it the only way out was the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Decorative backdrop. Clicking it closes, but it is NOT the keyboard
          path out — Escape is, wired below — so it stays aria-hidden rather
          than pretending to be a control. */}
      <div className="rs-scrim on" onClick={onClose} aria-hidden />
      <aside className="rs-pane on">
        <div className="rs-pane-h">
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
          <h3>{row.name}</h3>
          <p>{row.archName ?? 'Not assessed'} · {row.leads} leads</p>
        </div>
        <div className="rs-pane-b">
          {/* Where they STAND, before any of the numbers.
              The panel used to open on a list of figures and leave the reading
              to you — which meant that having just clicked a dot on a scale to
              get here, the first thing you saw was the one view that had
              thrown the scale away. This is the same picture the lead tile
              draws, with the crowd removed and only this person, the floor and
              your line left on it. */}
          <div className="rs-grp rs-stand">
            <div className="rs-grp-k">Where {first} stands</div>
            <span className="rs-scale rs-scale-lg">
              <hr />
              {teamRate !== null && <s style={{ '--at': standAt(teamRate, row, line, teamRate) } as CSSProperties} />}
              <u style={{ '--at': standAt(line, row, line, teamRate) } as CSSProperties} />
              {row.perContract !== null && (
                <i
                  className={'h-' + row.health}
                  style={{ '--at': standAt(row.perContract, row, line, teamRate) } as CSSProperties}
                />
              )}
            </span>
            <div className="rs-stand-key">
              <span><s className="rs-key team" /> the floor{teamRate ? ` at 1 : ${Math.round(teamRate)}` : ''}</span>
              <span><s className="rs-key line" /> your line at 1 : {line}</span>
            </div>
            <p className="rs-msg">{verdict(row, line, teamRate)}</p>
          </div>

          <div className="rs-grp">
            <div className="rs-grp-k">Pipeline</div>
            {/* The total, then what it is made of. Without the breakout the
                total gets read as one source's number and stops matching
                whatever single-source report the leader checks it against. */}
            <div className="rs-ln"><s>Leads assigned</s><b>{row.leads}</b></div>
            {row.srcs.size > 0 && (
              <div className="rs-srcs">
                {[...row.srcs.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (
                  <div className="rs-src" key={name}>
                    <i style={{ background: SOURCE_COLORS[name] ?? SOURCE_COLORS.Other }} />
                    <s>{name}</s><b>{n}</b>
                  </div>
                ))}
              </div>
            )}
            {[
              ['Worked', `${row.workedPct}%`],
              ['Sitting in Lead', row.stuck ? String(row.stuck) : 'none'],
              ['Reached an offer', row.offers ? String(row.offers) : 'none'],
              ['Under contract', row.contracts ? String(row.contracts) : 'none'],
              ['Leads per contract', row.perContract ? `1 : ${Math.round(row.perContract)}` : '—'],
            ].map(([k, v]) => (
              <div className="rs-ln" key={k}><s>{k}</s><b>{v}</b></div>
            ))}
          </div>

          <div className="rs-grp">
            <div className="rs-grp-k">Coaching</div>
            <div className="rs-ln"><s>Archetype</s><b>{row.arch ?? '—'}</b></div>
            <div className="rs-ln"><s>Last 1:1</s><b>{row.lastDays === null ? 'no record' : `${row.lastDays} days ago`}</b></div>
            {approach && <p className="rs-msg">{approach}</p>}
          </div>

          <div className="rs-grp">
            <div className="rs-grp-k">Certification</div>
            {row.cert ? (
              <>
                <div className="rs-ln">
                  <s>Modules passed</s>
                  <b className={row.cert.passed === 0 ? 'rs-dim' : ''}>{row.cert.passed} of {row.cert.total}</b>
                </div>
                <div className="rs-ln">
                  <s>Login sent</s>
                  <b className={row.cert.invited ? '' : 'rs-dim'}>{row.cert.invited ? 'yes' : 'no'}</b>
                </div>
                {!row.cert.invited && (
                  <p className="rs-msg">
                    <b>{first} has never been invited.</b> They cannot start a module until a login goes out.
                  </p>
                )}
              </>
            ) : (
              <p className="rs-msg">This name has no record on the certification board.</p>
            )}
          </div>

          <div className="rs-acts">
            {row.agentId
              ? <a className="rs-pill p" href={`#/coach/${row.agentId}`}>
                  Prep the 1:1 with {first}<span aria-hidden>&rarr;</span>
                </a>
              : <p className="rs-msg">No coaching record is linked to this name, so there is nothing to open.</p>}
            {row.cert && (
              <a className="rs-pill g" href="#/rep">
                {row.cert.invited ? `See ${first} in Rep` : `Send ${first} a login`}
                <span aria-hidden>&rarr;</span>
              </a>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
