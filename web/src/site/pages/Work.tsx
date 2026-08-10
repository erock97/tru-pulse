import { BUSINESS } from '../../config/business';

// Rewritten 2026-08-09 from Eric's own account of the engagements. The previous
// three cards were sanitised placeholders that described no real client — worse
// than nothing, because a prospect reads them as the work.
const CASES = [
  {
    scope: '400+ agent brokerage · 8 months',
    title: 'From 12 transactions a month to 22',
    body: 'A brokerage running 400+ agents, with 80 to 90 of them actively taking paid leads, was closing 12 transactions a month out of its lead-source programs. We rebuilt how those leads were routed, worked, and held to standard. Eight months later it was 22.',
  },
  {
    scope: 'Zillow Preferred launch · first month',
    title: 'Seven contracts straight out of the gate',
    body: 'A team going into Zillow Preferred with no prior experience on the program. We built the onboarding, the lead standards, and the follow-up cadence before the first lead ever landed — and they wrote seven contracts in their first month.',
  },
  {
    scope: 'Two Nashville teams · 3 → 10 agents',
    title: 'Built to scale, not just to grow',
    body: 'Two small real estate businesses, three agents each. We installed the operating model first — structure, onboarding, accountability — so that hiring multiplied the output instead of the chaos. Both are at ten agents and still adding.',
  },
] as const;

// The repeatable work. This is what a prospect is actually buying, and it is the
// part the old page had nothing to say about.
const BUILT = [
  {
    n: '01', name: 'Program launches',
    body: 'Zillow Preferred and Realtor.com programs stood up inside brokerages that had never run them — including teams with no prior Preferred experience at all.',
  },
  {
    n: '02', name: 'Onboarding rebuilt',
    body: 'The entire onboarding path onto Zillow Preferred and every other lead platform, rebuilt for each team we work with, so a new agent ramps on the program instead of around it.',
  },
  {
    n: '03', name: 'SOPs and lead standards',
    body: 'Written standards for how a paid lead gets worked — speed, cadence, and what "worked" actually means — so performance stops depending on who happens to pick it up.',
  },
  {
    n: '04', name: 'Systems of accountability',
    body: 'Accountability built into the operating rhythm rather than bolted on: who is slipping, on what, and the conversation that fixes it — every week, not every quarter.',
  },
  {
    n: '05', name: 'TRU smart lists',
    body: 'Our own smart lists built into each team’s CRM, so agents open their day looking at the right leads instead of the whole database.',
  },
  {
    n: '06', name: 'AI tooling, included',
    body: 'Every team gets access to the tooling we build — including the AI we use to sharpen speed-to-lead and put the right follow-up in front of the right agent first.',
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
          Every team we have worked with has improved its transaction count. A few of
          them, specifically.
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

        {/* Sits directly under the claims it qualifies, not buried in the footer. */}
        <p className="disclaimer reveal d2">
          Client examples describe work performed for real engagements. They are illustrative,
          not a prediction or guarantee of results. Outcomes depend on your market, your team,
          your lead spend, and your execution.
        </p>
      </div></section>

      <section className="panel band" id="built"><div className="wrap">
        <div className="kick reveal">What we put in place</div>
        <h2 className="h2 reveal d1">The part that <em>outlasts us</em>.</h2>
        <p className="sub reveal d2">
          The numbers above are the outcome. This is the work that produced them &mdash; and it
          stays with the team whether we are in the room or not.
        </p>
        <div className="pills svc">
          {BUILT.map((b, i) => (
            <div className={`p reveal d${(i % 3) + 1}`} key={b.n}>
              <span className="num">{b.n}</span>
              <h3>{b.name}</h3>
              <p>{b.body}</p>
            </div>
          ))}
        </div>
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
