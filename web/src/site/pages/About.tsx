import { BUSINESS } from '../../config/business';

// One partner for now. Eric's second partner goes in when he supplies his own
// bio and headshot — deliberately not stubbed, because a half-filled team page
// reads worse than a single one that stands on its own.
const TEAM = [
  {
    name: 'Eric Matthews',
    role: 'Co-founder',
    photo: '/team-eric-matthews.jpg',
    // Sits under the portrait. Solves two things at once: the column was left
    // ~400px empty once the bio grew, and nobody arriving cold reads four
    // paragraphs — this gives a skimmer the whole story in six seconds.
    facts: [
      { k: 'In sales', v: '12 years' },
      { k: 'Real estate prop tech', v: '8 years' },
      { k: 'Zillow', v: 'Sales executive → senior business advisor → growth advisor, key partnerships' },
      { k: 'Focus', v: 'Recruiting · agent development · leadership training · KPIs & SOPs · lead flow · AI in team workflows' },
    ],
    // Eric's own words, 2026-08-09. The facts column carries the CV so the prose
    // carries the person — and the turn in the third paragraph ("an advisor can
    // only take a team so far") is the reason the business exists, which no
    // earlier draft had.
    lede: 'My job has always been the same: help real estate teams drive more revenue.',
    paras: [
      'At Zillow, I did that as a growth advisor in key partnerships — helping teams sharpen their recruiting, developing agents inside Zillow Preferred and in their own businesses, and teaching team leads and managing brokers to lead from the front. Just as much of it happened behind the scenes: building KPIs and SOPs where none existed, and tightening how the business actually ran.',
      'But an advisor can only take a team so far. I kept seeing the same gap — teams knew what to do after our calls, but nobody inside the business owned making it happen. That’s why I helped start TRU. Instead of advising from the outside, we embed with a small number of teams and do the work with them: the accountability, the systems, the hiring decisions, the follow-through.',
      'What I care about most is alignment — agents, team leads, and brokerages pulling in the same direction instead of quietly working against each other. And I’ve gone deep on AI where it earns its keep: automating the operational work nobody wants to own, and building reports that show leaders their team at a level of detail they didn’t know was possible.',
      'The feedback I hear most is that I’m genuine. I think that’s why agents and brokers open up to me — and watching them grow into something bigger than where they started is what keeps me in it.',
    ],
  },
] as const;

export default function About() {
  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div className="interior">
      <header className="panel band" id="top"><div className="wrap">
        <div className="kick reveal">About</div>
        <h1 className="h2 reveal d1" style={{ marginTop: '1rem' }}>Who you&rsquo;d actually be <em>working with</em>.</h1>
        <p className="sub reveal d2">
          Fractional sales management is a people business before it is a systems business.
          You should know whose judgement you&rsquo;re buying.
        </p>
      </div></header>

      <section className="panel band" id="team"><div className="wrap">
        {TEAM.map((p) => (
          <article className="bio" key={p.name}>
            <div className="bio-aside reveal">
              <div className="bio-photo">
                <img
                  src={p.photo}
                  width={900}
                  height={900}
                  loading="lazy"
                  decoding="async"
                  alt={`${p.name}, ${p.role} of ${BUSINESS.brandFull}`}
                />
              </div>
              <dl className="bio-facts">
                {p.facts.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>{f.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {/* Staggered the same way the other pages are — d1/d2/d3 cycle so
                the copy arrives in reading order rather than all at once. */}
            <div className="bio-body">
              <div className="kick reveal">{p.role}</div>
              <h2 className="bio-name reveal d1">{p.name}</h2>
              <p className="bio-lede reveal d2">{p.lede}</p>
              {p.paras.map((t, i) => (
                <p className={`reveal d${(i % 3) + 1}`} key={t.slice(0, 24)}>{t}</p>
              ))}
            </div>
          </article>
        ))}
      </div></section>

      <section className="panel ctaband" id="cta"><div className="wrap">
        <h2 className="reveal">Rather just <em>talk</em>?</h2>
        <p className="sub reveal d2">
          Thirty minutes, your real numbers, and an honest read on where your bottleneck is.
          No pitch.
        </p>
        <div className="hcta reveal d2">
          <a href={BUSINESS.calendly} className="cta" target="_blank" rel="noopener noreferrer">
            Book a call with our team{arrow}
          </a>
          <a href="/apply" className="cta ghost">Apply to work with us{arrow}</a>
        </div>
      </div></section>
    </div>
  );
}
