// The one-time welcome. Shown once, on first login, before the assessment gate.
// There is no skip — a walkthrough you can dismiss is a walkthrough nobody reads,
// and screen three is what keeps the mandatory assessment from feeling like a hoop.
//
// Dressed in the HQ language, not the assessment's card: full-bleed dark canvas,
// the ambient gold wash, Playfair headings, the same hero panel and button an
// agent meets everywhere else. It is their first sight of TRU and it should look
// like the product they were told they were getting.
import { useState } from 'react';
import { markWelcomeSeen } from '../lib/api';
import { TruLogo } from '../components/TruLogo';
import { useForceHqDark } from '../hqHooks';
import '../truHqDark.css';

/** Copy approved by Eric 2026-08-18. Do not trim screen three. */
const SCREENS: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: 'Welcome to TRU',
    title: 'Your team invested in you.',
    body: 'TRU is where your training, your coaching, and your commitments live in one '
      + 'place. It takes about ten minutes to get set up, and then you’re working.',
  },
  {
    eyebrow: 'How this works',
    title: 'What you commit to shows up here.',
    body: 'Your team lead meets with you one-on-one. What you commit to in those meetings '
      + 'shows up on your home screen, so you always know what you said you’d do and how '
      + 'you’re tracking against it. Your training library sits alongside it — everything '
      + 'we’ve taught live, there to re-read whenever you need it.',
  },
  {
    eyebrow: 'First, the assessment',
    title: 'We need to know how you work.',
    body: 'It’s not a test and there’s no score. It tells us how you’re wired — how you '
      + 'make decisions, how you handle pressure, what you need from a coach. Your team '
      + 'lead uses it to coach you the way you actually learn instead of the way they '
      + 'happen to teach. Take it honestly; it’s about ten minutes.',
  },
];

/** The path through setup, so an agent can see how far it goes before starting. */
const STEPS: { label: string; note: string }[] = [
  { label: 'Welcome', note: 'About a minute' },
  { label: 'How this works', note: 'What your lead sees' },
  { label: 'Your assessment', note: 'About ten minutes' },
];

export default function AgentWelcome({ onDone, preview = false }: {
  onDone: () => void;
  /** Design walk-through: never stamps welcome_seen_at, so it can be replayed. */
  preview?: boolean;
}) {
  useForceHqDark();
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
    <div className="tru-dark aw-shell">
      <header className="aw-top">
        <div className="aw-row">
          <TruLogo size={28} wordSize={20} sub="HQ" />
        </div>
      </header>

      <main className="aw-main">
        <div className="aw-ambient" aria-hidden />
        <div className="aw-stage" key={i}>
          <div className="main-eyebrow">{s.eyebrow}</div>
          <h1 className="aw-title">{s.title}</h1>

          <section className="aw-hero">
            <p>{s.body}</p>
            <div className="aw-foot">
              <button className="ah-btn" disabled={busy} onClick={() => (last ? void finish() : setI(i + 1))}>
                {last ? (busy ? '…' : preview ? 'Start again ↺' : 'Start the assessment →') : 'Next →'}
              </button>
              {i > 0 && (
                <button className="aw-back" onClick={() => setI(i - 1)}>Back</button>
              )}
            </div>
          </section>

          {/* The road ahead, named. Three anonymous dots tell an agent nothing;
              this tells them how long this takes and what is on the far side. */}
          <ol className="aw-rail" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((step, n) => (
              <li
                key={step.label}
                className={`aw-rail-step${n === i ? ' is-on' : ''}${n < i ? ' is-done' : ''}`}
                aria-current={n === i ? 'step' : undefined}
              >
                <span className="aw-rail-num">{n < i ? '✓' : n + 1}</span>
                <span className="aw-rail-txt">
                  <strong>{step.label}</strong>
                  <em>{step.note}</em>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </main>
    </div>
  );
}
