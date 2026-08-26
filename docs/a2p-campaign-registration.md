# A2P 10DLC campaign registration — what to submit

The first submission was denied under an older scope. This is the resubmission
copy, matching what the product actually does as of 2026-08-24.

**Everything here must stay true.** These are claims to a carrier, not marketing.
If the product changes, change this file and the campaign before the product
ships — a campaign that describes something you no longer do gets revoked, and
the number goes with it.

---

## Before you submit — the checklist

- [x] `https://truhq.co/sms-terms` resolves and states every mandated clause
- [x] `https://truhq.co/privacy` carries the sharing prohibition on the page
- [x] Both pages linked from the site footer
- [x] Consent captured at account creation, stored with wording + timestamp + IP
- [x] STOP/HELP handled, opt-out honoured by phone number regardless of account
- [ ] **A real screenshot of the consent screen with a real opted-in user**
- [ ] `Admin@terrasonconsulting.com` confirmed monitored (it is the HELP address)

The one genuinely outstanding item is the screenshot. Invite a real agent, walk
the invite email through, and capture the consent step. A mocked-up screenshot
with no consent records behind it is the other thing reviewers catch.

---

## Campaign type

**Low Volume Mixed**, under the existing Terrason brand.

Do not re-register the brand if it is already approved — resubmit the campaign
only. Low Volume reviews faster and the throughput is ample for a pilot.

---

## Campaign description

> TRU HQ is an internal team operations platform for real estate brokerages. A
> team leader uses an AI assistant to send operational messages to licensed
> agents on their own team — appointment reminders, transaction deadlines,
> accountability check-ins, and internal requests for status updates. Recipients
> are exclusively members of the leader's own team who hold an account on
> app.truhq.co and have given express written consent to receive SMS. This
> campaign sends no marketing, no promotional offers, and no messages to
> consumers, clients, or leads of any kind.

---

## Opt-in / message flow

This is the field that decides the campaign. It changed from the earlier draft:
consent is now collected during **account creation**, not at a later step.

> Consent is collected via web form during account creation. An agent is invited
> by their team leader and receives an email invitation. Clicking it takes them to
> app.truhq.co, where they set their own password to create their account. The
> next step of account creation asks whether their team leader may text them. They
> enter their own mobile number and tick a box that is unchecked by default, which
> reads: "I agree to receive SMS text messages from TRU HQ about my team's
> operations, including reminders, check-ins and requests from my team leader.
> Message frequency varies. Message and data rates may apply. Reply STOP to opt
> out or HELP for help." The step can be skipped, and every feature of the product
> remains available to someone who declines. Consent is stored with a timestamp,
> the IP address, and the exact wording shown. Phone numbers are never imported,
> purchased, or taken from any customer relationship system — a number is only
> ever typed by the person it belongs to, and no number is messaged until that box
> is ticked by the account holder.

Attach: a screenshot of that step, and the URL `https://app.truhq.co`.

---

## Sample messages

1. `TRU HQ: Hi Sarah, your team leader is asking for a status update on 412 Oakmont — under contract or still pending? Reply here. Reply STOP to opt out.`
2. `TRU HQ: Reminder — inspection contingency on your Maple Ave file expires Thursday. Reply STOP to opt out.`
3. `TRU HQ: Weekly check-in. You have 3 leads in your pipeline with no contact logged in 48 hours. Reply DONE once you've reached them.`
4. `TRU HQ: Team meeting moved to Tuesday 9am. Reply Y to confirm attendance. Reply STOP to opt out.`

---

## Required URLs

| Field | Value |
|---|---|
| Opt-in / CTA page | `https://app.truhq.co` |
| Terms of service (SMS) | `https://truhq.co/sms-terms` |
| Privacy policy | `https://truhq.co/privacy` |

---

## Keyword replies

Configured in `shared/smsConsent.ts` — quote these exactly on the form.

**STOP** → `TRU HQ: You have been unsubscribed and will receive no further messages. Reply START to resubscribe.`

**HELP** → `TRU HQ team messaging. Support: Admin@terrasonconsulting.com. Msg & data rates may apply. Reply STOP to unsubscribe.`

Stop keywords honoured: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE,
OPTOUT, OPT-OUT. Start: START, YES, UNSTOP. Help: HELP, INFO.

---

## If it is denied again

Ask for the specific rejection reason rather than resubmitting — a second
rejection on the same ground is much harder to recover from. The three most
common causes, in order:

1. The opt-in description does not point at a consent path the reviewer can reach
   and verify. Ours does; make sure the screenshot matches the live screen.
2. The privacy policy lacks the sharing prohibition **on the page itself**, not in
   a linked PDF. Ours has it, verified in the deployed bundle.
3. Sample messages that read as marketing, or that lack the brand name. Ours name
   TRU HQ and carry STOP.
