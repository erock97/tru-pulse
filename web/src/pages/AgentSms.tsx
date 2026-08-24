// Text-message consent — the screen an A2P reviewer will be shown, and the record
// that makes texting a team member lawful.
//
// This screen has an unusual property: it is evidence. Twilio's campaign review
// asks for a screenshot of exactly this page, and the carrier decides whether to
// approve the number based on what is visible on it. Everything below is here
// because a reviewer looks for it:
//
//   · the sending brand, named
//   · what kinds of message will be sent, specifically
//   · "message frequency varies"
//   · "message and data rates may apply"
//   · how to stop, and how to get help
//   · links to the public SMS terms and privacy policy
//   · a checkbox that starts UNCHECKED, separate from any terms-of-service tick
//
// Two rules that are easy to break by accident:
//
//   1. The checkbox is never pre-checked and never bundled with anything else.
//      Consent has to be an affirmative act taken on its own.
//   2. There is always a way past this screen without agreeing. Consent obtained
//      by blocking someone from the product they need for their job is not
//      consent, and a reviewer who sees no way out will read it the same way.
//
// The consent sentence itself is NOT written here — it comes from
// shared/smsConsent.ts, and the Worker writes its own copy of that same constant
// into the ledger. That is what lets us say, later, that the words stored are the
// words shown.
import { useState } from 'react';
import { smsOptIn, smsOptOut, smsDecline, type AgentSms } from '../lib/api';
import {
  SMS_CONSENT_TEXT, SMS_TERMS_URL, SMS_PRIVACY_URL, SMS_SUPPORT_EMAIL,
  toE164US, formatUS,
} from '../../../shared/smsConsent.js';

/** What the agent is told they are signing up for, in their words rather than the
 *  carrier's. Kept next to the legal sentence, never instead of it. */
const EXAMPLES = [
  'A reminder about a deadline on one of your files',
  'A check-in on something you committed to at your last 1:1',
  'A question from your team lead that needs a quick answer',
];

/**
 * The form itself. Shared by the onboarding step and the Home settings card so
 * there is exactly one implementation of the checkbox — two would eventually
 * disagree about what was consented to.
 */
export function SmsConsentForm({ sms, onSaved, onDeclined, declineLabel }: {
  sms: AgentSms;
  onSaved: () => void;
  onDeclined?: () => void;
  declineLabel?: string;
}) {
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<'in' | 'out' | 'skip' | null>(null);
  const [err, setErr] = useState('');

  const e164 = toE164US(phone);
  // Only complain about a number once they have typed enough for it to be wrong,
  // rather than colouring the field red on the first keystroke.
  const phoneLooksWrong = phone.replace(/\D/g, '').length >= 10 && !e164;
  const canSubmit = !!e164 && agreed && busy === null;

  async function optIn() {
    if (!canSubmit) return;
    setBusy('in'); setErr('');
    try {
      await smsOptIn(phone);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That didn’t save — try again.');
    } finally {
      setBusy(null);
    }
  }

  async function optOut() {
    setBusy('out'); setErr('');
    try {
      await smsOptOut();
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'We could not turn that off.');
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setBusy('skip');
    // A failed stamp must not trap them here. Worst case they are asked once more.
    await smsDecline().catch(() => undefined);
    setBusy(null);
    onDeclined?.();
  }

  // ── Already on ─────────────────────────────────────────────────────────────
  // Someone who has consented gets one thing from this screen: the ability to
  // stop. No re-confirmation, no "are you sure" — an opt-out is one click, always.
  if (sms.reachable) {
    return (
      <div className="ag-sms">
        <p className="ag-sms-on">
          <strong>Text messages are on</strong> for the number ending {sms.last_four}.
          {sms.consent_at && ` You turned these on ${new Date(sms.consent_at).toLocaleDateString()}.`}
        </p>
        <p className="ag-sms-fine">
          You can also stop them at any time by replying <strong>STOP</strong> to any
          message we send you, or reply <strong>HELP</strong> for help.
        </p>
        <button className="ag-sms-off" disabled={busy !== null} onClick={() => void optOut()}>
          {busy === 'out' ? 'Turning off…' : 'Turn off text messages'}
        </button>
        {err && <div className="ag-err">{err}</div>}
      </div>
    );
  }

  // ── Off, having previously opted out ───────────────────────────────────────
  const wasStopped = !!sms.opt_out_at;

  return (
    <div className="ag-sms">
      {wasStopped && (
        <p className="ag-sms-fine">
          Text messages are currently off for you. You can turn them back on below.
        </p>
      )}

      <ul className="ag-sms-eg">
        {EXAMPLES.map((e) => <li key={e}>{e}</li>)}
      </ul>
      <p className="ag-sms-fine">
        We never text you marketing, and we never text your clients or leads from
        here. This is your team only.
      </p>

      <label className="ag-sms-field">
        <span>Your mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 555-0123"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={phoneLooksWrong}
        />
      </label>
      {phoneLooksWrong && (
        <div className="ag-sms-warn">That doesn’t look like a US mobile number.</div>
      )}
      {e164 && <div className="ag-sms-ok">We’ll text {formatUS(e164)}.</div>}

      {/*
        The consent tick. Unchecked on arrival, on its own, with the full sentence
        beside it rather than behind a link. Do not merge this with any other
        agreement on the screen and do not default it to true — both would
        invalidate every consent recorded through it.
      */}
      <label className="ag-sms-consent">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          {SMS_CONSENT_TEXT}{' '}
          <a href={SMS_TERMS_URL} target="_blank" rel="noreferrer">SMS terms</a>
          {' · '}
          <a href={SMS_PRIVACY_URL} target="_blank" rel="noreferrer">Privacy policy</a>
        </span>
      </label>

      <button className="asx-cta" disabled={!canSubmit} onClick={() => void optIn()}>
        {busy === 'in' ? 'Saving…' : 'Turn on text messages'}
      </button>

      {onDeclined && (
        <button className="link small" disabled={busy !== null} onClick={() => void decline()}>
          {busy === 'skip' ? '…' : (declineLabel ?? 'Not now')}
        </button>
      )}

      <p className="ag-sms-fine">
        Questions about this? Email <a href={`mailto:${SMS_SUPPORT_EMAIL}`}>{SMS_SUPPORT_EMAIL}</a>.
      </p>

      {err && <div className="ag-err">{err}</div>}
    </div>
  );
}

/**
 * The onboarding step. Shown once, after the assessment, and never again — see
 * agentStage.ts for why this is a step and not a gate.
 */
export default function AgentSmsStep({ sms, onDone }: { sms: AgentSms; onDone: () => void }) {
  return (
    <div className="asx-shell tru-dark">
      <div className="asx-card asx-reveal-card ag-sms-card">
        <div className="asx-eyebrow">TRU</div>
        <h1 className="asx-h1">Can your team lead text you?</h1>
        <p className="asx-sub">
          Your lead works out of TRU, and some of what they need from you is faster
          as a text than an email. This is optional — nothing in the product is
          locked behind it, and you can turn it off whenever you want.
        </p>
        <SmsConsentForm sms={sms} onSaved={onDone} onDeclined={onDone} declineLabel="Not now" />
      </div>
    </div>
  );
}
