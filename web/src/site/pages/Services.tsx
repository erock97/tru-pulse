import { BUSINESS } from '../../config/business';
import { TEAM_BANDS } from '../teamBands';

// The seven services. Same list as the home page, in full. Verbatim from the old
// marketing site's services page (see the site archive under docs/ § /services).
const SERVICES = [
  { n: '01', name: 'Sales leadership support',
    body: 'We partner with ownership and leadership to manage performance, identify bottlenecks, and install a consistent operating rhythm across the sales team.' },
  { n: '02', name: 'Agent accountability',
    body: 'We hold agents to following up, working their pipeline, staying engaged with leads, and taking the right actions every single week.' },
  { n: '03', name: 'Pipeline & CRM oversight',
    body: 'Lead flow, pipeline health, speed-to-lead, follow-up quality, appointment setting, nurture opportunities, and Follow Up Boss adoption — reviewed continuously.' },
  { n: '04', name: 'Zillow Preferred lead conversion',
    body: 'Better follow-up systems, agent coaching on Zillow conversations, and performance visibility on every online lead. We protect the lead spend.' },
  { n: '05', name: 'ZHL adoption',
    body: 'Better agent understanding of Zillow Home Loans, cleaner handoffs, stronger talk tracks, and consistent execution throughout the buyer process.' },
  { n: '06', name: 'Training & coaching',
    body: 'Coaching, call strategy, objection handling, scripting, and real-time feedback to help agents convert more buyers and sellers.' },
  { n: '07', name: 'Leadership meetings & performance reviews',
    body: 'Regular meetings with leadership to review team performance, agent execution, conversion trends, ZHL adoption, and what’s next on the operating roadmap.' },
] as const;

// Four packages, banded by active agent count. Labels come from teamBands.ts
// so /apply and /services cannot drift. Structure from the June 2026 pricing
// flier; descriptions from the old services page.
//
// NO DOLLAR FIGURES. Pricing is a conversation, not a web page — the retainer
// and the per-deal payout are described in words under "Investment" below.
const PACKAGE_COPY = {
  Essentials: {
    featured: false,
    blurb: 'Foundational sales management for teams putting their first real operating cadence in place. The full universal rhythm — leadership meetings, pipeline huddles, CRM oversight, accountability management, and performance monitoring — included.',
  },
  Performance: {
    featured: true, tag: 'Most common',
    blurb: 'Our most popular engagement — chosen by teams ready to compound their existing lead flow into closings. Deeper coaching presence, sharper accountability, and tighter management coverage across the roster.',
  },
  'Performance+': {
    featured: false,
    blurb: 'For teams with larger rosters where individual coaching capacity is the binding constraint. Expanded one-on-one presence and management bandwidth so no agent gets coached on a lag.',
  },
  'Mega Team': {
    featured: false,
    blurb: 'One-on-one coaching capacity scoped to your roster. Custom commercial structure designed around the size and complexity of your operation.',
  },
} as const;

const PACKAGES = TEAM_BANDS.map((b) => ({ ...b, ...PACKAGE_COPY[b.name] }));

const OUTCOMES = [
  'Increase lead conversion',
  'Improve agent follow-up',
  'Create better CRM discipline',
  'Hold agents accountable',
  'Improve ZHL adoption',
  'Protect lead spend',
  'Identify underperformance earlier',
  'Free ownership for growth, recruiting, branding, vision',
  'Drive more closed transactions',
] as const;

const STEPS = [
  { n: '01', name: 'Apply', body: 'A few short questions about your team and where you’re stuck.' },
  { n: '02', name: 'Consultation call', body: '60 minutes. We map the opportunity together. No pitch.' },
  { n: '03', name: 'Proposal', body: 'Package recommendation, fixed retainer, clear scope.' },
  { n: '04', name: 'Contract and first invoice', body: 'Standard services agreement, Stripe Invoicing.' },
  { n: '05', name: 'Onboarding', body: 'First leadership meeting and pipeline huddle within 7 business days of signed contract.' },
] as const;

export default function Services() {
  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div className="interior">
      <header className="panel band" id="top"><div className="wrap">
        <div className="kick">Services</div>
        <h1 className="h2" style={{ marginTop: '1rem' }}>Fractional sales management for <em>real estate teams</em>.</h1>
        <p className="sub">
          Sales leadership, agent accountability, Zillow Preferred conversion, ZHL adoption, and the
          daily operating rhythm &mdash; built to improve performance without adding a full-time hire.
        </p>
      </div></header>

      <section className="panel band" id="what"><div className="wrap">
        <div className="kick reveal">What we help with</div>
        <h2 className="h2 reveal d1">Seven things we <em>own</em> for you.</h2>
        <p className="sub reveal d2">
          Every engagement covers the full operating system &mdash; from leadership rhythm down to
          individual agent coaching. Packages differ in coaching volume; the core scope is the same.
        </p>
        <div className="pills svc">
          {SERVICES.map((s, i) => (
            <div className={`p reveal d${(i % 3) + 1}`} key={s.n}>
              <span className="num">{s.n}</span>
              <h3>{s.name}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div></section>

      <section className="panel band" id="packages"><div className="wrap">
        <div className="kick reveal">Engagement packages</div>
        <h2 className="h2 reveal d1">Four packages, scaled to <em>your team</em>.</h2>
        <p className="sub reveal d2">
          Coaching coverage and management depth scaled to your roster. Investment and scope are
          tailored to each engagement &mdash; apply for a custom proposal.
        </p>
        <div className="tiers pkg">
          {PACKAGES.map((p, i) => (
            <div className={`tier reveal d${(i % 3) + 1}${p.featured ? ' feat' : ''}`} key={p.name}>
              {'tag' in p && p.tag ? <div className="tag">{p.tag}</div> : null}
              {/* .tname is the small gold label; the package name takes the
                  large serif slot the price used to occupy. */}
              <div className="tname">{p.band}</div>
              <div className="pname">{p.name}</div>
              <div className="td">{p.blurb}</div>
            </div>
          ))}
        </div>
        <p className="reveal pkgnote">
          Your package is set by active agent count, not preference &mdash; so you always get the
          right level of support. If your team grows into the next band, we move you up at your
          next billing cycle.
        </p>
      </div></section>

      <section className="panel band" id="why"><div className="wrap">
        <div className="kick reveal">Why teams hire us</div>
        <h2 className="h2 reveal d1">Most teams don&rsquo;t have a <em>lead problem</em>.</h2>
        <p className="sub reveal d2">
          They have a conversion, accountability, and management problem. Fractional sales
          management gives you the structure to solve it without adding a full-time hire &mdash; so
          the team owner can step out of the weeds and focus on what actually grows the business.
        </p>
        <ul className="outcomes reveal d2">
          {OUTCOMES.map((o) => <li key={o}>{o}</li>)}
        </ul>
      </div></section>

      <section className="panel band" id="fit"><div className="wrap">
        <div className="kick reveal">Who we work best with</div>
        <h2 className="h2 reveal d1">Real estate teams already <em>running the race</em>.</h2>
        <p className="sub reveal d2">
          We&rsquo;re a strong fit for teams that are generating leads, investing in growth, and want
          more structure around sales performance &mdash; especially teams using Zillow Premier Agent,
          Zillow Flex, Zillow Home Loans, Follow Up Boss, or other online lead sources.
        </p>
        <p className="sub reveal d3">
          If your CRM is full of leads that aren&rsquo;t being worked, your ZHL adoption is uneven, and
          you&rsquo;re spending your week chasing the team instead of building the business &mdash;
          we should talk.
        </p>
      </div></section>

      <section className="panel band" id="investment"><div className="wrap">
        <div className="kick reveal">Investment</div>
        <h2 className="h2 reveal d1">How we&rsquo;re <em>paid</em>.</h2>
        <p className="sub reveal d2">
          Engagements are structured as a monthly retainer scoped to your package and your team&rsquo;s
          specific situation, plus a payout on every closed deal, scaled to your market&rsquo;s home
          values &mdash; so our upside is tied directly to your results.
        </p>
        <p className="sub reveal d2">
          Final terms depend on team size, current revenue, market context, and the level of
          coaching coverage you need. We&rsquo;ll provide a fixed-price proposal after the discovery call.
        </p>
        <p className="sub reveal d3">
          Engagements start with an initial 90-day term, then continue month to month &mdash; we keep
          invoicing until you tell us to stop, and you can cancel any time after the initial term
          with 30 days&rsquo; notice. Change your mind within 48 hours of signing and we refund
          everything, no questions asked. Payments are processed via Stripe and retainers are
          invoiced monthly. The full terms are in our{' '}
          <a href="/refund-policy">Refund &amp; Cancellation Policy</a>.
        </p>
      </div></section>

      <section className="panel band" id="engage"><div className="wrap">
        <div className="kick reveal">How to engage</div>
        <h2 className="h2 reveal d1">Five steps, start to <em>onboarded</em>.</h2>
        <div className="pills svc">
          {STEPS.map((s, i) => (
            <div className={`p reveal d${(i % 3) + 1}`} key={s.n}>
              <span className="num">{s.n}</span>
              <h3>{s.name}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <div className="hcta reveal d2" style={{ marginTop: '2.4rem' }}>
          <a href="/apply" className="cta">Apply to work with us{arrow}</a>
          <a href={BUSINESS.bookingUrl} className="cta ghost" target="_blank" rel="noopener noreferrer">
            Book a call with our team{arrow}
          </a>
        </div>
        <p className="note reveal d3" style={{ marginTop: '1.2rem' }}>
          <a href="/refund-policy">See our Refund &amp; Cancellation Policy</a>
        </p>
      </div></section>
    </div>
  );
}
