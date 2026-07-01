import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const { error: authError } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (authError) setError(authError.message);
    else if (mode === 'signup') setNotice('Check your email to confirm, then sign in.');
    setBusy(false);
  }

  async function google() {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  }

  return (
    <div className="split">
      <div className="split-brand">
        <div className="brand-logo">T<span className="t">RU</span> Pulse</div>
        <h1>Know who's not working your paid leads — before it costs you a deal.</h1>
        <p>
          The accountability layer for real estate team leaders. Every paid lead, every source, every agent —
          watched, flagged, and turned into your move for the week.
        </p>
        <div className="brand-badges">
          <div className="bb"><div className="n">$51K/yr</div><div className="l">caught in one audit</div></div>
          <div className="bb"><div className="n">6</div><div className="l">lead sources tracked</div></div>
          <div className="bb"><div className="n">4&nbsp;min</div><div className="l">to your weekly moves</div></div>
        </div>
      </div>
      <div className="split-form">
        <div className="form-card">
          <h2>{mode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h2>
          <p className="muted small">Sign in to your accountability dashboard.</p>
          <form onSubmit={submit}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
            {error && <div className="err">{error}</div>}
            {notice && <div className="ok">{notice}</div>}
            <button className="btn full" style={{ marginTop: 16 }} disabled={busy} type="submit">
              {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div className="or">or</div>
          <button className="btn ghost full" onClick={google}>Continue with Google</button>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>
            {mode === 'signin' ? (
              <>New here? <a onClick={() => setMode('signup')}>Create an account</a></>
            ) : (
              <>Have an account? <a onClick={() => setMode('signin')}>Sign in</a></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
