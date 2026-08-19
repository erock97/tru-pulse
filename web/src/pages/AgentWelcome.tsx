// The one-time welcome. Shown once, on first login, before the assessment gate.
// There is no skip — a walkthrough you can dismiss is a walkthrough nobody reads,
// and screen three is what keeps the mandatory assessment from feeling like a hoop.
//
// This is an agent's FIRST sight of TRU, so it wears the brand, not the app: the
// same `.truland` system as truhq.co — the hero loop behind a scrim, the grain,
// the pill badge, the serif headline with the gold italic and its drawn underline,
// and the pill CTA. All of it already existed in Landing.css and web/public; none
// of it is invented here.
import { useEffect, useRef, useState } from 'react';
import { markWelcomeSeen } from '../lib/api';
import './Landing.css';

/** The pill arrow the marketing CTAs use. */
const arrow = (
  <span className="pea" aria-hidden>
    <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  </span>
);

/** Copy approved by Eric 2026-08-18. Screen three is load-bearing — it is what
 *  keeps the mandatory assessment from reading as a hoop. Do not trim it. */
const SCREENS: {
  badge: string;
  lines: string[];
  /** The closing line, set in gold italic under the drawn stroke. */
  say: string;
  body: string;
  cta: string;
}[] = [
  {
    badge: 'Welcome to TRU',
    lines: ['Your team', 'invested in'],
    say: 'you.',
    body: 'TRU is where your training, your coaching, and your commitments live in one '
      + 'place. It takes about ten minutes to get set up, and then you’re working.',
    cta: 'Next',
  },
  {
    badge: 'How this works',
    lines: ['What you', 'commit to'],
    say: 'shows up here.',
    body: 'Your team lead meets with you one-on-one. What you commit to in those meetings '
      + 'shows up on your home screen, so you always know what you said you’d do and how '
      + 'you’re tracking against it. Your training library sits alongside it — everything '
      + 'we’ve taught live, there to re-read whenever you need it.',
    cta: 'Next',
  },
  {
    badge: 'First, the assessment',
    lines: ['We need to', 'know how'],
    say: 'you work.',
    body: 'It’s not a test and there’s no score. It tells us how you’re wired — how you '
      + 'make decisions, how you handle pressure, what you need from a coach. Your team '
      + 'lead uses it to coach you the way you actually learn instead of the way they '
      + 'happen to teach. Take it honestly; it’s about ten minutes.',
    cta: 'Start the assessment',
  },
];

/** The path through setup, so an agent can see how far it goes before starting. */
const STEPS = ['Welcome', 'How this works', 'Your assessment'];

export default function AgentWelcome({ onDone, preview = false }: {
  onDone: () => void;
  /** Design walk-through: never stamps welcome_seen_at, so it can be replayed. */
  preview?: boolean;
}) {
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  // `.truland.ready` is what releases the line reveal and draws the underline.
  // Set on the next tick so the transition has a start state to move from, and
  // re-armed per screen so each one plays rather than only the first.
  const [ready, setReady] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setReady(false);
    timer.current = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(timer.current);
  }, [i]);

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
    <div className={`truland aw${ready ? ' ready' : ''}`}>
      <div className="bg">
        <video autoPlay muted loop playsInline preload="auto" poster="/hero-poster.jpg">
          <source src="/hero-loop.mp4" type="video/mp4" />
        </video>
        <div className="scrim" />
      </div>
      <div className="grain" />

      <header className="aw-bar">
        <div className="wrap aw-bar-in">
          <span className="aw-mark">TRU</span>
          <ol className="aw-steps" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((label, n) => (
              <li
                key={label}
                className={`aw-stepdot${n === i ? ' is-on' : ''}${n < i ? ' is-done' : ''}`}
                aria-current={n === i ? 'step' : undefined}
              >
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="hero aw-stage">
        <div className="wrap">
          <div key={i}>
            <span className="badge fade"><span className="s" />{s.badge}</span>
            <h1>
              {s.lines.map((line) => (
                <span className="line" key={line}><span>{line}</span></span>
              ))}
              {/* The drawn stroke hugs the words, so `.say` has to be an inline
                  child of the line rather than the line's own block span — as a
                  block it stretches the underline across the whole column. */}
              <span className="line">
                <span>
                  <span className="say">
                    {s.say}
                    <svg viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden>
                      <path d="M3 8 C 60 2, 110 11, 160 6 S 250 2, 297 7" />
                    </svg>
                  </span>
                </span>
              </span>
            </h1>
            <p className="hsub fade">{s.body}</p>
            <div className="hcta fade">
              <button
                className="cta"
                disabled={busy}
                onClick={() => (last ? void finish() : setI(i + 1))}
              >
                {last && preview ? 'Start again' : busy ? 'One moment' : s.cta}{arrow}
              </button>
              {i > 0 && (
                <button className="cta ghost" onClick={() => setI(i - 1)}>Back</button>
              )}
              <span className="micro">
                Step {i + 1} of {STEPS.length} · about ten minutes in total
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
