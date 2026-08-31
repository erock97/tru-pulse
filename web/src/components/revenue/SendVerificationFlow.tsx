/**
 * "Send to broker" — email a team's brokers their closing list to confirm.
 *
 * The recipients are named BEFORE anything is sent: a closing list is a
 * client's financial data, and the wrong recipient is not something an undo
 * fixes. All of a team's brokers get the list, not just one — Costigan has two
 * leaders, Woosley has two — because a list sitting in one inbox during a
 * holiday is a round that never closes.
 *
 * Pressing send again later is a reminder carrying the SAME link, not a second
 * round: the worker returns the existing token and extends it.
 */

import { useEffect, useState } from 'react';

import { moneyBrokers, saveBrokerEmail, sendBrokerVerification } from '../../lib/api';

export function SendVerificationFlow({
  team, year, month, onClose, onSent,
}: {
  team: string;
  /** The BILLING month. */
  year: number;
  month: number;
  onClose: () => void;
  /** Flip this row's flag locally — no full reload. */
  onSent: (info: { to: string; outstanding: number }) => void;
}) {
  const [brokers, setBrokers] = useState<Array<{ name: string | null; email: string }> | undefined>(undefined);
  const [error, setError] = useState('');
  // Only shown when the team has nobody on file — saved once, asked once.
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ to: string; outstanding: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void moneyBrokers(team).then((r) => {
      if (!alive) return;
      if (r.ok) setBrokers(r.brokers);
      else setError(r.error);
    });
    return () => { alive = false; };
  }, [team]);

  async function send(toEmail?: string) {
    setBusy(true);
    setError('');
    // No broker on file: save the typed address first so the question is asked
    // once, then send. The send itself still resolves recipients server-side.
    if (brokers !== undefined && brokers.length === 0 && !toEmail) {
      const saved = await saveBrokerEmail(team, newEmail.trim(), newName.trim() || undefined);
      if (!saved.ok) { setError(saved.error); setBusy(false); return; }
    }
    const r = await sendBrokerVerification({ team, year, month, toEmail });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setSent({ to: r.to, outstanding: r.outstanding });
    onSent({ to: r.to, outstanding: r.outstanding });
  }

  return (
    <div className="rp-mgmt-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-mgmt-panel" role="dialog" aria-label={`Send ${team}'s closing list`}>
        <div className="rp-mgmt-head">
          <div>
            <h2 style={{ margin: 0 }}>Send to broker — {team}</h2>
            <p className="mny-modal-sub">
              Their pending closings, as a tap-to-answer list. Nothing is invoiced until they confirm.
            </p>
          </div>
          <div className="rp-mgmt-headbtns">
            <button type="button" className="mny-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {sent ? (
          <div className="mny-ok">
            Sent to {sent.to} — {sent.outstanding} still outstanding.
          </div>
        ) : brokers === undefined && !error ? (
          <div className="mny-note">Checking who's on file…</div>
        ) : brokers && brokers.length > 0 ? (
          <>
            <div>
              {brokers.map((b) => (
                <div className="mny-broker-row" key={b.email}>
                  <span className="mny-deal-who">{b.name || b.email}</span>
                  {b.name && <span className="mny-sub">{b.email}</span>}
                </div>
              ))}
            </div>
            <div className="mny-foot">
              <button type="button" className="btn" disabled={busy} onClick={() => void send()}>
                {busy ? 'Sending…' : `Send to ${brokers.length === 1 ? 'this person' : `these ${brokers.length} people`}`}
              </button>
            </div>
          </>
        ) : brokers ? (
          <>
            <p className="mny-modal-sub">
              No broker on file for {team}. This address is saved against the team, so it is asked once.
            </p>
            <div className="mny-row">
              <div className="grow mny-field">
                <label>Broker email</label>
                <input type="email" value={newEmail} placeholder="broker@brokerage.com"
                  onChange={(e) => setNewEmail(e.target.value)} />
              </div>
              <div className="grow mny-field">
                <label>Name (optional)</label>
                <input value={newName} placeholder="Jack Costigan"
                  onChange={(e) => setNewName(e.target.value)} />
              </div>
            </div>
            <div className="mny-foot">
              <button type="button" className="btn" disabled={busy || !newEmail.trim()} onClick={() => void send()}>
                {busy ? 'Sending…' : 'Save & send'}
              </button>
            </div>
          </>
        ) : null}

        {!sent && (
          <div style={{ marginTop: 14 }}>
            {!testOpen ? (
              <button type="button" className="mny-link" onClick={() => setTestOpen(true)}>
                send a test to a different address instead
              </button>
            ) : (
              <div className="mny-row">
                <div className="grow mny-field">
                  <label>Test address — the real brokers get nothing</label>
                  <input type="email" value={testEmail} placeholder="you@truhq.co"
                    onChange={(e) => setTestEmail(e.target.value)} />
                </div>
                <button type="button" className="mny-btn" disabled={busy || !testEmail.trim()}
                  onClick={() => void send(testEmail.trim())}>
                  {busy ? 'Sending…' : 'Send test'}
                </button>
              </div>
            )}
          </div>
        )}

        {error && <div className="mny-err">{error}</div>}
      </div>
    </div>
  );
}
