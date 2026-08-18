import { useState, type FormEvent } from 'react';
import { setPassword as savePassword } from '../lib/auth';
import { SET_PASSWORD_SUB, SET_PASSWORD_TITLE } from '../lib/agentHq';
import { TruLogo } from '../components/TruLogo';
import '../truHqDark.css';

// Shown when the user arrives via an invite or password-reset link (the URL hash
// carries a recovery/invite token that Supabase turns into a session). They set
// their own password here — we never mint or see it. AUTH LOGIC UNCHANGED — dark reskin.
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('Those passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await savePassword(password);
      setBusy(false);
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
        <h1 className="tru-auth-title">{SET_PASSWORD_TITLE}</h1>
        <p className="tru-auth-sub">{SET_PASSWORD_SUB}</p>
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
      </div>
    </div>
  );
}
