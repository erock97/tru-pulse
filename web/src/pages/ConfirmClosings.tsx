/**
 * The page a broker lands on from the closing-confirmation email.
 *
 * Deliberately plain. The person opening this is a broker on a phone between
 * showings, not a user of TRU HQ — no login, no shell, no jargon. The token in
 * the URL is the credential; verify-list and verify-respond are the only two
 * calls it makes, and every safety rule lives server-side: a token cannot
 * reach another team's month, cannot reopen a finished round, cannot touch a
 * deal an invoice already owns. This page can be read by anyone and still
 * cannot do anything it should not.
 *
 * One choice worth naming: each answer saves the moment it is tapped. There
 * is no Submit. A broker who answers four of nine deals and closes the tab
 * has saved four answers, and Eric sees four fewer outstanding — which is the
 * whole point of asking.
 *
 * The API's error sentences ("this link has expired", "that deal has already
 * been invoiced") are written FOR the broker and rendered as-is.
 */

import { useEffect, useState } from 'react';

import { verifyList, verifyRespond, type VerifyDeal, type VerifyListData } from '../lib/api';
import { MONTH_NAMES, monthLabel, monthOptions, monthShift } from '../lib/moneyFormat';

import './confirmClosings.css';

function fmtDate(s: string | null): string {
  if (!s) return '';
  const p = s.split('-');
  return p.length === 3 ? `${MONTH_NAMES[+p[1]]} ${+p[2]}, ${p[0]}` : s;
}

function Settled({ status }: { status: string }) {
  if (status === 'confirmed') return <span className="cc-done ok">✓ Confirmed closed</span>;
  if (status === 'cancelled') return <span className="cc-done no">Marked as fell out</span>;
  if (status === 'moved') return <span className="cc-done moved">Moved to another month</span>;
  return null;
}

export default function ConfirmClosings({ token }: { token: string }) {
  const [data, setData] = useState<VerifyListData | undefined>(undefined);
  const [pageErr, setPageErr] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [roundClosed, setRoundClosed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [movedYm, setMovedYm] = useState('');
  // A failed save belongs on its card, not at the top of the page.
  const [cardErr, setCardErr] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    // Called even with a missing token — the API's refusal is the page's
    // message, and it is written for the person reading it.
    void verifyList(token).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setData({ team: r.team, year: r.year, month: r.month, closed_at: r.closed_at, deals: r.deals });
        setRemaining(r.deals.filter((d) => d.status === 'pending' && !d.locked).length);
        setRoundClosed(!!r.closed_at);
      } else setPageErr(r.error);
    });
    return () => { alive = false; };
  }, [token]);

  async function answer(deal: VerifyDeal, outcome: 'confirmed' | 'cancelled' | 'moved', newYear?: number, newMonth?: number) {
    setBusyId(deal.id);
    setCardErr((m) => ({ ...m, [deal.id]: '' }));
    const r = await verifyRespond(token, deal.id, outcome, newYear, newMonth);
    setBusyId(null);
    setMovingId(null);
    if (!r.ok) {
      setCardErr((m) => ({ ...m, [deal.id]: r.error }));
      return;
    }
    setData((d) => d && {
      ...d,
      deals: d.deals.map((x) => (x.id === deal.id ? { ...x, status: outcome } : x)),
    });
    setRemaining(r.remaining);
    if (r.round_closed) setRoundClosed(true);
  }

  function saveMoved(deal: VerifyDeal) {
    const parts = movedYm.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (!y || !m) {
      setCardErr((prev) => ({ ...prev, [deal.id]: 'Pick the month it actually closed.' }));
      return;
    }
    void answer(deal, 'moved', y, m);
  }

  const open = data ? data.deals.filter((d) => d.status === 'pending' && !d.locked) : [];
  const sub = !data
    ? (pageErr ? '' : 'Loading…')
    : roundClosed && open.length === 0
      ? 'This list is complete.'
      : open.length
        ? `${remaining ?? open.length} of ${data.deals.length} still to confirm — each answer saves as you tap it.`
        : 'All answered — nothing needs you.';

  return (
    <div className="confirm-page">
      <div className="cc-wrap">
        <header>
          <h1>{data ? `Closings for ${data.team} — ${monthLabel(data.year, data.month)}` : 'Confirm closings'}</h1>
          <div className="cc-sub">{sub}</div>
        </header>

        {pageErr ? (
          <div className="cc-banner">
            {pageErr}
            <div className="cc-note" style={{ marginTop: 8 }}>
              Please reply to the email and Eric will send a new link.
            </div>
          </div>
        ) : data && data.deals.length === 0 ? (
          <div className="cc-banner">Nothing to confirm for this month.</div>
        ) : data ? (
          <>
            {roundClosed && (
              <div className="cc-banner good" style={{ marginBottom: 10 }}>
                All done — thank you. You can close this page.
              </div>
            )}
            {data.deals.map((d) => {
              const head = (
                <>
                  <div className="cc-addr">{d.address || d.client_name || 'Closing'}</div>
                  <div className="cc-meta">
                    {[
                      d.address && d.client_name ? d.client_name : '',
                      fmtDate(d.close_date),
                      d.source || '',
                    ].filter(Boolean).join(' · ')}
                  </div>
                </>
              );
              if (d.locked) {
                return (
                  <div className="cc-card" key={d.id}>
                    {head}
                    <div className="cc-note">Already invoiced — if something looks wrong, contact Eric.</div>
                  </div>
                );
              }
              if (d.status !== 'pending') {
                return (
                  <div className="cc-card" key={d.id}>
                    {head}
                    <div className="cc-acts"><Settled status={d.status} /></div>
                  </div>
                );
              }
              return (
                <div className="cc-card" key={d.id}>
                  {head}
                  {movingId === d.id ? (
                    <div className="cc-acts">
                      <select value={movedYm} onChange={(e) => setMovedYm(e.target.value)}
                        aria-label="Month it actually closed">
                        {monthOptions(data.year, data.month, -3, 3).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <button type="button" disabled={busyId !== null} onClick={() => saveMoved(d)}>
                        {busyId === d.id ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <div className="cc-acts">
                      <button type="button" className="yes" disabled={busyId !== null}
                        onClick={() => void answer(d, 'confirmed')}>
                        {busyId === d.id ? 'Saving…' : 'Yes — it closed'}
                      </button>
                      <button type="button" className="no" disabled={busyId !== null}
                        onClick={() => void answer(d, 'cancelled')}>
                        It fell out
                      </button>
                      <button type="button" disabled={busyId !== null}
                        onClick={() => {
                          setMovingId(d.id);
                          // A deal that moves usually slips forward by weeks,
                          // so the month AFTER this list's is the likely answer.
                          const next = monthShift(data.year, data.month, 1);
                          setMovedYm(`${next.year}-${next.month}`);
                        }}>
                        Closed a different month
                      </button>
                    </div>
                  )}
                  {cardErr[d.id] && <div className="cc-note">{cardErr[d.id]}</div>}
                </div>
              );
            })}
          </>
        ) : (
          <div className="cc-banner">Loading…</div>
        )}

        <footer>Terrason Consulting Group</footer>
      </div>
    </div>
  );
}
