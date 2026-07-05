import { useState, type FormEvent, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { TruLogo } from '../components/TruLogo';
import '../truHqDark.css';

// Dark reskin of the sign-in page — matches the dark app. AUTH LOGIC UNCHANGED:
// same signInWithPassword / signUp / OAuth / resetPasswordForEmail calls.
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

  async function forgot() {
    if (!email) { setError('Enter your email first, then tap Forgot password.'); return; }
    setBusy(true); setError(''); setNotice('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setBusy(false);
    if (err) setError(err.message);
    else setNotice('Check your email for a link to reset your password.');
  }

  const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 6 };
  const input: CSSProperties = { width: '100%', padding: '12px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text-strong)', fontSize: 15, fontFamily: 'inherit', outline: 'none' };
  const gold: CSSProperties = { width: '100%', background: 'var(--accent)', color: '#1a1206', fontWeight: 800, border: 0, padding: '12px 18px', borderRadius: 10, cursor: 'pointer', fontSize: 15 };
  const ghost: CSSProperties = { width: '100%', background: 'var(--card)', color: 'var(--text-strong)', fontWeight: 700, border: '1px solid var(--border)', padding: '12px 18px', borderRadius: 10, cursor: 'pointer', fontSize: 15 };
  const link: CSSProperties = { color: 'var(--accent-hi)', cursor: 'pointer', fontWeight: 700 };
  const note: CSSProperties = { borderRadius: 8, padding: '9px 12px', fontSize: 13, margin: '12px 0' };

  return (
    <div className="tru-dark tru-login">
      <div className="tru-login-brand">
        <div className="tru-login-glow" aria-hidden />
        <div className="tru-login-brand-inner">
          <div style={{ marginBottom: 28 }}><TruLogo size={30} wordSize={22} sub="HQ" /></div>
          <h1 style={{ fontFamily: 'var(--hq-font)', fontSize: 'clamp(28px,3.6vw,42px)', fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.02em', color: 'var(--on-hero)' }}>
            Your team, one login — Pulse and Coach in one place.
          </h1>
          <p style={{ color: 'var(--on-hero-60)', fontSize: 17, marginTop: 16, maxWidth: '46ch' }}>
            See who's not working your paid leads, coach each agent the way they're wired, and make
            your move for the week — all from one TRU HQ.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }}>
            {[['$51K/yr', 'caught in one audit'], ['6', 'lead sources tracked'], ['4 min', 'to your weekly moves']].map(([n, l]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--accent-hi)' }}>{n}</div>
                <div style={{ fontSize: 12, color: 'var(--on-hero-60)' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tru-login-form">
        <div style={{ width: '100%', maxWidth: 380 }}>
          <h2 style={{ fontFamily: 'var(--hq-font)', fontSize: 28, fontWeight: 700, color: 'var(--text-strong)' }}>
            {mode === 'signin' ? 'Welcome back.' : 'Create your account.'}
          </h2>
          <p style={{ color: 'var(--text-60)', fontSize: 14, marginTop: 4 }}>Sign in to your TRU HQ.</p>
          <form onSubmit={submit} style={{ marginTop: 22 }}>
            <label style={label}>Email</label>
            <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <div style={{ height: 14 }} />
            <label style={label}>Password</label>
            <input
              style={input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
            {mode === 'signin' && (
              <a style={{ display: 'block', marginTop: 10, color: 'var(--text-60)', fontSize: 13, cursor: 'pointer' }} onClick={forgot}>Forgot password?</a>
            )}
            {error && <div style={{ ...note, background: 'rgba(192,107,79,0.14)', border: '1px solid rgba(192,107,79,0.4)', color: '#e0a48c' }}>{error}</div>}
            {notice && <div style={{ ...note, background: 'rgba(74,124,111,0.14)', border: '1px solid rgba(74,124,111,0.4)', color: '#6fbfa9' }}>{notice}</div>}
            <button style={{ ...gold, marginTop: 16 }} disabled={busy} type="submit">
              {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', color: 'var(--text-50)', fontSize: 13 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} /> or <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
          </div>
          <button style={ghost} onClick={google}>Continue with Google</button>
          <p style={{ textAlign: 'center', marginTop: 18, color: 'var(--text-60)', fontSize: 13 }}>
            {mode === 'signin' ? (
              <>New here? <a style={link} onClick={() => setMode('signup')}>Create an account</a></>
            ) : (
              <>Have an account? <a style={link} onClick={() => setMode('signin')}>Sign in</a></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
