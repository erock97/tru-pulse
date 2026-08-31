/**
 * "Invoice confirmed" — what a Stripe invoice for this team WOULD contain,
 * then the button that makes it real.
 *
 * The preview here is informational: the worker re-reads the billable list
 * server-side at invoice time, so a stale tab can never decide what a broker
 * is charged. Already-invoiced deals are excluded by the server. The returned
 * `message` sentences are shown verbatim — they are written for this screen.
 *
 * Also lists this team's recent invoices (from the parent's overview payload,
 * no extra fetch) with a view link and a Void — voiding releases the invoice's
 * closings so they are billable again.
 */

import { useEffect, useState } from 'react';

import {
  invoiceTeam, previewTeamInvoice, saveBrokerEmail, sendInvoiceById, voidInvoiceById,
  type InvoicePreviewItem, type MoneyInvoice,
} from '../../lib/api';

interface Preview {
  closeMonth: string;
  items: InvoicePreviewItem[];
  count: number;
  totalLabel: string;
  broker: { email: string; name: string | null } | null;
}

export function InvoicePreviewPanel({
  team, year, month, invoices, onClose, onChanged,
}: {
  team: string;
  /** The BILLING month. */
  year: number;
  month: number;
  /** This team's recent invoices, from the overview the parent already holds. */
  invoices: MoneyInvoice[];
  onClose: () => void;
  /** Quiet overview refresh — new/voided invoices flow back in as props. */
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  const [previewErr, setPreviewErr] = useState('');
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'send' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Per-invoice action state, so one row's button never disables another's.
  const [invBusy, setInvBusy] = useState<string | null>(null);
  const [invMsg, setInvMsg] = useState('');

  useEffect(() => {
    let alive = true;
    void previewTeamInvoice(team, year, month).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setPreview({
          closeMonth: r.closeMonth,
          items: r.preview.items,
          count: r.preview.count,
          totalLabel: r.preview.totalLabel,
          broker: r.broker,
        });
      } else setPreviewErr(r.error);
    });
    return () => { alive = false; };
  }, [team, year, month]);

  const recipient = savedEmail ?? preview?.broker?.email ?? null;

  async function saveEmail() {
    setBusy('save');
    setError('');
    const r = await saveBrokerEmail(team, email.trim());
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setSavedEmail(r.email);
  }

  async function create(send: boolean) {
    setBusy(send ? 'send' : 'draft');
    setError('');
    const r = await invoiceTeam({ team, year, month, send, brokerEmail: recipient ?? undefined });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setDone(r.message);
    onChanged();
  }

  async function invoiceAction(inv: MoneyInvoice, kind: 'send' | 'void') {
    if (kind === 'void' && !window.confirm(
      `Void this invoice (${inv.amountDueLabel})? Its closings become billable again.`,
    )) return;
    setInvBusy(inv.id);
    setInvMsg('');
    const r = kind === 'void'
      ? await voidInvoiceById(inv.id, inv.teamName ?? undefined)
      : await sendInvoiceById(inv.id, inv.teamName ?? undefined);
    setInvBusy(null);
    setInvMsg(r.ok ? r.message : r.error);
    if (r.ok) onChanged();
  }

  return (
    <div className="rp-mgmt-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-mgmt-panel" role="dialog" aria-label={`Invoice ${team}`}>
        <div className="rp-mgmt-head">
          <div>
            <h2 style={{ margin: 0 }}>Invoice {team} — confirmed closings</h2>
            {preview && (
              <p className="mny-modal-sub">
                Close month {preview.closeMonth}. This drafts a Stripe invoice
                {'; '}already-invoiced deals are not included.
              </p>
            )}
          </div>
          <div className="rp-mgmt-headbtns">
            <button type="button" className="mny-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {done ? (
          <div className="mny-ok">{done}</div>
        ) : previewErr ? (
          <div className="mny-err">{previewErr}</div>
        ) : preview === undefined ? (
          <div className="mny-note">Reading confirmed closings…</div>
        ) : (
          <>
            <div>
              {preview.items.map((it) => (
                <div className="mny-inv-line" key={it.id}>
                  <span>
                    <span className="mny-deal-who">{it.address}</span>
                    <span className="mny-sub">
                      {' — '}
                      {[it.agentName, it.closeDate, it.source].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="mny-deal-right">{it.feeLabel}</span>
                </div>
              ))}
            </div>
            <div className="mny-inv-total">
              Total {preview.totalLabel} · {preview.count} closing{preview.count === 1 ? '' : 's'}
            </div>

            {recipient ? (
              <p className="mny-modal-sub">
                To {preview.broker?.name && !savedEmail ? `${preview.broker.name} <${recipient}>` : recipient}
              </p>
            ) : (
              <div className="mny-row">
                <div className="grow mny-field">
                  <label>Broker email — saved against this team</label>
                  <input type="email" value={email} placeholder="broker@brokerage.com"
                    onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button type="button" className="mny-btn" disabled={busy !== null || !email.trim()}
                  onClick={() => void saveEmail()}>
                  {busy === 'save' ? 'Saving…' : 'save'}
                </button>
              </div>
            )}

            <div className="mny-foot">
              <button type="button" className="mny-btn" disabled={busy !== null}
                onClick={() => void create(false)}>
                {busy === 'draft' ? 'Creating…' : 'Create draft'}
              </button>
              <button type="button" className="btn" disabled={busy !== null}
                onClick={() => void create(true)}>
                {busy === 'send' ? 'Sending…' : 'Create + send'}
              </button>
            </div>
          </>
        )}
        {error && <div className="mny-err">{error}</div>}

        {invoices.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <h4 style={{ margin: '0 0 6px' }}>Recent invoices</h4>
            {invoices.map((inv) => (
              <div className="mny-inv-line" key={inv.id}>
                <span>
                  <span className="mny-deal-who">
                    {inv.teamName && inv.closeMonth ? `${inv.teamName} · ${inv.closeMonth}` : (inv.customerName || inv.customerEmail || 'Invoice')}
                  </span>
                  <span className="mny-chip locked">{inv.status}</span>
                </span>
                <span className="mny-deal-acts" style={{ marginTop: 0 }}>
                  <span className="mny-deal-right">{inv.amountDueLabel}</span>
                  {inv.hostedInvoiceUrl && (
                    <a className="mny-link" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">view</a>
                  )}
                  {inv.status === 'draft' && (
                    <button type="button" className="mny-btn" disabled={invBusy !== null}
                      onClick={() => void invoiceAction(inv, 'send')}>
                      {invBusy === inv.id ? '…' : 'Send'}
                    </button>
                  )}
                  {['draft', 'open', 'sent'].includes(inv.status) && (
                    <button type="button" className="mny-btn no" disabled={invBusy !== null}
                      onClick={() => void invoiceAction(inv, 'void')}>
                      {invBusy === inv.id ? '…' : 'Void'}
                    </button>
                  )}
                </span>
              </div>
            ))}
            {invMsg && <div className="mny-note">{invMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
