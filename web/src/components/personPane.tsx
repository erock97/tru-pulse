/**
 * The person panel, shared by both roster layouts.
 *
 * Everything in it is measured. Certification comes from the Rep board; an
 * agent with no record there says so rather than being shown as nought passed.
 */

import { useEffect } from 'react';
import type { Row } from '../lib/rosterData';

export function PersonPane({
  row, onClose, approach,
}: {
  row: Row | null;
  onClose: () => void;
  approach: string | null;
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
          <div className="rs-grp">
            <div className="rs-grp-k">Pipeline</div>
            {[
              ['Leads assigned', String(row.leads)],
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
