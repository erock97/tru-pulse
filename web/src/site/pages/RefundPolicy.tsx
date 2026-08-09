import { BUSINESS } from '../../config/business';

// Terms confirmed by Eric on 2026-08-09. These REPLACE the old published policy,
// which assumed 30-days-notice-anytime with no initial term:
//
//   · 48 hours from signing → full refund, no questions asked
//   · after that, through the initial 90-day term → the balance of the term is owed
//   · after 90 days → month-to-month, continues until cancelled, 30 days' notice
//   · per-deal payouts survive termination for anything closed through that date
//
// The month-to-month roll is an automatic renewal, so it is stated plainly and
// up front rather than buried — see the "Initial term" section.
export default function RefundPolicy() {
  const { legalEntity, contactEmail, legalAddress, policiesUpdated } = BUSINESS;

  return (
    <div className="interior">
      <article className="legal wrap">
        <div className="kick">Refund &amp; Cancellation</div>
        <h1>Refund &amp; Cancellation Policy</h1>
        <p className="updated">Last updated: {policiesUpdated}</p>

        <p>
          This policy governs refunds and cancellations for services purchased from {legalEntity},
          which operates the {BUSINESS.brandFull} brand. It supplements — and is incorporated into —
          any signed services agreement between us. In the event of conflict between this policy and
          a signed agreement, the signed agreement controls.
        </p>

        <h2>Free resources and discovery calls</h2>
        <p>
          Any free resources we offer from time to time are provided at no charge, and initial
          discovery calls are complimentary. No fee is collected, so no refund is applicable.
        </p>

        <h2>Initial term, and how billing continues</h2>
        <p>
          Engagements begin with an <strong>initial 90-day term</strong>. Retainers are invoiced
          monthly in advance.
        </p>
        <p>
          <strong>After the initial 90-day term, your engagement continues automatically on a
          month-to-month basis, and we will continue to invoice you each month until you cancel.</strong>{' '}
          There is no second signature and no renewal notice — the engagement simply continues until
          you tell us to stop. You can cancel at any point after the initial term by giving thirty
          (30) days&rsquo; written notice, as described below.
        </p>

        <h2>The 48-hour window</h2>
        <p>
          If you decide not to move forward, tell us within <strong>48 hours of signing your
          agreement</strong> and we will refund everything you have paid, in full. No reason
          required and no questions asked.
        </p>
        <p>
          We front-load real work at the start of an engagement, which is why this window is short
          and clearly defined rather than open-ended.
        </p>

        <h2>Cancelling during the initial term</h2>
        <p>
          After the 48-hour window closes and through the end of the initial 90-day term, the
          engagement is a commitment. You may stop the work at any time, but the retainer for the
          remainder of the 90-day term remains payable. Work in progress at that point will be
          completed in good faith and delivered to you.
        </p>

        <h2>Cancelling after the initial term</h2>
        <p>
          Once you are month-to-month, you may cancel at any time with thirty (30) days&rsquo;
          written notice. Upon cancellation:
        </p>
        <ul>
          <li>You remain responsible for the retainer through the end of the 30-day notice period</li>
          <li>Any prepaid retainer for periods beyond the notice window is refunded pro-rata</li>
          <li>Work in progress is completed in good faith and delivered to you</li>
          <li>You retain ownership of all materials and deliverables produced and paid for through the cancellation date</li>
        </ul>
        <p>
          Notice is effective on the date received by email at{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a> or via certified mail.
        </p>

        <h2>Per-deal payouts after termination</h2>
        <p>
          Our compensation includes a payout on closed transactions in addition to the monthly
          retainer. <strong>Cancellation does not waive payouts already earned.</strong> Any
          transaction that closes on or before the effective termination date remains payable under
          the terms of your agreement, and is invoiced in the normal course after closing —
          including where that invoice falls after our work together has ended.
        </p>
        <p>
          The treatment of transactions that are pending or under contract at termination but close
          afterwards is governed by your signed services agreement.
        </p>

        <h2>Pause and unpause</h2>
        <p>
          After the initial term, engagements may be paused for seasonal or operational reasons with
          reasonable advance notice — typically 14 days. Paused months are not invoiced. Unpausing
          requires written confirmation, and no penalty is applied for resuming an engagement.
        </p>

        <h2>Termination for cause</h2>
        <p>
          Either party may terminate immediately, without the notice period above, in the event of
          material breach by the other party — including non-payment, failure to provide reasonable
          access to the team and systems, or violation of confidentiality obligations. In that
          event, amounts owed are calculated pro-rata through the date of termination, and earned
          per-deal payouts remain payable as described above.
        </p>

        <h2>Chargebacks</h2>
        <p>
          If you have a billing concern, please contact us first at{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. We aim to resolve all disputes
          amicably within 14 days. Initiating a chargeback through your bank or card issuer without
          first contacting us may constitute a breach of your services agreement and may result in
          immediate termination of services.
        </p>

        <h2>Payment processing</h2>
        <p>
          All payments are processed via Stripe. By submitting payment, you authorize {legalEntity} to
          charge the agreed amount to the payment method you provide. Stripe&rsquo;s terms of service
          and privacy policy apply to the payment transaction itself. Refunds, when issued, are
          processed back to the original payment method within 5&ndash;10 business days of approval.
        </p>

        <h2>How to request a refund or cancellation</h2>
        <p>
          Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with your name, the service in
          question, and the reason for your request. We will respond within 5 business days. If a
          refund is approved, it will be processed within an additional 5 business days.
        </p>

        <h2>Contact</h2>
        <address className="contact-block">
          <span>{legalEntity}</span>
          {legalAddress.map((line) => <span key={line}>{line}</span>)}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </address>
      </article>
    </div>
  );
}
