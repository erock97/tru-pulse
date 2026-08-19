// The one-time welcome. Shown once, on first login, before the assessment gate.
// There is no skip — a walkthrough you can dismiss is a walkthrough nobody reads,
// and screen three is what keeps the mandatory assessment from feeling like a hoop.
import { useState } from 'react';
import { markWelcomeSeen } from '../lib/api';

/** Copy approved by Eric 2026-08-18. Do not trim screen three. */
const SCREENS: { title: string; body: string }[] = [
  {
    title: 'Welcome to TRU',
    body: 'You’re here because your team invested in you. TRU is where your training, your '
      + 'coaching, and your commitments live in one place. It takes about ten minutes to get '
      + 'set up, and then you’re working.',
  },
  {
    title: 'How this works',
    body: 'Your team lead meets with you one-on-one. What you commit to in those meetings shows '
      + 'up on your home screen, so you always know what you said you’d do and how you’re '
      + 'tracking against it. Your training library sits alongside it — everything we’ve taught '
      + 'live, there to re-read whenever you need it.',
  },
  {
    title: 'First, we need to know how you work',
    body: 'Next is a short assessment. It’s not a test and there’s no score. It tells us how '
      + 'you’re wired — how you make decisions, how you handle pressure, what you need from a '
      + 'coach. Your team lead uses it to coach you the way you actually learn instead of the '
      + 'way they happen to teach. Take it honestly; it’s about ten minutes.',
  },
];

export default function AgentWelcome({ onDone, preview = false }: {
  onDone: () => void;
  /** Design walk-through: never stamps welcome_seen_at, so it can be replayed. */
  preview?: boolean;
}) {
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = i === SCREENS.length - 1;
  const s = SCREENS[i];

  async function finish() {
    setBusy(true);
    // A failed stamp must not trap them on the welcome. Worst case they see it
    // once more; being stuck behind it would be far worse.
    if (!preview) await markWelcomeSeen().catch(() => undefined);
    setBusy(false);
    if (preview) { setI(0); return; }   // replayable in the walk-through
    onDone();
  }

  return (
    <div className="asx-shell tru-dark">
      <div className="asx-card asx-reveal-card">
        <div className="asx-eyebrow">TRU</div>
        <h1 className="asx-h1">{s.title}</h1>
        <p className="asx-sub">{s.body}</p>
        <div className="ag-welcome-dots" aria-hidden="true">
          {SCREENS.map((_, n) => <span key={n} className={n === i ? 'is-on' : ''} />)}
        </div>
        <button
          className="asx-cta"
          disabled={busy}
          onClick={() => (last ? void finish() : setI(i + 1))}
        >
          {last ? (busy ? '…' : preview ? 'Start again ↺' : 'Start the assessment →') : 'Next →'}
        </button>
        {i > 0 && (
          <button className="link small" onClick={() => setI(i - 1)}>Back</button>
        )}
      </div>
    </div>
  );
}
