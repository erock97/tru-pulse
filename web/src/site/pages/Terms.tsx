import { BUSINESS } from '../../config/business';

// Ported from the old published terms. Substance is unchanged — the RESPA and
// state-licensing disclaimer, the not-advice clause, the AS-IS disclaimer, the
// liability cap, indemnification, and governing law are all sound and stay.
// Entity, venue, and domain interpolate from BUSINESS; one clause was added to
// point at the initial-term and auto-continuation terms in the refund policy.
export default function Terms() {
  const { legalEntity, brandFull, contactEmail, governingState, governingVenue, policiesUpdated } = BUSINESS;

  return (
    <div className="interior">
      <article className="legal wrap">
        <div className="kick">Terms</div>
        <h1>Terms of Service</h1>
        <p className="updated">Last updated: {policiesUpdated}</p>

        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of truhq.co (the
          &ldquo;Site&rdquo;) and any services offered by {legalEntity}, which operates the{' '}
          {brandFull} brand (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By using the
          Site, you agree to these Terms. If you do not agree, do not use the Site.
        </p>

        <h2>Use of the Site</h2>
        <p>You may use the Site for lawful purposes only. You agree not to:</p>
        <ul>
          <li>Use the Site in any way that violates applicable law or regulation</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation</li>
          <li>Engage in unauthorised framing, scraping, or data mining of the Site</li>
          <li>Introduce viruses, malware, or other malicious code</li>
          <li>Interfere with the proper functioning of the Site or its security</li>
        </ul>

        <h2>Intellectual property</h2>
        <p>
          All content on the Site — including text, graphics, logos, images, audio, video,
          frameworks, and software — is owned by or licensed to {legalEntity} and is protected by
          copyright, trademark, and other intellectual property laws. You may view and download
          content for your personal, non-commercial reference. You may not reproduce, republish,
          distribute, or create derivative works from our content without our written permission.
        </p>

        <h2>Forms and submissions</h2>
        <p>
          When you submit information through forms on the Site, you represent that the information
          is accurate and that you have the authority to submit it. We treat your submissions
          according to our <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2>Consulting services</h2>
        <p>
          The Site is informational. The terms of any consulting engagement between you and{' '}
          {legalEntity} are governed by a separate, written services agreement signed by both
          parties. Nothing on the Site constitutes an offer of services or creates a consulting
          relationship.
        </p>
        <p>
          Engagements begin with an initial 90-day term and then continue on a month-to-month basis,
          with invoicing continuing until you cancel. Those terms, the 48-hour refund window, and
          the notice required to cancel are set out in our{' '}
          <a href="/refund-policy">Refund &amp; Cancellation Policy</a> and in your signed agreement.
        </p>

        <h2>Not legal, financial, or tax advice</h2>
        <p>
          The content on the Site is for informational and educational purposes only. It is not
          legal, financial, tax, real estate, or investment advice. Real estate operations are
          subject to federal and state regulation, including but not limited to the Real Estate
          Settlement Procedures Act (RESPA), state real estate licensing laws, and consumer
          protection laws. You should consult qualified professionals before acting on any
          information you find here.
        </p>

        <h2>Disclaimers</h2>
        <p>
          THE SITE AND ALL CONTENT ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;
          WITHOUT WARRANTIES of any kind, whether express or implied, including fitness for a
          particular purpose or accuracy. We do not warrant uninterrupted service or freedom from
          viruses.
        </p>
        <p>
          Any client examples, case descriptions, or results described on the Site are illustrative
          only. They are not a prediction or guarantee of results, and outcomes depend on your
          market, your team, your lead spend, and your execution.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          {legalEntity.toUpperCase()} SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
          CONSEQUENTIAL, OR PUNITIVE DAMAGES, or for loss of profit. Our maximum aggregate liability
          is $100. Some jurisdictions do not permit these limitations, in which case they apply to
          the fullest extent permitted by law.
        </p>

        <h2>Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless {legalEntity} from claims, damages, and legal
          expenses arising from your use of the Site or your violation of these Terms.
        </p>

        <h2>Third-party links and services</h2>
        <p>
          The Site may contain links to external websites. We bear no responsibility for third-party
          content, privacy practices, or operations.
        </p>

        <h2>Governing law</h2>
        <p>
          These Terms are governed by the laws of the State of {governingState}. Disputes resolve
          exclusively in the courts of {governingVenue}, and you consent to jurisdiction there.
        </p>

        <h2>Changes to these Terms</h2>
        <p>
          We may update these Terms periodically. Material changes receive 30 days&rsquo; notice
          before taking effect. Continued use constitutes acceptance.
        </p>

        <h2>Severability</h2>
        <p>
          If any provision becomes unenforceable, the remaining provisions stay in full effect.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these Terms: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      </article>
    </div>
  );
}
