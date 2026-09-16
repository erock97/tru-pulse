import { useState } from 'react';
import { signOut } from '../lib/auth';
import { TruLogo } from '../components/TruLogo';
import '../truHqDark.css';

export default function AccountConnection({ email }: { email: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function switchAccount() {
    setBusy(true);
    setError('');
    try {
      await signOut();
      window.location.replace(window.location.pathname);
    } catch {
      setError('We could not sign you out. Please try again.');
      setBusy(false);
    }
  }
  return (
    <div className="tru-dark tru-auth">
      <div className="tru-auth-scrim" aria-hidden />
      <main className="tru-auth-card">
        <div className="tru-auth-logo"><TruLogo size={28} wordSize={20} sub="HQ" /></div>
        <h1 className="tru-auth-title">Let’s connect your account.</h1>
        <p className="tru-auth-sub">We couldn’t find your team access for this login.</p>
        {email && <p>Signed in as <strong>{email}</strong></p>}
        <p>Use the same email address that received your TRU HQ invitation. This connects your agent account to your Follow Up Boss profile so your activity and reporting stay linked to you. If you sign in with Google, choose that same email address.</p>
        <p>If this is the right address, try again or ask your team leader to check your invitation.</p>
        <p>You don’t need to provide any Follow Up Boss credentials.</p>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn full" disabled={busy} onClick={() => window.location.reload()}>Try again</button>
        <div className="tru-auth-foot">
          <button className="link" disabled={busy} onClick={() => void switchAccount()}>
            {busy ? 'Signing out…' : 'Sign in with another email'}
          </button>
        </div>
      </main>
    </div>
  );
}
