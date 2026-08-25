import { describe, it, expect } from 'vitest';
// Read with Vite's `?raw`, not node:fs. Same source text, but it is typed by
// vite/client, so this file typechecks under the app's tsconfig — which has no
// Node types and should not grow them for one test.
import smsTerms from './pages/SmsTerms.tsx?raw';
import privacy from './pages/Privacy.tsx?raw';
import footer from './SiteFooter.tsx?raw';

/**
 * The SMS pages are the only pages on this site read by someone other than a
 * customer: a mobile carrier reviews them before approving the number TRU sends
 * from, and the A2P campaign registration cites both URLs.
 *
 * These assertions are not style policing. Each phrase below is one a reviewer
 * looks for, and a campaign is refused when one is missing — which is what
 * happened to the first submission. Prose can be rewritten freely around them;
 * removing one should fail here, on this branch, rather than six weeks later in
 * a rejection email with no reason attached.
 *
 * Read as source text rather than rendered, deliberately. Rendering would need a
 * DOM and would still not prove the words survive into the shipped bundle; the
 * file on disk is the thing that gets built.
 */
/** Collapse JSX whitespace so an assertion is not defeated by a line wrap. */
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('SMS terms page', () => {
  const t = flat(smsTerms);

  it('states that message frequency varies', () => {
    expect(t).toContain('frequency varies');
  });

  it('states that message and data rates may apply', () => {
    expect(t).toContain('Message and data rates may apply');
  });

  it('names every keyword that must stop messages', () => {
    // CTIA-mandated. Carriers test these; a number that ignores one can have its
    // campaign pulled, so the page must not promise fewer than the code honours.
    for (const kw of ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']) {
      expect(t).toContain(kw);
    }
  });

  it('tells the reader HELP works and gives a human contact', () => {
    expect(t).toContain('HELP');
    expect(t).toContain('contactEmail');
  });

  it('says opting out is free and immediate', () => {
    expect(t).toContain('free, takes effect immediately');
  });

  it('reproduces the consent sentence shown in the product', () => {
    // Must match shared/smsConsent.ts. If the product's wording changes, this
    // page is a misstatement to a carrier until it changes too.
    expect(t).toContain('I agree to receive SMS text messages from TRU HQ');
    expect(t).toContain('Reply STOP to opt out or HELP for help');
  });

  it('states the sharing prohibition verbatim', () => {
    expect(t).toContain(
      'Mobile phone numbers and SMS consent are never sold, rented, or shared with third parties'
      + ' or affiliates for marketing or promotional purposes',
    );
  });

  it('states plainly that this is never marketing and never reaches clients or leads', () => {
    expect(t).toContain('never message consumers');
    expect(t).toContain('internal team communication only');
  });

  it('states that numbers are never obtained from anywhere but the person themselves', () => {
    // The single claim the last campaign turned on. Importing from a CRM is not
    // consent, and the page has to say so.
    expect(t).toContain('never obtain phone numbers from any other source');
  });
});

describe('privacy policy', () => {
  const p = flat(privacy);

  it('carries the sharing prohibition on the page itself', () => {
    // Reviewers look for this on /privacy specifically, not only on the SMS page.
    expect(p).toContain(
      'Mobile phone numbers and SMS consent are never sold, rented, or shared with third parties'
      + ' or affiliates for marketing or promotional purposes',
    );
  });

  it('no longer claims we never collect a phone number', () => {
    // It said exactly that before the platform started collecting one. A policy
    // that contradicts the product is an affirmative misstatement, which is the
    // failure this file's own header warns about.
    expect(p).not.toContain('We do not ask for or collect a phone number');
  });

  it('names the messaging provider among the processors', () => {
    expect(p).toContain('Twilio');
  });

  it('links to the SMS terms', () => {
    expect(p).toContain('/sms-terms');
  });
});

describe('footer', () => {
  it('links the SMS terms, so a reviewer finds them without the direct URL', () => {
    expect(flat(footer)).toContain('href="/sms-terms"');
  });
});
