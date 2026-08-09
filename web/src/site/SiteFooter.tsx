import { BUSINESS } from '../config/business';

// The compliance-critical component. truhq.co previously carried no company
// name, no address, no contact route, and no policy links anywhere on the site.
// This renders on every marketing page.
export default function SiteFooter() {
  const year = new Date().getFullYear();
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BUSINESS.brandFull,
    legalName: BUSINESS.legalEntity,
    url: BUSINESS.siteUrl,
    email: BUSINESS.contactEmail,
    address: {
      '@type': 'PostalAddress',
      streetAddress: BUSINESS.legalAddress[0],
      addressLocality: 'Bothell',
      addressRegion: 'WA',
      postalCode: '98021',
      addressCountry: 'US',
    },
  };

  return (
    <footer className="sitefoot">
      <div className="wrap">
        <div className="sitefoot-brand">
          <a className="brand" href="/">T<span className="r">RU</span></a>
          <span className="m">{BUSINESS.tagline}</span>
        </div>

        <address className="sitefoot-addr">
          {BUSINESS.legalAddress.map((line) => <span key={line}>{line}</span>)}
          <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>
        </address>

        <nav className="sitefoot-legal" aria-label="Legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/refund-policy">Refund &amp; Cancellation</a>
        </nav>

        <p className="sitefoot-copy">© {year} {BUSINESS.legalEntity}. All rights reserved.</p>
      </div>
      {/* Structured data. Built entirely from compile-time constants in
          business.ts — no user input reaches it. `<` is still escaped so a
          value containing "</script>" could never break out of the tag. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd).replace(/</g, '\\u003c') }}
      />
    </footer>
  );
}
