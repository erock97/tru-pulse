/**
 * The drilldown under a team row — every deal uploaded for the month it bills,
 * however it turned out. Not just the billable ones: the question being asked
 * is usually "did that closing ever come through", and a list showing only
 * what can be billed cannot answer it.
 *
 * Answers save one at a time and only THIS panel refetches afterwards — the
 * parent refreshes its overview quietly. In TRU OS the first version rebuilt
 * the whole table on every answer, which slammed the drilldown shut and made
 * Confirm-Confirm-Confirm impossible. That is the bug this component's shape
 * exists to prevent: it never unmounts itself.
 */

import { useCallback, useEffect, useState } from 'react';

import { clearMonth, confirmDealAsAdmin, deleteDeal, moneyTeamMonth, type MoneyDeal } from '../../lib/api';
import { money, monthOptions } from '../../lib/moneyFormat';

/* Status → chip class + wording. Pending is not here on purpose: its wording
 * depends on whether the round was sent, so the row decides it per team. */
const SETTLED: Record<string, [string, string]> = {
  confirmed: ['ok', 'confirmed'],
  moved: ['moved', 'moved'],
  cancelled: ['dead', 'fell out'],
};

export function TeamDealsPanel({
  team, year, month, roundOut, onChanged,
}: {
  team: string;
  /** The BILLING month — the worker applies the one-month shift itself. */
  year: number;
  month: number;
  /** Has this team already been emailed this month? Words the pending chip:
   *  a deal the broker is sitting on says so; one nobody has asked about yet
   *  says THAT instead, because it is Eric's move and not theirs. */
  roundOut: boolean;
  /** Quiet overview refresh — tiles and row counts move without a page load. */
  onChanged: () => void;
}) {
  const [deals, setDeals] = useState<MoneyDeal[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // The deal whose "Moved" month select is open, and the month picked in it.
  const [movingId, setMovingId] = useState<string | null>(null);
  const [movedYm, setMovedYm] = useState(`${year}-${month}`);

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) { setDeals(undefined); setError(''); }
    const r = await moneyTeamMonth(team, year, month);
    if (r.ok) { setDeals(r.deals); setError(''); }
    // A read that failed is not a month with no deals.
    else setError(r.error);
  }, [team, year, month]);

  useEffect(() => { void load(false); }, [load]);

  async function answer(deal: MoneyDeal, outcome: 'confirmed' | 'cancelled' | 'moved', extra?: { newYear: number; newMonth: number }) {
    setBusyId(deal.id);
    setNote('');
    const r = await confirmDealAsAdmin({
      team, year, month, closingId: deal.id, outcome, ...(extra ?? {}),
    });
    setBusyId(null);
    setMovingId(null);
    if (!r.ok) setNote(r.error);
    // Refetch quietly either way — a failure may still mean the server's view
    // of the deal moved, and showing stale buttons invites a second failure.
    await load(true);
    if (r.ok) onChanged();
  }

  function saveMoved(deal: MoneyDeal) {
    const parts = movedYm.split('-');
    const newYear = Number(parts[0]);
    const newMonth = Number(parts[1]);
    if (!newYear || !newMonth) { setNote('Pick the month it actually closed.'); return; }
    void answer(deal, 'moved', { newYear, newMonth });
  }

  /* Deleting is for fixing a bad upload, and it is permanent — so each path
   * names exactly what is about to go before anything goes. Invoiced deals
   * are refused server-side either way. */
  async function removeDeal(d: MoneyDeal) {
    const label = d.address || d.clientName || 'this deal';
    if (!window.confirm(`Delete ${label}? This cannot be undone — re-upload it if it was real.`)) return;
    setBusyId(d.id);
    setNote('');
    const r = await deleteDeal(d.id);
    setBusyId(null);
    if (!r.ok) setNote(r.error);
    await load(true);
    if (r.ok) onChanged();
  }

  async function clearAll() {
    const wipeable = (deals ?? []).filter((d) => !d.locked).length;
    const invoiced = (deals ?? []).length - wipeable;
    if (!window.confirm(
      `Clear ALL ${wipeable} uploaded deal${wipeable === 1 ? '' : 's'} for ${team} this month?` +
      (invoiced ? ` ${invoiced} invoiced deal${invoiced === 1 ? '' : 's'} will stay.` : '') +
      ' This cannot be undone — the point is a clean re-upload.',
    )) return;
    setBusyId('clear-all');
    setNote('');
    const r = await clearMonth(team, year, month);
    setBusyId(null);
    if (!r.ok) setNote(r.error);
    else setNote(r.message);
    await load(true);
    if (r.ok) onChanged();
  }

  if (error) return <div className="mny-err">Couldn't read these deals — {error}</div>;
  if (deals === undefined) return <div className="mny-note">Reading deals…</div>;
  if (!deals.length) return <div className="mny-note">Nothing uploaded for this month.</div>;

  const pendingChip: [string, string] = roundOut ? ['wait', 'waiting on broker'] : ['warn', 'not sent yet'];

  return (
    <div>
      <div className="mny-deal-cols">
      {deals.map((d) => {
        const who = d.address || d.clientName || '—';
        const sub = [
          d.address && d.clientName ? d.clientName : '',
          d.agentName, d.closeDate, d.source,
        ].filter(Boolean).join(' · ');
        const chip = d.status === 'pending' ? pendingChip : (SETTLED[d.status] ?? ['locked', d.status]);

        /* A deal under the threshold earns nothing, and that is correct rather
         * than broken. Its first N say so instead of showing a bare $0, which
         * reads like a missing rate and sends you hunting. */
        let right;
        if (d.unpriced) right = <span className="mny-note">no rate set</span>;
        else if ((d.earned ?? 0) === 0 && (d.thresholdDeals ?? 0) > 0 && d.dealNumber && d.dealNumber <= (d.thresholdDeals ?? 0)) {
          right = <span className="mny-note">#{d.dealNumber} of {d.thresholdDeals} — under threshold</span>;
        } else if (d.earned) right = money(d.earned);
        else right = <span className="mny-note">—</span>;

        const answerable = d.status === 'pending' && !d.locked;
        return (
          <div className="mny-deal" key={d.id}>
            <div>
              <span className="mny-deal-who">{who}</span>
              <span className={`mny-chip ${chip[0]}`}>{chip[1]}</span>
              {d.locked && <span className="mny-chip locked">invoiced</span>}
              {sub && <div className="mny-sub">{sub}</div>}
              {answerable && movingId !== d.id && (
                <div className="mny-deal-acts">
                  <button type="button" className="mny-btn yes" disabled={busyId !== null}
                    onClick={() => void answer(d, 'confirmed')}>
                    {busyId === d.id ? 'Saving…' : 'Confirm'}
                  </button>
                  <button type="button" className="mny-btn no" disabled={busyId !== null}
                    onClick={() => void answer(d, 'cancelled')}>
                    Fell out
                  </button>
                  <button type="button" className="mny-btn" disabled={busyId !== null}
                    onClick={() => { setMovingId(d.id); setMovedYm(`${year}-${month}`); }}>
                    Moved
                  </button>
                </div>
              )}
              {answerable && movingId === d.id && (
                <div className="mny-deal-acts">
                  <select value={movedYm} onChange={(e) => setMovedYm(e.target.value)} aria-label="Month it actually closed">
                    {monthOptions(year, month, -2, 4).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button type="button" className="mny-btn yes" disabled={busyId !== null}
                    onClick={() => saveMoved(d)}>
                    {busyId === d.id ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="mny-link" onClick={() => setMovingId(null)}>cancel</button>
                </div>
              )}
            </div>
            <div className="mny-deal-right">
              {right}
              {!d.locked && (
                <div>
                  <button type="button" className="mny-link" disabled={busyId !== null}
                    onClick={() => void removeDeal(d)} aria-label={`Delete ${who}`}>
                    delete
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
      {deals.some((d) => !d.locked) && (
        <div className="mny-deal-acts" style={{ marginTop: 10 }}>
          <button type="button" className="mny-btn no" disabled={busyId !== null} onClick={() => void clearAll()}>
            {busyId === 'clear-all' ? 'Clearing…' : 'Clear this month'}
          </button>
        </div>
      )}
      {note && <div className="mny-err">{note}</div>}
    </div>
  );
}
