// Leader-facing wording for how an offer rate was arrived at.
//
// This exists because "42 offers" and "42 offers, 41 of which we assumed" lead to
// completely different coaching conversations. A leader is going to sit across from
// an agent with this number on screen, so it has to say WHY a figure is assumed and
// what that means for the number — never just label it "assumed" and leave them to
// guess.
//
// House rules for every string below:
//   - plain English, no internal vocabulary (no stage classes, no column names)
//   - name the CAUSE (the agent never moved the lead) and the CONSEQUENCE
//     (offers that lost are missing, so the rate reads low)
//   - an imprecise DATE is not the same as a doubtful OFFER; don't conflate them
import type { OfferEvidence } from './metrics.js';

export type OfferConfidence = 'no-data' | 'measured' | 'mixed' | 'mostly-assumed';

export interface OfferEvidenceLine {
  count: number;
  /** One sentence a team leader can read aloud. */
  plain: string;
}

export interface OfferEvidenceExplanation {
  total: number;
  confidence: OfferConfidence;
  /** The one-line split, e.g. "42 offers counted — 1 recorded, 41 assumed." */
  headline: string;
  lines: OfferEvidenceLine[];
  /** Present only when enough of the number is assumed to change how it's read. */
  caution: string | null;
}

/** Above this share of assumed credits, the rate stops meaning what it appears to. */
const MOSTLY_ASSUMED = 0.6;
const SOME_ASSUMED = 0.25;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function explainOfferEvidence(e: OfferEvidence): OfferEvidenceExplanation {
  const total = e.observedLive + e.observedBaseline + e.inferredFromClosing;

  if (total === 0) {
    return {
      total: 0,
      confidence: 'no-data',
      headline: 'No offers counted in this period.',
      lines: [],
      caution: null,
    };
  }

  const assumedShare = e.inferredFromClosing / total;
  const confidence: OfferConfidence =
    assumedShare > MOSTLY_ASSUMED ? 'mostly-assumed' : assumedShare > SOME_ASSUMED ? 'mixed' : 'measured';

  const lines: OfferEvidenceLine[] = [];

  if (e.inferredFromClosing > 0) {
    const n = e.inferredFromClosing;
    lines.push({
      count: n,
      plain:
        `${n} ${plural(n, 'offer is counted', 'offers are counted')} because the ${plural(n, 'deal', 'deals')} ` +
        `reached contract or closing, and that cannot happen without an offer being made. ` +
        `The agent never moved the lead into the offer stage, so Follow Up Boss holds no record of the ` +
        `offer itself — we know it happened, but not when, so the closing date is used instead.`,
    });
  }

  if (e.observedLive > 0) {
    const n = e.observedLive;
    lines.push({
      count: n,
      plain:
        `${n} ${plural(n, 'offer was', 'offers were')} watched happening: the agent moved the lead into the ` +
        `offer stage and we recorded the date at that moment. ${plural(n, 'This one is', 'These are')} exact.`,
    });
  }

  if (e.observedBaseline > 0) {
    const n = e.observedBaseline;
    lines.push({
      count: n,
      plain:
        `${n} ${plural(n, 'offer was', 'offers were')} already sitting at the offer stage when this team was ` +
        `first set up. The ${plural(n, 'offer is', 'offers are')} real, but we joined partway through, so the ` +
        `exact day is approximate — we used the day the lead was last touched in Follow Up Boss.`,
    });
  }

  const recorded = e.observedLive + e.observedBaseline;
  const headline =
    `${total} ${plural(total, 'offer', 'offers')} counted — ` +
    `${recorded} recorded, ${e.inferredFromClosing} assumed.`;

  let caution: string | null = null;
  if (confidence === 'mostly-assumed') {
    caution =
      `Read this rate as a floor, not a measurement. Almost all of it comes from deals that closed, ` +
      `and an offer that was made and lost leaves no trace at all when the agent skips the offer stage. ` +
      `Those missing attempts are exactly what an offer rate is meant to capture, so the true number is ` +
      `higher than what you see here — possibly much higher. It becomes reliable once agents start moving ` +
      `leads into the offer stage; tracking is accurate from the day they do.`;
  } else if (confidence === 'mixed') {
    caution =
      `Part of this rate is assumed from deals that closed. Offers that were made and lost are only ` +
      `counted when the agent moved the lead into the offer stage, so the real number is somewhat higher ` +
      `than shown.`;
  }

  return { total, confidence, headline, lines, caution };
}

// ── The DISPLAYED offer rate ────────────────────────────────────────────────
// The dashboard's offer rate uses each lead's CURRENT stage, created-date
// windowed (Eric's baseline, 2026-07-07 — see Dashboard.tsx, which supersedes
// the achievement-date approach in docs/accuracy-definitions.md). So the
// evidence question for the number a leader is looking at is not "what did the
// history log say" but "where does this lead sit right now, and did we ever
// actually see the offer".
//
// Three outcomes, and the third is the one nobody could see before:
//   visibleAtOfferStage  sitting at an offer stage now — the offer is on screen
//   assumedFromAdvance   sitting at contract/closed now — an offer must have
//                        happened to get there, but nothing recorded it
//   knownButNotCounted   we DID record this lead making an offer, and it has
//                        since fallen back (Nurture, lost, re-engaged...). The
//                        current-stage rule drops it, so the rate reads low by
//                        exactly this many — a measured floor on the undercount.

export interface DisplayedOfferEvidence {
  visibleAtOfferStage: number;
  assumedFromAdvance: number;
  /** Recorded as reaching offer or beyond, and has since moved BACKWARD. */
  knownButNotCounted: number;
  /** Of those, the ones that got as far as contract/closed — deals that fell apart. */
  fellBackFromContract: number;
}

/**
 * Which leads we have a record of reaching offer OR BEYOND, and how far they got.
 *
 * Deliberately not just the offer stage: a lead that reached under contract and
 * then died certainly made an offer, and the current-stage rule drops it exactly
 * the same way. Anything that moved backward from offer-or-beyond is a real
 * attempt missing from the rate.
 */
export function recordedOfferPersons(
  rows: Array<{ fub_person_id: number; stage_class?: string | null }>,
): Map<number, 'offer' | 'contract'> {
  const out = new Map<number, 'offer' | 'contract'>();
  for (const r of rows) {
    const c = r.stage_class;
    if (c === 'uc' || c === 'closed') {
      out.set(r.fub_person_id, 'contract'); // reaching contract always outranks
    } else if (c === 'offer' && !out.has(r.fub_person_id)) {
      out.set(r.fub_person_id, 'offer');
    }
  }
  return out;
}

const OFFER_STAGE_RE = /offer/i;
const ADVANCED_RE = /contract|closed|pending|escrow/i;
const DEAD_RE = /lost|dead|trash|archive|junk|spam|not interested|no longer/i;

/**
 * @param leads          the same windowed, source-filtered lead set the tile counts
 * @param recordedOffers person ids we have an actual recorded offer event for
 */
export function currentStageOfferEvidence(
  // Deliberately as loose as LeadRow really is: fub_person_id is nullable there,
  // and a lead with no person id simply can't be matched to a recorded offer.
  leads: Array<{ fub_person_id?: number | null; stage?: string | null }>,
  recordedOffers: Map<number, 'offer' | 'contract'>,
): DisplayedOfferEvidence {
  const out: DisplayedOfferEvidence = {
    visibleAtOfferStage: 0, assumedFromAdvance: 0, knownButNotCounted: 0, fellBackFromContract: 0,
  };
  for (const l of leads) {
    const stage = l.stage ?? '';
    if (ADVANCED_RE.test(stage) && !DEAD_RE.test(stage)) {
      out.assumedFromAdvance++;
    } else if (OFFER_STAGE_RE.test(stage) && !DEAD_RE.test(stage)) {
      out.visibleAtOfferStage++;
    } else if (l.fub_person_id != null) {
      const reached = recordedOffers.get(l.fub_person_id);
      if (reached) {
        out.knownButNotCounted++;
        if (reached === 'contract') out.fellBackFromContract++;
      }
    }
  }
  return out;
}

export function explainCurrentStageOffers(e: DisplayedOfferEvidence): OfferEvidenceExplanation {
  const counted = e.visibleAtOfferStage + e.assumedFromAdvance;

  if (counted === 0 && e.knownButNotCounted === 0) {
    return {
      total: 0,
      confidence: 'no-data',
      headline: 'No offers counted in this period.',
      lines: [],
      caution: null,
    };
  }

  const assumedShare = counted > 0 ? e.assumedFromAdvance / counted : 0;
  const confidence: OfferConfidence =
    assumedShare > MOSTLY_ASSUMED ? 'mostly-assumed' : assumedShare > SOME_ASSUMED ? 'mixed' : 'measured';

  const lines: OfferEvidenceLine[] = [];

  if (e.assumedFromAdvance > 0) {
    const n = e.assumedFromAdvance;
    lines.push({
      count: n,
      plain:
        `${n} ${plural(n, 'is counted', 'are counted')} because the ${plural(n, 'deal', 'deals')} ` +
        `reached contract or closing, and a deal cannot get there without an offer having been made. ` +
        `The agent never moved the lead into the offer stage on the way, so Follow Up Boss has no record ` +
        `of the offer itself and no date for it.`,
    });
  }

  if (e.visibleAtOfferStage > 0) {
    const n = e.visibleAtOfferStage;
    lines.push({
      count: n,
      plain:
        `${n} ${plural(n, 'is', 'are')} sitting at the offer stage right now, so ${plural(n, 'that offer is', 'those offers are')} ` +
        `plainly on the record — no guesswork.`,
    });
  }

  if (e.knownButNotCounted > 0) {
    const n = e.knownButNotCounted;
    const fell = e.fellBackFromContract;
    const contractBit =
      fell > 0
        ? ` ${fell} of ${plural(n, 'them', 'those')} got as far as under contract or closed before falling back — ` +
          `${plural(fell, 'that is a deal', 'those are deals')} that came apart, not just an offer that lost.`
        : '';
    lines.push({
      count: n,
      plain:
        `${n} more ${plural(n, 'offer we recorded is', 'offers we recorded are')} not counted here at all. ` +
        `${plural(n, 'That lead', 'Those leads')} reached the offer stage or beyond and ${plural(n, 'has', 'have')} ` +
        `since moved back to an earlier stage, and this rate only looks at where a lead sits today.` +
        contractBit +
        ` ${plural(n, 'It is a real attempt', 'They are real attempts')} missing from the number.`,
    });
  }

  const headline =
    `${counted} ${plural(counted, 'offer', 'offers')} counted — ` +
    `${e.visibleAtOfferStage} on the record, ${e.assumedFromAdvance} assumed` +
    (e.knownButNotCounted > 0 ? `, ${e.knownButNotCounted} known but not counted.` : '.');

  let caution: string | null = null;
  if (confidence === 'mostly-assumed') {
    caution =
      `Treat this as a floor, not a measurement. Nearly all of it is inferred from deals that closed. ` +
      `When an agent skips the offer stage, an offer that was made and lost leaves no trace anywhere — ` +
      `and those lost attempts are exactly what an offer rate is supposed to measure. The real number is ` +
      `higher than this, and there is no way to recover how much higher for the past. It becomes a true ` +
      `measurement from the day agents start moving leads into the offer stage.`;
  } else if (confidence === 'mixed') {
    caution =
      `Some of this is inferred from deals that closed rather than from a recorded offer. Offers that were ` +
      `made and lost only show up when the agent moved the lead into the offer stage, so the real number is ` +
      `somewhat higher than shown.`;
  } else if (e.knownButNotCounted > 0) {
    caution =
      `This rate counts where each lead sits today, so offers that were made and then fell back drop out ` +
      `of it. We know of ${e.knownButNotCounted} in this period.`;
  }

  return { total: counted, confidence, headline, lines, caution };
}

/** Short chip text for a dashboard tile. */
export function offerConfidenceLabel(c: OfferConfidence): string {
  switch (c) {
    case 'no-data': return 'No offers yet';
    case 'measured': return 'Recorded';
    case 'mixed': return 'Partly assumed';
    case 'mostly-assumed': return 'Mostly assumed';
  }
}
