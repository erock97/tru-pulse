/**
 * SMS consent — the words we show, the words we store, and the number they apply to.
 *
 * Why this lives in `shared/` and not in the React page:
 *
 * The only thing that makes a consent record worth anything is being able to say,
 * years later, "on this date this person was shown EXACTLY these words and agreed
 * to them." If the screen owns the copy and the database stores whatever the
 * browser posted, then a client can claim consent to text it never displayed, and
 * a copy edit silently rewrites history for everyone who already agreed.
 *
 * So: the Worker imports SMS_CONSENT_TEXT from here and writes ITS copy to the
 * ledger, ignoring anything the browser sends. The page imports the same constant
 * to render. One string, one meaning.
 *
 * Changing the wording means bumping SMS_CONSENT_VERSION, never editing the text
 * in place. Old rows keep the old version and the old text; that is the point.
 */

/** Bump on ANY change to SMS_CONSENT_TEXT. Never edit the text without this. */
export const SMS_CONSENT_VERSION = '2026-08-24.1';

/** The sending brand, as it appears in every message. Carriers check that the
 *  brand in the message matches the brand on the campaign. */
export const SMS_BRAND = 'TRU HQ';

/** Where a recipient goes for help. Must be reachable by a human.
 *
 *  This is the address already published on truhq.co, deliberately. It was
 *  support@truhq.co, which nobody has confirmed receives mail — and a HELP reply
 *  pointing at a dead mailbox is a campaign-review failure, not a typo. Switch it
 *  once that inbox is confirmed live; the SMS terms page reads its address from
 *  BUSINESS.contactEmail, so the two must be changed together. */
export const SMS_SUPPORT_EMAIL = 'Admin@terrasonconsulting.com';

/** The public SMS terms page. Linked from the checkbox and from the HELP reply. */
export const SMS_TERMS_URL = 'https://truhq.co/sms-terms';
export const SMS_PRIVACY_URL = 'https://truhq.co/privacy';

/**
 * The consent sentence. Every clause here is load-bearing for A2P review:
 * who is sending, what kind of messages, that frequency varies, that rates may
 * apply, and how to stop. Do not trim it to make the screen prettier.
 */
export const SMS_CONSENT_TEXT =
  'I agree to receive SMS text messages from TRU HQ about my team’s operations, '
  + 'including reminders, check-ins and requests from my team leader. Message '
  + 'frequency varies. Message and data rates may apply. Reply STOP to opt out or '
  + 'HELP for help.';

/** The words the recipient gets back when they text STOP. */
export const SMS_STOP_REPLY =
  'TRU HQ: You have been unsubscribed and will receive no further messages. '
  + 'Reply START to resubscribe.';

/** The words the recipient gets back when they text HELP. */
export const SMS_HELP_REPLY =
  `TRU HQ team messaging. Support: ${SMS_SUPPORT_EMAIL}. `
  + 'Msg & data rates may apply. Reply STOP to unsubscribe.';

/**
 * Keywords that must stop messages, per CTIA. Carriers test these; a number that
 * ignores any one of them can have its campaign pulled.
 */
export const STOP_KEYWORDS = [
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT-OUT',
] as const;
export const START_KEYWORDS = ['START', 'YES', 'UNSTOP'] as const;
export const HELP_KEYWORDS = ['HELP', 'INFO'] as const;

/** Which of the three mandated keyword classes an inbound message is, if any. */
export function classifyInbound(body: string): 'stop' | 'start' | 'help' | null {
  // Carriers require the match to be forgiving of case, surrounding whitespace and
  // trailing punctuation — "Stop." and " STOP " must both work.
  const word = body.trim().replace(/[.!?,]+$/, '').toUpperCase();
  if ((STOP_KEYWORDS as readonly string[]).includes(word)) return 'stop';
  if ((START_KEYWORDS as readonly string[]).includes(word)) return 'start';
  if ((HELP_KEYWORDS as readonly string[]).includes(word)) return 'help';
  return null;
}

/**
 * A typed phone number in E.164, or null if it isn't a plausible North American
 * mobile number.
 *
 * Stored in E.164 and only E.164. The alternative — keeping whatever the person
 * typed — means the same human ends up as three different rows ("5551234567",
 * "(555) 123-4567", "+15551234567"), and an opt-out recorded against one of them
 * does not stop the other two. That failure mode is exactly what gets a campaign
 * shut down, so normalisation happens at the door.
 *
 * NANP validity is checked, not just length: neither the area code nor the
 * exchange code may begin with 0 or 1. This rejects the common fat-finger cases
 * (1234567890, 0000000000) that would otherwise sit in the ledger looking like
 * real consent.
 */
export function toE164US(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, '');

  // An explicit country code other than +1 is a real number we simply do not
  // support on this campaign — reject it rather than mangling it into a US one.
  if (raw.startsWith('+') && !digits.startsWith('1')) return null;

  let ten: string;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 11 && digits.startsWith('1')) ten = digits.slice(1);
  else return null;

  const area = ten.slice(0, 3);
  const exch = ten.slice(3, 6);
  if (area[0] === '0' || area[0] === '1') return null;
  if (exch[0] === '0' || exch[0] === '1') return null;

  return '+1' + ten;
}

/** E.164 back to something a human recognises: +15551234567 → (555) 123-4567. */
export function formatUS(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? '');
}

/** Last four digits, for confirming a number back to someone without printing it
 *  in full on a shared screen. */
export function lastFour(e164: string): string {
  return (e164 ?? '').slice(-4);
}

/**
 * Is this agent currently reachable by SMS?
 *
 * Opt-out beats opt-in on ties and on anything later, and a missing phone beats
 * both. Written once, here, because the send path, the UI and the export all have
 * to agree — three copies of this comparison would eventually disagree, and the
 * failure mode is texting someone who told you to stop.
 */
export function isSmsReachable(a: {
  sms_phone: string | null;
  sms_consent_at: string | null;
  sms_opt_out_at: string | null;
}): boolean {
  if (!a.sms_phone || !a.sms_consent_at) return false;
  if (!a.sms_opt_out_at) return true;
  return new Date(a.sms_opt_out_at).getTime() < new Date(a.sms_consent_at).getTime();
}
