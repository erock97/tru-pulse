/**
 * "Edit rates" — a team's retainer, default rate and per-source rate card.
 *
 * Everything is whole dollars, and the values are sent as typed: the WORKER
 * refuses decimals with a sentence written for the person at the screen
 * ("The retainer must be whole dollars — no cents."), and that sentence is
 * shown verbatim rather than pre-validated away here. The columns are
 * integers, so a decimal would silently truncate on the way in — better the
 * server makes Eric say which he meant.
 *
 * Saving sends the FULL rate list every time — the worker replaces, it does
 * not merge — so removing a row here really removes the rate.
 */

import { useState } from 'react';

import { saveTeamPay, type MoneyTeamConfig } from '../../lib/api';

/* The sources TRU actually bills for, as datalist suggestions — typed sources
 * must match the imported deals' sources exactly, or the deals go unpriced. */
export const KNOWN_SOURCES = ['Zillow Preferred', 'Realtor.com', 'Realtor.com MVIP'];

interface RateRow { source: string; rate: string; threshold: string }

export function RateCardEditor({
  team, onClose, onSaved,
}: {
  team: MoneyTeamConfig;
  onClose: () => void;
  /** Close + quiet overview refresh. */
  onSaved: () => void;
}) {
  const [retainer, setRetainer] = useState(team.retainer === null ? '' : String(team.retainer));
  const [defaultRate, setDefaultRate] = useState(team.defaultRate === null ? '' : String(team.defaultRate));
  const [rows, setRows] = useState<RateRow[]>(
    team.rates.length
      ? team.rates.map((r) => ({ source: r.source, rate: String(r.rate), threshold: r.threshold ? String(r.threshold) : '' }))
      : [{ source: '', rate: '', threshold: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setRow = (i: number, patch: Partial<RateRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError('');
    const r = await saveTeamPay({
      teamId: team.id,
      // Number(''), not parseInt: "250.50" must reach the server AS 250.5 so
      // its whole-dollars refusal fires instead of a silent truncation.
      retainer: Number(retainer || 0),
      defaultRate: defaultRate.trim() === '' ? null : Number(defaultRate),
      rates: rows
        .filter((row) => row.source.trim())
        .map((row) => ({
          source: row.source.trim(),
          rate: Number(row.rate || 0),
          thresholdDeals: Number(row.threshold || 0),
        })),
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onSaved();
  }

  return (
    <div className="rp-mgmt-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-mgmt-panel" role="dialog" aria-label={`Edit rates for ${team.name}`}>
        <div className="rp-mgmt-head">
          <div>
            <h2 style={{ margin: 0 }}>Rates — {team.name}</h2>
            <p className="mny-modal-sub">
              Whole dollars. A source's first "free deals" count earns nothing before the rate kicks in.
            </p>
          </div>
          <div className="rp-mgmt-headbtns">
            <button type="button" className="mny-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>

        <div className="mny-row">
          <div className="grow mny-field">
            <label>Monthly retainer ($)</label>
            <input inputMode="numeric" value={retainer} placeholder="0"
              onChange={(e) => setRetainer(e.target.value)} />
          </div>
          <div className="grow mny-field">
            <label>Default rate per closing ($ — blank for none)</label>
            <input inputMode="numeric" value={defaultRate} placeholder="no default"
              onChange={(e) => setDefaultRate(e.target.value)} />
          </div>
        </div>

        <datalist id="rc-sources">
          {KNOWN_SOURCES.map((s) => <option key={s} value={s} />)}
        </datalist>
        {rows.map((row, i) => (
          <div className="mny-row" key={i}>
            <div className="grow mny-field">
              <label>Source</label>
              <input list="rc-sources" value={row.source} placeholder="Zillow Preferred"
                onChange={(e) => setRow(i, { source: e.target.value })} />
            </div>
            <div className="grow mny-field">
              <label>Rate ($)</label>
              <input inputMode="numeric" value={row.rate} placeholder="250"
                onChange={(e) => setRow(i, { rate: e.target.value })} />
            </div>
            <div className="grow mny-field">
              <label>Free deals first</label>
              <input inputMode="numeric" value={row.threshold} placeholder="0"
                onChange={(e) => setRow(i, { threshold: e.target.value })} />
            </div>
            <div className="mny-field">
              <button type="button" className="mny-btn" aria-label={`Remove ${row.source || 'this'} rate`}
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                ×
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="mny-link"
          onClick={() => setRows((rs) => [...rs, { source: '', rate: '', threshold: '' }])}>
          + add a source
        </button>

        {error && <div className="mny-err">{error}</div>}
        <div className="mny-foot">
          <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save rates'}
          </button>
        </div>
      </div>
    </div>
  );
}
