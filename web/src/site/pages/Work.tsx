import { BUSINESS } from '../../config/business';

// Three engagements. Each card's scope label replaces what used to be a headline
// outcome metric on the old site. Those figures were directional rather than
// measured (Eric's call, 2026-08-09), so what we DID survives and what it
// supposedly produced does not. The originals are recorded in the site archive
// under docs/ if they ever need substantiating. The results disclaimer below
// applies to everything on this page.
const CASES = [
  {
    scope: 'Regional brokerage · 24 → 60 agents',
    title: 'Scaling headcount without losing the ops layer',
    body: 'A regional brokerage grew headcount hard over 18 months and the lead-to-close process came apart underneath it. We rebuilt lead routing, follow-up cadence, and the ISA operating model.',
  },
  {
    scope: '12-agent team · Follow Up Boss',
    title: 'A CRM rebuilt from scratch in 30 days',
    body: 'Eighteen thousand leads sat in a CRM with no functioning stage system. We rebuilt Follow Up Boss end to end and trained the team on a cadence they could actually sustain.',
  },
  {
    scope: 'Solo producer → 5-agent team',
    title: 'A working system on day one',
    body: 'A top-producing solo agent wanted to build a team and knew chaos would scale with every hire. We installed the operating model first, then onboarded the first five agents into it.',
  },
] as const;

export default function Work() {
  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div className="interior">
      <header className="panel band" id="top"><div className="wrap">
        <div className="kick">Work</div>
        <h1 className="h2" style={{ marginTop: '1rem' }}>What changes when the system <em>actually runs</em>.</h1>
        <p className="sub">
          Three engagements, and what we built in each.
        </p>
      </div></header>

      <section className="panel band" id="cases"><div className="wrap">
        <div className="pills">
          {CASES.map((c, i) => (
            <div className={`p reveal d${i + 1}`} key={c.title}>
              <span className="k">{c.scope}</span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>

        {/* Applies to every example above. Kept adjacent to the claims it
            qualifies, not buried in the footer. */}
        <p className="disclaimer reveal d2">
          Client examples describe work performed for real engagements. They are illustrative,
          not a prediction or guarantee of results. Outcomes depend on your market, your team,
          your lead spend, and your execution.
        </p>
      </div></section>

      <section className="panel ctaband" id="cta"><div className="wrap">
        <h2 className="reveal">Think your team is <em>next</em>?</h2>
        <p className="sub reveal d2">
          Tell us where you&rsquo;re stuck. We review every application personally and reply within
          two business days.
        </p>
        <div className="hcta reveal d2">
          <a href="/apply" className="cta">Apply to work with us{arrow}</a>
          <a href={BUSINESS.calendly} className="cta ghost" target="_blank" rel="noopener noreferrer">
            Book a call with our team{arrow}
          </a>
        </div>
      </div></section>
    </div>
  );
}
