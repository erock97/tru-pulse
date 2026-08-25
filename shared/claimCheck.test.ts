// The real cases, from production on 2026-08-25. Both of these reached a
// broker as statements of fact, and one of them nearly reached the agent.
import { describe, expect, it } from 'vitest';
import {
  assertsSpeech, claimSupport, isVerbatimEvidence, recordShows,
} from './claimCheck';

/** Joseph Darlington / Bishoy Yacoub. A 79-second call. */
const BISHOY_SUMMARY =
  "Joseph Darlington Bishoy Yacoub (1 min 19 sec) Aug 20 Summary Transcript "
  + "The agent is working on an offer for a condo. The seller's disclosure is completely blank.";
const BISHOY_CLAIM =
  'He told Bishoy Yacoub a completely blank seller disclosure was not a red flag '
  + 'while still moving the offer forward with inspections later.';

/** Fernanda Silva / Mitul Shah. A 23-second call. */
const MITUL_SUMMARY =
  'Fernanda Silva Mitul Shah (23 sec) Aug 20 Summary Transcript The lead expressed that '
  + 'it is not a good time for them to discuss real estate matters and indicated they '
  + 'would call back personally when they are available.';
const MITUL_CLAIM =
  'On the Mitul Shah call the conversation ended after a brief introduction when he said '
  + 'it was not a good time, without giving him a chance to choose a specific time to talk later.';

/** A real text body, which is what good evidence looks like. */
const REAL_TEXT =
  "Hi Ashley, it's Joseph Darlington from Zillow Preferred. I'm still keeping an eye out "
  + 'for any new opportunities that fit what you’re looking for. Would you like to catch '
  + 'up soon and discuss your plans?';

describe('the two claims that actually shipped', () => {
  it('refuses the Bishoy claim — no words, and it quotes him', () => {
    expect(claimSupport(BISHOY_CLAIM, [BISHOY_SUMMARY])).toBe('unsupported');
  });

  it('refuses the Mitul claim — an absence a summary could never establish', () => {
    // "without giving him a chance to choose a time" is a statement about the
    // whole call. A one-line summary would not have mentioned it either way.
    expect(claimSupport(MITUL_CLAIM, [MITUL_SUMMARY])).toBe('unsupported');
  });

  it('accepts a claim standing on a real message', () => {
    const claim = 'He asked Ashley if she wanted to catch up soon and never offered a time.';
    expect(claimSupport(claim, [REAL_TEXT])).toBe('backed');
  });
});

describe('telling a record from a description of one', () => {
  it('knows Follow Up Boss furniture when it sees it', () => {
    expect(isVerbatimEvidence(BISHOY_SUMMARY)).toBe(false);
    expect(isVerbatimEvidence('The agent will provide the lead with updates. '
      + 'Did you find the summary useful?')).toBe(false);
  });

  it('knows a third-person narration of a call', () => {
    expect(isVerbatimEvidence('The lead has not found any properties of interest '
      + 'in New Jersey at this time.')).toBe(false);
  });

  it('accepts a message somebody typed', () => {
    expect(isVerbatimEvidence(REAL_TEXT)).toBe(true);
    expect(isVerbatimEvidence('Traveling, I apologize. Call you once I return, '
      + 'thank you for following up.')).toBe(true);
  });

  it('accepts a summary that still carries real quoted speech', () => {
    // The phrase is on file even if the wrapper is not, so the phrase can be
    // stood behind. Being wrong in this direction only costs a softer label.
    expect(isVerbatimEvidence('The agent noted the buyer said "I need to talk to '
      + 'my wife before we commit to anything this week."')).toBe(true);
  });

  it('treats nothing at all as nothing', () => {
    expect(isVerbatimEvidence('')).toBe(false);
    expect(isVerbatimEvidence(null)).toBe(false);
  });
});

describe('which claims need words', () => {
  it('catches an assertion about what was said', () => {
    expect(assertsSpeech('He told her it was not a red flag.')).toBe(true);
    expect(assertsSpeech('She reassured him the disclosure was routine.')).toBe(true);
  });

  it('catches the negative form, which is the dangerous one', () => {
    expect(assertsSpeech('She never offered a specific time.')).toBe(true);
    expect(assertsSpeech('He did not ask what was prompting the move.')).toBe(true);
    expect(assertsSpeech('The message went out without ever asking for a time.')).toBe(true);
  });

  it('leaves observable behaviour alone', () => {
    // No transcript needed to see a channel or a gap. These keep working
    // exactly as before, which is most of the value in the product.
    expect(assertsSpeech('He texted her about the listing.')).toBe(false);
    expect(assertsSpeech('The lead went eleven days with no contact.')).toBe(false);
  });

  it('lets an observational claim stand on a summary', () => {
    expect(claimSupport('He texted rather than calling.', [MITUL_SUMMARY]))
      .toBe('observational');
  });
});

describe('what the record can honestly be said to show', () => {
  it('hands back the facts and drops the interface furniture', () => {
    // The blank disclosure is real, unusual and exactly what a broker should
    // ask about. Only the invented sentence around it has to go.
    expect(recordShows([BISHOY_SUMMARY]))
      .toBe("The agent is working on an offer for a condo. The seller's disclosure is completely blank.");
  });

  it('strips the scraped thread header from the front', () => {
    expect(recordShows([MITUL_SUMMARY])).toBe(
      'The lead expressed that it is not a good time for them to discuss real estate '
      + 'matters and indicated they would call back personally when they are available.',
    );
  });

  it('returns nothing rather than a fragment', () => {
    expect(recordShows(['Summary Transcript'])).toBeNull();
    expect(recordShows([])).toBeNull();
  });
});
