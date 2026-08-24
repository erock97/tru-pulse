import { BUSINESS } from '../../config/business';

// The public SMS terms. This page exists for one reason: a mobile carrier reads
// it before approving the number TRU sends from, and the campaign registration
// links straight to it.
//
// Everything a reviewer checks for is stated ON THIS PAGE in plain text, not
// behind a link and not implied:
//
//   · who sends the messages, by brand and legal entity
//   · who receives them, and how they came to consent
//   · what kinds of message are sent
//   · that message frequency varies
//   · that message and data rates may apply
//   · the exact keywords that stop messages, and that HELP works
//   · that opting out is free and takes effect immediately
//   · a human contact
//   · that mobile numbers and consent are never shared or sold
//
// Two claims here are promises the product has to keep, not marketing copy:
// that we never message anyone who has not personally opted in, and that STOP
// works from any number regardless of account state. Both are enforced in
// db/hq_sms_consent.sql. If that ever stops being true, this page is a
// misstatement to a carrier — fix the product, not this page.
export default function SmsTerms() {
  const { legalEntity, brandFull, contactEmail, legalAddress, policiesUpdated } = BUSINESS;

  return (
    <div className="interior">
      <article className="legal wrap">
        <div className="kick">SMS</div>
        <h1>SMS Terms &amp; Conditions</h1>
        <p className="updated">Last updated: {policiesUpdated}</p>

        <p>
          {legalEntity}, which operates the {brandFull} brand (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
          &ldquo;our&rdquo;), offers an optional text-message service to members of real estate teams
          that use our platform. These terms explain who receives those messages, what they contain,
          and how to stop them.
        </p>

        <h2>Who receives messages</h2>
        <p>
          Only licensed agents and staff who belong to a team using {brandFull}, and who have
          personally opted in from their own account at app.truhq.co. Messages are sent by that
          person&rsquo;s own team leader, or by the assistant acting on their leader&rsquo;s behalf,
          and go only to members of that same team.
        </p>
        <p>
          <strong>We never message consumers, home buyers, home sellers, clients, or sales
          leads.</strong> This service is internal team communication only. It is not used for
          marketing, promotion, solicitation, prospecting, or outreach of any kind.
        </p>

        <h2>How consent is obtained</h2>
        <p>
          Consent is collected on a web form during account creation. When someone accepts an
          invitation to join their team&rsquo;s {brandFull} account, they set a password and are then
          shown an optional step where they enter their own mobile number and tick a box that is
          unchecked by default. The box reads:
        </p>
        <blockquote>
          I agree to receive SMS text messages from TRU HQ about my team&rsquo;s operations,
          including reminders, check-ins and requests from my team leader. Message frequency varies.
          Message and data rates may apply. Reply STOP to opt out or HELP for help.
        </blockquote>
        <p>
          We record the date, the exact wording shown, and the IP address the agreement came from.
          Consent is never a condition of using {brandFull} — the step can be skipped, and every
          feature remains available to someone who declines.
        </p>
        <p>
          <strong>We never obtain phone numbers from any other source for this purpose.</strong>
          Numbers are not imported from a customer relationship system, purchased, rented, or
          gathered from a team roster. If a person has not typed their own number and ticked that
          box, we do not text them.
        </p>

        <h2>What we send</h2>
        <ul>
          <li>Reminders about deadlines on a transaction the recipient is working</li>
          <li>Check-ins on commitments the recipient made at a one-on-one with their team leader</li>
          <li>Requests from their team leader that need a short reply</li>
          <li>Notices about internal team meetings and schedule changes</li>
        </ul>

        <h2>Message frequency and cost</h2>
        <p>
          <strong>Message frequency varies</strong> and depends on the recipient&rsquo;s own activity
          and their team&rsquo;s operating rhythm. <strong>Message and data rates may apply</strong>{' '}
          according to the recipient&rsquo;s plan with their mobile carrier. {brandFull} charges
          nothing for these messages.
        </p>
        <p>Carriers are not liable for delayed or undelivered messages.</p>

        <h2>How to stop messages</h2>
        <p>
          Reply <strong>STOP</strong> to any message. We also honour STOPALL, UNSUBSCRIBE, CANCEL,
          END, QUIT, REVOKE, and OPTOUT. You will receive one confirmation that you have been
          unsubscribed, and then no further messages.
        </p>
        <p>
          Opting out is free, takes effect immediately, and works whether or not you are signed in,
          still on the team, or still hold an account. You can also switch messages off at any time
          from the Text messages section of your home screen inside {brandFull}. Reply{' '}
          <strong>START</strong> to resume.
        </p>

        <h2>How to get help</h2>
        <p>
          Reply <strong>HELP</strong> to any message for support information, or email{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>

        <h2>Privacy</h2>
        <p>
          <strong>
            Mobile phone numbers and SMS consent are never sold, rented, or shared with third parties
            or affiliates for marketing or promotional purposes.
          </strong>{' '}
          Numbers are shared only with the messaging provider that delivers the message on our
          behalf, which is contractually barred from using them for any other purpose. Our full{' '}
          <a href="/privacy">Privacy Policy</a> explains how we handle the rest of your information.
        </p>

        <h2>Supported carriers</h2>
        <p>
          The service is available on major United States carriers. Carrier support may change
          without notice, and we cannot guarantee delivery on every network.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          We may update these terms from time to time. The &ldquo;Last updated&rdquo; date above
          reflects the most recent change. If we materially change what we send or how often, we will
          ask for consent again rather than relying on consent given for the old terms.
        </p>

        <h2>Contact</h2>
        <address className="contact-block">
          <span>{legalEntity}</span>
          <span>Attn: SMS</span>
          {legalAddress.map((line) => <span key={line}>{line}</span>)}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </address>
      </article>
    </div>
  );
}
