// Can the evidence actually carry the claim?
//
// ── Why this exists ─────────────────────────────────────────────────────────
// On 2026-08-25 the Coach tab told Eric that Joseph Darlington "told Bishoy
// Yacoub a completely blank seller disclosure was not a red flag while still
// moving the offer forward with inspections later."
//
// The entire evidence behind that sentence was Follow Up Boss's one-line
// summary of a 79-second call:
//
//   "The agent is working on an offer for a condo. The seller's disclosure is
//    completely blank."
//
// Two facts. Everything else — the reassurance, the inspections, the framing —
// was written by the analysis and presented as something the agent said. Eric
// was about to phone that agent about it.
//
// His read, and it is the correct one: the moment a broker repeats one of these
// to an agent and is wrong, they stop trusting all of it, start double-checking
// everything, and the product has cost them time instead of saving it. One
// fabricated claim is not a bad row — it is the end of the tool.
//
// ── What this module does, and what it deliberately does not ────────────────
// It cannot tell whether an analysis is RIGHT. It can tell whether the evidence
// stored beside a claim is capable of supporting it, which is a narrower
// question with a reliable answer:
//
//   A claim about what somebody SAID needs someone's WORDS.
//
// A third-person summary — "the agent explained", "the lead expressed" — is a
// description of a conversation, not a record of it. It cannot establish a
// phrase, a tone, or the absence of either. Live on the day this was written,
// 44 of 58 call quotes were summaries; texts were fine, at 191 of 192 verbatim.
//
// Nothing here deletes a finding. A claim the evidence cannot carry is
// downgraded to what the record actually shows, and the directive becomes a
// question for the leader to ask rather than an assertion to repeat.

/** Follow Up Boss's own furniture, and the shape of its generated summaries. */
const SUMMARY_MARKERS = [
  /summary\s+transcript/i,
  /suggested\s+tasks/i,
  /did you find the summary useful/i,
  /\bcall summary\b/i,
];

/** A summary narrates in the third person about roles, not names. */
const THIRD_PERSON_OPENERS =
  /(^|[.!?]\s+)(the\s+)?(agent|lead|client|caller|buyer|seller)\s+(is|was|has|had|will|would|said|says|asked|offered|advised|explained|suggested|committed|expressed|indicated|mentioned|warned|confirmed|informed|discussed|wants|wanted|noted)\b/i;

/**
 * Is this quote the words somebody actually used?
 *
 * Conservative on purpose. Anything ambiguous counts as verbatim, because
 * wrongly suppressing a real finding also costs trust — just more quietly.
 * The test only fires on evidence that is unmistakably a generated summary.
 */
export function isVerbatimEvidence(quote: string | null | undefined): boolean {
  const q = (quote ?? '').trim();
  if (!q) return false;
  if (SUMMARY_MARKERS.some((re) => re.test(q))) return false;
  // A summary that also carries a real quoted phrase is still usable evidence
  // for that phrase, so quoted speech wins over the third-person shape.
  if (/["“”'‘’]\s*\w/.test(q) && q.length > 40) return true;
  return !THIRD_PERSON_OPENERS.test(q);
}

/**
 * Does this claim assert what somebody said, or failed to say?
 *
 * Both halves matter and the negative half is the dangerous one. "He told her
 * it was not a red flag" needs his words. So does "she never offered a time" —
 * an absence is a claim about the whole conversation, and a one-line summary
 * would not have mentioned it either way.
 */
export function assertsSpeech(explanation: string | null | undefined): boolean {
  const e = (explanation ?? '').toLowerCase();
  if (!e) return false;
  const SPOKE = /\b(told|said|says|asked|replied|answered|explained|reassured|promised|claimed|stated|mentioned|suggested|offered|warned|committed|advised|assured|responded)\b/;
  const DID_NOT = /\b(never|did not|didn't|does not|doesn't|without (?:ever )?(?:giving|offering|asking|saying|explaining)|failed to|no attempt to)\b/;
  return SPOKE.test(e) || DID_NOT.test(e);
}

export type ClaimSupport =
  /** Someone's actual words are on file. Show the claim as written. */
  | 'backed'
  /** The claim is about behaviour we can see without a transcript. */
  | 'observational'
  /** It asserts speech, and all we hold is a description of the call. */
  | 'unsupported';

/**
 * The verdict for one coaching point.
 *
 * `unsupported` is not "probably false" — it is "we cannot show this, so we
 * must not say it." The analysis may well be right. It does not get to be right
 * at a broker's expense.
 */
export function claimSupport(
  explanation: string | null | undefined,
  quotes: Array<string | null | undefined>,
): ClaimSupport {
  const anyVerbatim = quotes.some(isVerbatimEvidence);
  if (anyVerbatim) return 'backed';
  if (!assertsSpeech(explanation)) return 'observational';
  return 'unsupported';
}

/**
 * What the record can honestly be said to show, when the claim itself cannot
 * be repeated.
 *
 * Summaries are worth keeping — the blank disclosure on Bishoy Yacoub's condo
 * is real, unusual, and exactly what a broker should ask about. What must go is
 * the invented sentence around it. So the evidence is handed back as-is,
 * stripped of Follow Up Boss's interface furniture, and the leader is pointed
 * at it rather than told a story about it.
 */
export function recordShows(quotes: Array<string | null | undefined>): string | null {
  for (const raw of quotes) {
    const q = (raw ?? '')
      .replace(/\bsummary\s+transcript\b/gi, ' ')
      .replace(/\bsuggested\s+tasks\b/gi, ' ')
      .replace(/did you find the summary useful\??/gi, ' ')
      // "Joseph Darlington Bishoy Yacoub (1 min 19 sec) Aug 20 ..." — the
      // scraped thread header, glued to the front of the body.
      .replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,5}\s*\((?:\d+\s*(?:min|sec)\s*)+\)\s*[A-Z][a-z]{2}\s+\d{1,2}\s*/,'')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (q.length > 25) return q;
  }
  return null;
}
