import { BUSINESS } from '../../config/business';

// Ported from the old published policy, with the vendor list rewritten to the
// stack this site actually runs on. The old one named Vercel, Vercel Web
// Analytics, and Google Apps Script — none of which are used here. A policy that
// names the wrong processors is not merely stale, it is an affirmative
// misstatement about where a visitor's data goes.
export default function Privacy() {
  const { legalEntity, brandFull, contactEmail, legalAddress, policiesUpdated } = BUSINESS;

  return (
    <div className="interior">
      <article className="legal wrap">
        <div className="kick">Privacy</div>
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated: {policiesUpdated}</p>

        <p>
          {legalEntity}, which operates the {brandFull} brand (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
          &ldquo;our&rdquo;), respects your privacy. This policy explains what information we collect
          when you visit truhq.co or interact with our services, how we use it, and the choices you
          have.
        </p>

        <h2>Information we collect</h2>
        <p>
          <strong>Information you provide directly.</strong> When you submit our application form we
          collect what you enter: your name, work email address, professional role, team size, and a
          description of your current operating bottleneck. <strong>We do not ask for or collect a
          phone number.</strong>
        </p>
        <p>
          <strong>Information collected automatically.</strong> When you visit the site we collect
          privacy-friendly aggregate analytics via Cloudflare Web Analytics. This is cookie-free —
          no cross-site tracking, no personal identifiers, and no ability to follow you around the
          web. We see anonymised aggregates (pages visited, country or region, device type, referrer
          source) used to understand which content is useful. We do not collect precise location
          data.
        </p>
        <p>
          <strong>Booking a call.</strong> When you book a consultation with us, we collect your
          name, email, and the time you chose, so we can hold the meeting and send you the
          calendar invitation. Booking runs on our own scheduling page rather than a third-party
          service, so this information goes directly to us.
        </p>

        <h2>How we use your information</h2>
        <ul>
          <li>To review your application and respond to your inquiry</li>
          <li>To deliver any resources you specifically request</li>
          <li>To send occasional notes on real estate sales operations — <strong>only if you opted in</strong>, and you can unsubscribe at any time</li>
          <li>To improve our website and content based on aggregated usage patterns</li>
          <li>To comply with legal obligations and protect our rights</li>
        </ul>
        <p>
          Marketing email is opt-in only. The checkbox on our application form is unticked by
          default, ticking it is never a condition of applying, and we record which wording you were
          shown and when you consented.
        </p>

        <h2>How we share your information</h2>
        <p>We do not sell, rent, or trade your personal information. We share data only with:</p>
        <ul>
          <li>
            <strong>Service providers</strong> who help us operate the business — Cloudflare
            (hosting and privacy-friendly analytics), Supabase (database and scheduling), Resend
            (transactional email), and Stripe (payment processing for clients). These
            providers are contractually obligated to protect your data.
          </li>
          <li><strong>Legal authorities</strong> when required by law, subpoena, or court order.</li>
          <li>
            <strong>Successors</strong> in the event of a merger, acquisition, or sale of business
            assets, with notice to you.
          </li>
        </ul>

        <h2>Cookies and tracking</h2>
        <p>
          This site does not set tracking cookies. Our analytics provider, Cloudflare Web Analytics,
          is cookieless by design — it cannot identify you across visits or follow you to other
          sites. We do not use advertising or remarketing cookies, and we do not track you across
          other websites.
        </p>
        <p>
          Because we set no tracking cookies and run no advertising tags, this site does not present
          a cookie consent banner.
        </p>

        <h2>Data retention</h2>
        <p>
          We retain form submissions and contact information for as long as we have an active
          relationship with you, or for up to seven years after our last contact, whichever is
          longer. This duration covers tax, legal, and business-record requirements. You can request
          deletion at any time — see &ldquo;Your rights&rdquo; below.
        </p>

        <h2>Your rights</h2>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li>Access the personal information we hold about you</li>
          <li>Request correction of inaccurate information</li>
          <li>Request deletion of your information</li>
          <li>Opt out of marketing communications — use the unsubscribe link in any email, or contact us directly</li>
          <li>Restrict or object to certain processing</li>
          <li>Data portability — receive your information in a portable format</li>
        </ul>
        <p>
          To exercise any of these rights, email{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. We will respond within 30 days.
        </p>

        <h2>California, EU, and other jurisdictions</h2>
        <p>
          If you are a California resident, the CCPA grants you additional rights including the right
          to know what personal information we collect and the right to opt out of any sale of your
          information — we do not sell your information. If you are an EU or UK resident, the GDPR
          grants you the rights enumerated above and the right to lodge a complaint with your local
          data protection authority.
        </p>

        <h2>Children</h2>
        <p>
          Our services are intended for business professionals. We do not knowingly collect
          information from children under 13. If you believe a child has provided us with personal
          information, contact us and we will delete it.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the top
          reflects the most recent change. For material changes we will provide reasonable notice —
          for example, via the email address you provided, or a banner on the site.
        </p>

        <h2>Contact</h2>
        <address className="contact-block">
          <span>{legalEntity}</span>
          <span>Attn: Privacy</span>
          {legalAddress.map((line) => <span key={line}>{line}</span>)}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </address>
      </article>
    </div>
  );
}
