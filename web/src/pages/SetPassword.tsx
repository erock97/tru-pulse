import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

// Shown when the user arrives via an invite or password-reset link (the URL hash
// carries a recovery/invite token that Supabase turns into a session). They set
// their own password here — we never mint or see it.
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
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else onDone();
  }

  return (
    <div className="split">
      <div className="split-brand">
        <div className="brand-logo">T<span className="t">RU</span> HQ</div>
        <h1>Set your password to finish setting up your account.</h1>
        <p>One login for your whole TRU HQ — Pulse and Coach, in one place.</p>
      </div>
      <div className="split-form">
        <div className="form-card">
          <h2>Choose a password</h2>
          <p className="muted small">This secures your TRU HQ login.</p>
          <form onSubmit={submit}>
            <label>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
            <label>Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
            {error && <div className="err">{error}</div>}
            <button className="btn full" style={{ marginTop: 16 }} disabled={busy} type="submit">
              {busy ? '…' : 'Set password & continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
