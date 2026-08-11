import { useState, type ReactNode } from 'react';

/**
 * "How this works" — the reference a team lead reads when they want to know where
 * a number came from before they coach someone off it.
 *
 * Not a glossary. Each section answers a question a lead actually asks, in plain
 * English, and states the limits honestly. Every rule below is the REAL rule from
 * shared/flags.ts, worker/src/sync.ts and worker/src/accountability.ts — if any of
 * those change, this page changes with them or it becomes a liability.
 *
 * Sections start collapsed and only open when clicked. Nothing expands or reorders
 * on its own: the page looks the same every time you land on it.
 */

function Section({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`htw-sec${open ? ' on' : ''}`}>
      <button type="button" className="htw-q" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{q}</span>
        <span className="htw-caret" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && <div className="htw-a">{children}</div>}
    </div>
  );
}

export function HowThisWorks() {
  return (
    <div className="htw">
      <p className="htw-intro">
        Every number on this board comes from your Follow Up Boss account and a small set of
        rules. This page is those rules, in plain language &mdash; including what we
        can&rsquo;t know and why. If a figure ever looks wrong, start here.
      </p>

      <Section q="Where do these numbers come from?">
        <p>
          A read-only connection to your Follow Up Boss account. Pulse reads your leads; it
          never writes anything back, never messages a lead, and never changes a stage.
        </p>
        <p>
          Your whole lead list is re-read every 30 minutes. On top of that, Follow Up Boss
          notifies us the moment a lead is created, a stage changes, or a call or text is
          logged &mdash; so those land within seconds rather than waiting for the next pass.
        </p>
        <p className="htw-note">
          Pulse is a mirror, not a second set of books. If something is recorded wrong in
          Follow Up Boss, it will read wrong here. That is deliberate &mdash; the fix belongs
          in the CRM your agents actually work in.
        </p>
      </Section>

      <Section q="Which leads are counted, and which are ignored?">
        <p>Only leads from paid sources. Right now that means:</p>
        <ul>
          <li>Zillow &mdash; including Premier Agent and Flex</li>
          <li>Realtor.com, and Realtor.com MVIP / Market VIP counted separately</li>
          <li>Homes.com</li>
          <li>Facebook and Instagram</li>
          <li>Google &mdash; including Local Services ads</li>
          <li>Pay-at-close referral networks: Redfin, HomeLight, Rocket Homes, UpNest, ReferralExchange, FastExpert</li>
        </ul>
        <p>
          Sources are matched by name, so &ldquo;Zillow Premier Agent&rdquo; and plain
          &ldquo;Zillow&rdquo; both land in the same family.
        </p>
        <p>
          Everything else &mdash; sphere, past clients, open houses, walk-ins &mdash; is
          invisible to Pulse on purpose. This board is about the leads you pay for.
        </p>
        <p className="htw-note">
          So don&rsquo;t compare Pulse&rsquo;s lead count to your total in Follow Up Boss.
          They will never match, and they aren&rsquo;t supposed to. You can narrow it further
          under Settings to only the sources you currently pay for.
        </p>
      </Section>

      <Section q="How do you decide a lead has had no contact?">
        <p>In order, three checks:</p>
        <ol>
          <li>
            <strong>Is it still sitting in Lead, New Lead, or Uncontacted?</strong> Then it is
            flagged <em>Stuck in Lead</em> instead of no-contact. That is a different problem:
            somebody may have called, but nobody moved it forward.
          </li>
          <li>
            <strong>Does it carry a Zillow Connected tag?</strong> Then it counts as worked.
            That live-connect call happens on Zillow&rsquo;s side and never lands in Follow Up
            Boss, so counting it as untouched would be a false accusation.
          </li>
          <li>
            <strong>Otherwise:</strong> worked means <strong>two or more outgoing
            texts</strong>, or <strong>at least one call</strong> in either direction. Below
            that bar, it is no contact.
          </li>
        </ol>
        <p>
          Outgoing has to mean a person. Replies coming in don&rsquo;t count toward the
          agent&rsquo;s effort, and automated drip messages don&rsquo;t count at all. Two
          texts rather than one because a single text is often a template firing; two is
          somebody actually trying.
        </p>
        <p className="htw-note">
          <strong>The number is built to understate, never overstate.</strong> We only check
          contact history on leads created in the last 45 days &mdash; older ones are assumed
          worked. And each pass caps how many leads it checks in detail; anything skipped that
          round is assumed worked too, and picked up later. Nobody gets a strike because we
          ran out of room. If anything, real no-contact is slightly higher than shown.
        </p>
      </Section>

      <Section q="If an agent gets a lead to offer and it later closes, do they lose the offer credit?">
        <p>No. Credit is recorded once and never overwritten.</p>
        <p>
          The first time a lead reaches a milestone &mdash; offer, under contract, closed
          &mdash; we write that down and stamp the agent holding it at the time. A lead that
          climbs Submitting Offers &rarr; Under Contract &rarr; Closed leaves three separate
          records, each credited. Moving forward never erases where it has been.
        </p>
        <p>
          There is also a floor: if a deal reached contract or closing, it counts as having
          reached offer whether or not anybody logged the offer stage &mdash; because a deal
          cannot close without an offer having been made. So skipping the stage never shows up
          as zero offers.
        </p>
        <p className="htw-note">
          Under Contract and Closed are treated as the same thing throughout this board.
        </p>
      </Section>

      <Section q="Why do time-based numbers only go back so far?">
        <p>
          Because Follow Up Boss does not keep a stage history we can read. It will tell us
          where a lead sits today, but not the day it got there. Nothing can recover that
          after the fact &mdash; not us, not any tool that connects to a CRM later.
        </p>
        <p>So we do two things:</p>
        <ul>
          <li>
            <strong>A one-time snapshot on the day you connect.</strong> Every lead already at
            offer, under contract, or closed is recorded as real. Its date is approximated from
            the last time the lead was touched in Follow Up Boss, because that is the closest
            honest guess available.
          </li>
          <li>
            <strong>Exact tracking from that day forward.</strong> Every stage change after
            connection is stamped the moment it happens.
          </li>
        </ul>
        <p>
          That is why an all-time total can be trusted sooner than a &ldquo;last 90
          days&rdquo; figure. Windowed views get steadily more accurate the longer you are
          connected, and are fully reliable for any period that began after your start date.
        </p>
      </Section>

      <Section q="How much of the offer rate is measured, and how much is assumed?">
        <p>
          The Leads per offer tile tells you directly. It carries a tag &mdash;
          <strong> Recorded</strong>, <strong>Partly assumed</strong>, or <strong>Mostly
          assumed</strong> &mdash; and opens into the exact split for your team.
        </p>
        <p>
          The distinction matters. If your agents move leads into the offer stage as they go,
          the rate is measured and you can coach off it. If they skip that stage and jump
          straight to contract or closed, the rate is inferred from deals that closed &mdash;
          and an offer that was made and <em>lost</em> leaves no trace at all. Those lost
          attempts are exactly what an offer rate is meant to capture, so the figure reads
          lower than reality.
        </p>
        <p className="htw-note">
          Open the tag before using offer rate in a one-on-one. A rate built almost entirely
          from closings is a floor, not a measurement &mdash; and it becomes a real measurement
          from the day agents start using the stage.
        </p>
      </Section>

      <Section q="How is commission at risk calculated?">
        <p>
          Leads with no contact, multiplied by your close rate, multiplied by your average
          commission &mdash; then scaled up to a yearly figure from whatever window you are
          viewing.
        </p>
        <p>
          It uses <em>your</em> numbers from Settings, not industry averages. Change your
          average commission or close rate there and this moves with it.
        </p>
        <p>
          Pay-at-close leads are counted too. An unworked referral did not cost you money out
          of pocket, but it is still commission you didn&rsquo;t earn.
        </p>
        <p className="htw-note">
          Only leads with <em>no contact at all</em> are counted &mdash; not the ones that were
          worked badly. The real cost of a slow follow-up habit is higher than this figure.
        </p>
      </Section>

      <Section q="What triggers a strike and a pause recommendation?">
        <p>
          A paid lead that sits with no contact past roughly a day and a half opens a case
          against the agent holding it &mdash; one strike. When they finally work it, the case
          closes on its own.
        </p>
        <p>
          Reach the strike limit inside a rolling 30-day window &mdash; three by default, set
          under Settings &mdash; and Pulse recommends pausing new lead flow to that agent.
        </p>
        <p className="htw-note">
          <strong>It is a recommendation, never an action.</strong> Pulse does not pause
          anybody or change anything in Follow Up Boss. A human reads it, decides, and makes
          the change themselves.
        </p>
      </Section>

      <Section q="A number looks wrong. How do I check it?">
        <ol>
          <li>
            Open the same lead in Follow Up Boss. Pulse mirrors it, so if the stage or the
            logged activity differs there, that is your answer.
          </li>
          <li>
            Check the source filter under Settings. Turning a source off removes those leads
            from every figure on the board.
          </li>
          <li>
            Check how the contact was made. Calls and texts have to be logged in Follow Up
            Boss to be visible &mdash; a call from a personal cell that never syncs, or a
            conversation over email outside the CRM, cannot be counted.
          </li>
          <li>
            Check the date window. Lead totals count when a lead <em>came in</em>; milestones
            count when they were <em>reached</em>. Those two move independently, which is
            correct but can look strange at a glance.
          </li>
        </ol>
        <p className="htw-note">
          If it still looks wrong after that, it may genuinely be wrong &mdash; say so and it
          gets looked at. These rules are meant to be checkable, not taken on faith.
        </p>
      </Section>
    </div>
  );
}
