// The one-time welcome. Shown once, on first login, before the assessment gate.
// There is no skip — a walkthrough you can dismiss is a walkthrough nobody reads,
// and screen three is what keeps the mandatory assessment from feeling like a hoop.
//
// Built from the SAME primitives as Home, Coach and Rep — `.tru-shell`, the
// sidebar, the topbar, `.hh-hero`, `.hqcard`, `.hqbtn`. Not a lookalike: the same
// classes, so it inherits those pages' surfaces, spacing and type scale and stays
// matched to them when they change.
//
// The sidebar carries the three setup steps rather than the app's tabs. Those tabs
// are gated until the assessment is done, and offering navigation that refuses to
// navigate is worse than not showing it.
import { useState } from 'react';
import { markWelcomeSeen } from '../lib/api';
import { TruLogo } from '../components/TruLogo';
import { Icon } from '../components/hqUi';
import { useForceHqDark } from '../hqHooks';
import '../truHqDark.css';

/** Copy approved by Eric 2026-08-18. Screen three is load-bearing — it is what
 *  keeps the mandatory assessment from reading as a hoop. Do not trim it. */
const SCREENS: {
  step: string;
  eyebrow: string;
  title: string;
  heroTitle: string;
  body: string;
  cta: string;
  aside: { title: string; body: string };
  stats: { n: string; label: string }[];
}[] = [
  {
    step: 'Welcome',
    eyebrow: 'Getting set up',
    title: 'Welcome to TRU.',
    heroTitle: 'Your team invested in you.',
    body: 'TRU is where your training, your coaching, and your commitments live in one '
      + 'place. It takes about ten minutes to get set up, and then you’re working.',
    cta: 'Next',
    aside: {
      title: 'What you get',
      body: 'One login for the training library, your coaching, and everything you and '
        + 'your team lead agree on.',
    },
    stats: [
      { n: '3', label: 'Steps to finish' },
      { n: '10', label: 'Minutes, about' },
      { n: '1', label: 'Login for everything' },
    ],
  },
  {
    step: 'How this works',
    eyebrow: 'Getting set up',
    title: 'How this works.',
    heroTitle: 'What you commit to shows up here.',
    body: 'Your team lead meets with you one-on-one. What you commit to in those meetings '
      + 'shows up on your home screen, so you always know what you said you’d do and how '
      + 'you’re tracking against it. Your training library sits alongside it — everything '
      + 'we’ve taught live, there to re-read whenever you need it.',
    cta: 'Next',
    aside: {
      title: 'Your one-on-ones',
      body: 'Wins, commitments and where you are against them. Your lead’s own notes stay '
        + 'theirs — you see what you agreed to.',
    },
    stats: [
      { n: 'Home', label: 'What you owe, and your pace' },
      { n: 'Coach', label: 'Your profile and your 1:1s' },
      { n: 'Training', label: 'Everything taught live' },
    ],
  },
  {
    step: 'Your assessment',
    eyebrow: 'Getting set up',
    title: 'One thing first.',
    heroTitle: 'We need to know how you work.',
    body: 'It’s not a test and there’s no score. It tells us how you’re wired — how you '
      + 'make decisions, how you handle pressure, what you need from a coach. Your team '
      + 'lead uses it to coach you the way you actually learn instead of the way they '
      + 'happen to teach. Take it honestly; it’s about ten minutes.',
    cta: 'Start the assessment',
    aside: {
      title: 'About ten minutes',
      body: 'Two short parts — who you are, then how you work. There are no wrong answers '
        + 'and nothing to revise for.',
    },
    stats: [
      { n: '2', label: 'Short parts' },
      { n: '0', label: 'Wrong answers' },
      { n: '10', label: 'Minutes, about' },
    ],
  },
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
    <div className="tru-dark">
      <div className="tru-shell">
        <aside className="side">
          <div className="side-logo">
            <TruLogo size={28} wordSize={20} sub="HQ" />
          </div>
          <nav className="side-nav" aria-label="Setup">
            {SCREENS.map((scr, n) => (
              <div
                key={scr.step}
                className={`side-link aw-side-step${n === i ? ' active' : ''}${n < i ? ' is-done' : ''}`}
                aria-current={n === i ? 'step' : undefined}
              >
                <Icon name={n < i ? 'shield' : n === i ? 'target' : 'clock'} size={20} />
                <span>{scr.step}</span>
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <div className="aw-side-note">Setup takes about ten minutes.</div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div>
              <div className="main-eyebrow">{s.eyebrow}</div>
              <h1>{s.title}</h1>
            </div>
          </header>

          <div className="hh-canvas">
            <div className="hh-ambient" aria-hidden />
            <section className="aw-bento" key={i}>
              <article className="hh-hero">
                <div className="hh-hero-glow" />
                <div className="hh-hero-inner">
                  <span className="hq-eyebrow"><span className="dot" />Step {i + 1} of {SCREENS.length}</span>
                  <h2 className="hh-hero-title">{s.heroTitle}</h2>
                  <p className="hh-hero-sub">{s.body}</p>
                  <div className="hh-hero-cta">
                    <button
                      className="hqbtn hqbtn-primary"
                      disabled={busy}
                      onClick={() => (last ? void finish() : setI(i + 1))}
                    >
                      {last && preview ? 'Start again' : busy ? 'One moment' : s.cta}
                    </button>
                    {i > 0 && (
                      <button className="hqbtn hqbtn-ghost" onClick={() => setI(i - 1)}>Back</button>
                    )}
                  </div>
                </div>
              </article>

              <article className="hqcard aw-aside">
                <span className="hh-tile-icon"><Icon name="coach" size={18} /></span>
                <h4 className="hh-tile-name">{s.aside.title}</h4>
                <p className="hh-tile-pitch">{s.aside.body}</p>
              </article>
            </section>

            <section className="aw-stats">
              {s.stats.map((st) => (
                <article className="hqcard aw-stat" key={st.label}>
                  <div className="aw-stat-n">{st.n}</div>
                  <div className="aw-stat-l">{st.label}</div>
                </article>
              ))}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
