/**
 * Review → approve → send (or void) for one TruSign envelope.
 *
 * The mechanism is TRU OS's SendWizard, kept exactly: what you approve is the
 * live review bundle, re-fetched at the moment you click, and the approval is
 * scoped to the exact version that was on screen. If the envelope changed
 * between opening this panel and clicking approve, the click aborts — nothing
 * is approved against content you did not read.
 *
 * The four steps on approve:
 *   1. re-fetch the review
 *   2. compare its version to the one displayed — mismatch aborts
 *   3. record the approval → one-time token
 *   4. spend the token on send/void
 *
 * Every refusal from the worker (the 409s especially) is a sentence written
 * for the person at the screen; it is shown verbatim, never paraphrased.
 */

import { useEffect, useState } from 'react';

import {
  approveContractAction, contractReview, sendContract, voidContract,
  type ContractEnvelopeReview,
} from '../../lib/api';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SendReviewPanel({
  envelopeId, mode, onClose, onDone,
}: {
  envelopeId: string;
  /** 'send' emails the signing links; 'void' kills the envelope. Same review,
   *  same approval discipline, different final verb. */
  mode: 'send' | 'void';
  onClose: () => void;
  /** The action went through — the parent should refresh its overview. */
  onDone: () => void;
}) {
  const [bundle, setBundle] = useState<ContractEnvelopeReview | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void contractReview(envelopeId).then((r) => {
      if (!alive) return;
      if (r.ok) setBundle(r.envelope);
      else setLoadErr(r.error);
    });
    return () => { alive = false; };
  }, [envelopeId]);

  const verb = mode === 'send' ? 'Send' : 'Void';

  async function approve() {
    if (!bundle) return;
    setBusy(true);
    try {
      // 1–2: what is being approved is what is on screen. Re-read and compare.
      const current = await contractReview(envelopeId);
      if (!current.ok) throw new Error(current.error);
      if (current.envelope.version !== bundle.version) {
        throw new Error('Envelope changed — close this review and open it again.');
      }
      const version = current.envelope.version;
      // 3: the approval, scoped to this action + envelope + exact version.
      const approval = await approveContractAction({ action: mode, envelopeId, version });
      if (!approval.ok) throw new Error(approval.error);
      // 4: spend the one-time token.
      const res = mode === 'send'
        ? await sendContract({ envelopeId, version, approvalToken: approval.token })
        : await voidContract({ envelopeId, version, approvalToken: approval.token });
      if (!res.ok) throw new Error(res.error);
      setResult({ ok: true, text: res.message });
      onDone();
    } catch (err) {
      setResult({ ok: false, text: (err as Error)?.message || `${verb} failed.` });
    } finally {
      setBusy(false);
    }
  }

  const signatureFields = bundle
    ? bundle.fields.filter((f) => f.type === 'signature' || f.type === 'initials').length
    : null;

  return (
    <div className="rp-mgmt-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-mgmt-panel" role="dialog" aria-label={`${verb} contract`}>
        <div className="rp-mgmt-head">
          <div>
            <h2 style={{ margin: 0 }}>{verb} — {bundle?.title || 'reading the envelope…'}</h2>
            <p className="mny-modal-sub">
              {mode === 'send'
                ? 'Review what TruSign will actually send, then approve. Approval is final.'
                : 'Review what would be voided, then approve. A voided envelope cannot be revived.'}
            </p>
          </div>
          <div className="rp-mgmt-headbtns">
            <button type="button" className="mny-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {result ? (
          <>
            <div className={result.ok ? 'mny-ok' : 'mny-err'}>{result.text}</div>
            <div className="mny-foot">
              <button type="button" className="btn" onClick={onClose}>Done</button>
            </div>
          </>
        ) : loadErr ? (
          <div className="mny-err">{loadErr}</div>
        ) : !bundle ? (
          <div className="mny-note">Reading the live envelope from TruSign…</div>
        ) : (
          <>
            <div className="ctr-review">
              <div className="ctr-review-row">
                <span className="k">Status</span>
                <span className="v">{bundle.status}</span>
              </div>
              {(bundle.clientName || bundle.team) && (
                <div className="ctr-review-row">
                  <span className="k">Client</span>
                  <span className="v">{[bundle.clientName, bundle.team].filter(Boolean).join(' · ')}</span>
                </div>
              )}
              <div className="ctr-review-row">
                <span className="k">Recipients</span>
                <span className="v">
                  {bundle.recipients.length
                    ? bundle.recipients.map((r) => (
                        <span key={r.id} style={{ display: 'block' }}>
                          {r.name} &lt;{r.email}&gt; — {r.role}, signs #{r.routingOrder}
                        </span>
                      ))
                    : 'none'}
                </span>
              </div>
              <div className="ctr-review-row">
                <span className="k">Documents</span>
                <span className="v">
                  {bundle.documents.length
                    ? bundle.documents.map((d) => `${d.originalFilename} · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}`).join(', ')
                    : 'none'}
                </span>
              </div>
              <div className="ctr-review-row">
                <span className="k">Signature fields</span>
                <span className="v">{signatureFields}</span>
              </div>
              {bundle.expiresAt && (
                <div className="ctr-review-row">
                  <span className="k">Expires</span>
                  <span className="v">{fmtDate(bundle.expiresAt)}</span>
                </div>
              )}
            </div>

            {mode === 'send' && (
              <div className="ctr-warn">
                Approving emails this envelope&apos;s signing link(s) via TruSign immediately.
                This review is the final confirmation before it fires.
              </div>
            )}
            {mode === 'void' && (
              <div className="ctr-warn">
                Approving voids this envelope in TruSign. Anyone holding a signing link loses it.
              </div>
            )}

            <div className="mny-foot">
              <button type="button" className="btn" disabled={busy} onClick={() => void approve()}>
                {busy
                  ? (mode === 'send' ? 'Sending…' : 'Voiding…')
                  : (mode === 'send' ? 'Approve & send' : 'Approve & void')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
