// The Social Studio compliance guardrail — a PURE function screen every piece of
// AI-generated copy passes through before it's ever shown to an agent. Mirrors
// the outbound compliance gate's design: no I/O, no LLM call, fully unit-tested,
// so it can never silently regress.
//
// Two jobs:
//  1. Flag Fair Housing Act steering/discriminatory language (protected classes:
//     race, color, religion, sex, handicap, familial status, national origin).
//     Flags are ADVISORY — content stays a draft for human review, never
//     auto-blocked, since some flagged phrases are borderline by context.
//  2. Auto-append the brokerage/license disclosure so nothing generated ships
//     without it (state license-law + NAR requirement).

export interface GuardrailResult {
  ok: boolean; // true iff no steering language detected
  flags: string[]; // human-readable reasons, one per hit
  text: string; // the input text, with disclosure appended if it was missing
  disclosureAppended: boolean;
}

// Steering/discriminatory phrase patterns, grouped by the FHA protected class they
// implicate. Case-insensitive; matched as substrings/regex against the draft copy.
// This is advisory pattern-matching, not legal advice — flagged items still need a
// human read, since some phrases are fine in context (e.g. "walkable to downtown").
const STEERING_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  // Familial status
  { re: /\b(perfect|ideal|great|good)\s+for\s+(a\s+)?famil(y|ies)\b/i, reason: 'Steers by familial status ("perfect for families")' },
  { re: /\bno\s+(kids|children)\b/i, reason: 'Excludes by familial status ("no kids/children")' },
  { re: /\badults?[\s-]only\b/i, reason: 'Excludes by familial status ("adults only")' },
  { re: /\bempty[\s-]nesters?\b/i, reason: 'Steers by familial status/age ("empty nesters")' },
  { re: /\bsingles?\s+(only|welcome|preferred)\b/i, reason: 'Steers by familial status ("singles only/welcome")' },
  // Religion
  { re: /\bwalking\s+distance\s+to\s+(church|temple|synagogue|mosque)\b/i, reason: 'Steers by religion (proximity to a house of worship)' },
  { re: /\b(christian|jewish|muslim|catholic)\s+(community|neighborhood|family)\b/i, reason: 'Steers by religion' },
  // National origin / race / color
  { re: /\b(ethnic|ethnically)\s+(diverse|homogenous)\b/i, reason: 'References ethnicity — national-origin steering risk' },
  { re: /\bexclusive\s+(neighborhood|community)\b/i, reason: 'Potentially exclusionary framing ("exclusive neighborhood")' },
  // Handicap / disability
  { re: /\bnot\s+(wheelchair|handicap)[\s-]?accessible\b/i, reason: 'Disability-related exclusionary phrasing' },
  { re: /\bable[\s-]bodied\b/i, reason: 'Disability steering ("able-bodied")' },
  // Sex / gender
  { re: /\bbachelor(?:'s)?\s+pad\b/i, reason: 'Gendered steering language ("bachelor pad")' },
  { re: /\bwomen[\s-]only\b/i, reason: 'Excludes by sex' },
  // Generic "safe neighborhood" — often a proxy for racial/ethnic steering
  { re: /\bsafe\s+neighborhood\b/i, reason: 'Common proxy for racial/ethnic steering ("safe neighborhood") — describe crime stats or safety features instead' },
  { re: /\bgood\s+schools?\b/i, reason: '"Good schools" can proxy for racial/ethnic steering — cite specific ratings/programs instead' },
];

/** Screen text for FHA steering/discriminatory language. Advisory, never blocking. */
export function screenFairHousing(text: string): { ok: boolean; flags: string[] } {
  const flags: string[] = [];
  for (const { re, reason } of STEERING_PATTERNS) {
    if (re.test(text)) flags.push(reason);
  }
  return { ok: flags.length === 0, flags };
}

/**
 * Append the brokerage/license disclosure if the text doesn't already carry one.
 * Cheap heuristic for "already has a disclosure": looks for a license-number-ish
 * pattern or the brokerage name already present, so we don't double-append across
 * regenerations.
 */
export function appendDisclosure(
  text: string,
  brandKit: { brokerageName?: string; licenseNumber?: string; disclosureText?: string } | undefined,
): { text: string; appended: boolean } {
  const disclosure =
    brandKit?.disclosureText ??
    (brandKit?.brokerageName
      ? `${brandKit.brokerageName}${brandKit.licenseNumber ? ` · Lic# ${brandKit.licenseNumber}` : ''}`
      : null);
  if (!disclosure) return { text, appended: false }; // no brand kit configured — nothing to append yet

  const already =
    text.includes(disclosure) ||
    (brandKit?.brokerageName && text.toLowerCase().includes(brandKit.brokerageName.toLowerCase())) ||
    (brandKit?.licenseNumber && text.includes(brandKit.licenseNumber));
  if (already) return { text, appended: false };

  return { text: `${text}\n\n${disclosure}`, appended: true };
}

/** Run both checks and return the ready-to-store result. */
export function runGuardrail(
  text: string,
  brandKit?: { brokerageName?: string; licenseNumber?: string; disclosureText?: string },
): GuardrailResult {
  const { ok, flags } = screenFairHousing(text);
  const { text: withDisclosure, appended } = appendDisclosure(text, brandKit);
  return { ok, flags, text: withDisclosure, disclosureAppended: appended };
}
