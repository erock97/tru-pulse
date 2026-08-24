import { useState, type FormEvent } from 'react';
import { signIn, signUp, signInWithGoogle, requestPasswordReset } from '../lib/auth';
import { TruLogo } from '../components/TruLogo';
import '../truHqDark.css';

// The front door — the marketing site's forest room, with one thing in it.
//
// The old screen was a 50/50 split: video pitch on the left, form on the right.
// Eric's verdict: flat, didn't feel like a piece of the website, and the split
// itself was the problem. The site's identity is a dark green room lit by a
// warm source at the head, the Trinity scene settled into the backdrop, bone
// Fraunces type, hairline enclosures. So the login IS that room now: the scene
// defocused behind (the site's own settle treatment), one centered door, and
// nothing selling — the person at this door already owns the product.
//
// Every call still goes through lib/auth; nothing here knows what a token is.
export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // A failed Google sign-in comes back as ?auth_error=<why>. Showing it matters more
  // than it looks: without this the browser lands back here having silently discarded
  // the reason, which is indistinguishable from the button doing nothing at all.
  const [error, setError] = useState(() => {
    if (typeof window === 'undefined') return '';
    const why = new URLSearchParams(window.location.search).get('auth_error');
    if (!why) return '';
    history.replaceState(null, '', window.location.pathname);
    return ({
      google_declined: 'Google sign-in was cancelled.',
      link_expired: 'That sign-in took too long, or started in another browser. Try again.',
      no_code: 'Google did not send us back a sign-in code. Try again.',
      signin_failed: 'We could not finish signing you in with Google. Try again, or use your email and password.',
    } as Record<string, string>)[why] ?? 'Google sign-in did not complete. Try again.';
  });
  const [notice, setNotice] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        const { confirm } = await signUp(email, password);
        // Only say "check your email" when there genuinely is no session yet.
        if (confirm) setNotice('Check your email to confirm, then sign in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
    setBusy(false);
  }

  async function google() {
    await signInWithGoogle();
  }

  async function forgot() {
    if (!email) { setError('Enter your email first, then tap Forgot password.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await requestPasswordReset(email);
      setNotice('Check your email for a link to reset your password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that email.');
    }
    setBusy(false);
  }

  return (
    <div className="tru-dark tru-door">
      {/* The room: gradient light, the settled scene, and the scrim that holds
          the light off the type. All three are paint, none of them is content. */}
      <div className="tru-door-scene" aria-hidden />
      <div className="tru-door-scrim" aria-hidden />

      <main className="tru-door-stage">
        <div className="tru-door-mark"><TruLogo size={34} wordSize={24} sub="HQ" /></div>

        <h1 className="tru-door-title">
          {mode === 'signin' ? 'Welcome back.' : 'Create your account.'}
        </h1>
        <p className="tru-door-sub">
          {mode === 'signin' ? 'Sign in to your TRU HQ.' : 'Set a password and you are in.'}
        </p>

        <div className="tru-door-panel">
          <form onSubmit={submit}>
            <label className="tru-door-label" htmlFor="door-email">Email</label>
            <input
              id="door-email"
              className="tru-door-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <label className="tru-door-label" htmlFor="door-password">Password</label>
            <input
              id="door-password"
              className="tru-door-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
            {mode === 'signin' && (
              <button type="button" className="tru-door-forgot" onClick={forgot}>Forgot password?</button>
            )}
            {error && <div className="tru-door-note is-error" role="alert">{error}</div>}
            {notice && <div className="tru-door-note is-ok" role="status">{notice}</div>}
            <button className="tru-door-primary" disabled={busy} type="submit">
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="tru-door-or" aria-hidden><span /><em>or</em><span /></div>

          <button className="tru-door-google" onClick={google} type="button">
            {/* Google's own G — the recognized affordance for this button. */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </button>
        </div>

        <p className="tru-door-swap">
          {mode === 'signin' ? (
            <>New here? <button type="button" onClick={() => setMode('signup')}>Create an account</button></>
          ) : (
            <>Have an account? <button type="button" onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </p>
      </main>
    </div>
  );
}
