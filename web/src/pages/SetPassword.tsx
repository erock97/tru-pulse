import { useState, type FormEvent } from 'react';
import { setPassword as savePassword } from '../lib/auth';
import { agentHome, claimAgent, type AgentSms } from '../lib/api';
import { TruLogo } from '../components/TruLogo';
import SmsConsentForm from './AgentSms';
import '../truHqDark.css';

// Shown when the user arrives via an invite or password-reset link (the URL hash
// carries a recovery/invite token that Supabase turns into a session). They set
// their own password here — we never mint or see it. AUTH LOGIC UNCHANGED — dark reskin.
//
// ── Why text-message consent is collected here ───────────────────────────────
//
// For an agent, this screen IS account creation: an invite is the only door into
// the product, and this is where they finish walking through it. That makes it
// the one moment where asking about text messages is a natural part of setting
// up rather than an interruption of work — which is both kinder and a materially
// better story to file with the carrier.
//
// It is a SECOND step rather than a checkbox beside the password fields, for two
// reasons that are worth not undoing:
//
//   1. The consent write needs a live session and a linked agent row. Both exist
//      only after the password is set, so doing it in one submit would mean
//      recording a tick we could not actually save.
//   2. Consent must not be bundled with anything else. A checkbox sitting in the
//      same form as "set your password" reads as a condition of getting an
//      account, and a reviewer who sees that is right to reject it.
//
// The step is skipped silently for anyone who is not an agent (a team leader or
// admin resetting their password), for anyone already asked, and everywhere the
// SMS migration has not been run.
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Non-null once the password is set AND this person turns out to be an agent we
  // have never asked about texts. Until then, this screen is exactly what it was.
  const [sms, setSms] = useState<AgentSms | null>(null);

  /**
   * Should we ask this person about text messages?
   *
   * Every failure path here answers "no". Not being an agent, a dead network, an
   * environment without the migration — none of them are reasons to hold someone
   * out of the product they just made an account for. The card on Home catches
   * anyone this skips.
   */
  async function smsStep(): Promise<AgentSms | null> {
    try {
      // Binds this login to their agent row by verified email. Idempotent, and it
      // has to happen before the consent RPC can find them.
      await claimAgent();
      const home = await agentHome();
      if (!home.sms) return null;            // migration not run in this environment
      if (home.sms.prompted_at) return null; // already asked, once, and that is enough
      return home.sms;
    } catch {
      return null;                           // not an agent, or offline
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('Those passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await savePassword(password);
      const next = await smsStep();
      setBusy(false);
      if (next) { setSms(next); return; }
      onDone();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not set that password.');
    }
  }

  return (
    <div className="tru-dark tru-auth">
      <video className="tru-auth-video" autoPlay muted loop playsInline poster="/hero-poster.jpg" aria-hidden>
        <source src="/hero-loop.mp4" type="video/mp4" />
      </video>
      <div className="tru-auth-scrim" aria-hidden />
      <div className="tru-auth-card">
        <div className="tru-auth-logo"><TruLogo size={28} wordSize={20} sub="HQ" /></div>

        {sms ? (
          <>
            <h1 className="tru-auth-title">One last thing — can your team lead text you?</h1>
            <p className="tru-auth-sub">
              Your account is ready. Some of what your lead needs from you lands
              faster as a text than an email. This is optional, nothing in TRU is
              locked behind it, and you can turn it off whenever you want.
            </p>
            <div className="tru-auth-sms">
              <SmsConsentForm
                sms={sms}
                ctaClass="btn full"
                onSaved={onDone}
                onDeclined={onDone}
                declineLabel="Skip — no texts"
              />
            </div>
          </>
        ) : (
          <>
            <h1 className="tru-auth-title">Set your password to finish setting up.</h1>
            <p className="tru-auth-sub">One login for your whole TRU HQ — Pulse and Coach, in one place.</p>
            <form onSubmit={submit}>
              <label>New password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
              <label>Confirm password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
              {error && <div className="err">{error}</div>}
              <button className="btn full" disabled={busy} type="submit">
                {busy ? '…' : 'Set password & continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
