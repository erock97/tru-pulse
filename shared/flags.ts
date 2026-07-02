// ═══════════════════════════════════════════════════════════════════════════
// TRU Pulse — flag math + source families
// ═══════════════════════════════════════════════════════════════════════════
// Kept IDENTICAL to the audit tool (accountability_audit.py) so Pulse's numbers
// match the audit a prospect already saw. Pure functions — usable in the Worker
// (ingestion), the web layer, and unit tests. No I/O here.

export const OUTBOUND_TYPES = new Set(['call', 'email', 'text message', 'sms', 'text']);
export const STUCK_STAGES = new Set(['lead', 'new lead', 'uncontacted']);
export const ZILLOW_CONNECTED_TAG = 'zillow connected';

// The big paid lead sources, matched by FAMILY (substring) so naming variants land
// ("Zillow Premier Agent", "FB Ads", ...). Realtor.com folds in MVIP / Market VIP.
// Referrals = pay-at-close networks. Bare "Opcity" is intentionally excluded (sunsetting).
export const SOURCE_FAMILIES: Array<[string, string[]]> = [
  ['Zillow',      ['zillow']],                     // incl. Zillow Flex (pay-at-close)
  // MVIP must match BEFORE plain Realtor.com ("Realtor.com MVIP" contains both).
  ['Realtor.com MVIP', ['market vip', 'mvip']],    // "Realtor.com MVIP", "Market VIP via Opcity BLA"
  ['Realtor.com', ['realtor.com', 'realtordotcom']],
  ['Homes.com',   ['homes.com']],
  ['Facebook',    ['facebook', 'instagram']],
  ['Google',      ['google', 'adwords', 'local services', 'lsa', 'ppc']],
  ['Referrals',   ['redfin', 'homelight', 'rocket homes', 'rockethomes',
                   'upnest', 'referralexchange', 'fastexpert', 'fast expert']],
];

/** Map a raw FUB source string to a tracked paid-source family, or null if untracked. */
export function sourceFamily(source: string | null | undefined): string | null {
  const s = (source ?? '').trim().toLowerCase();
  if (!s) return null;
  for (const [label, keys] of SOURCE_FAMILIES) {
    if (keys.some((k) => s.includes(k))) return label;
  }
  return null;
}

export function isTargetSource(source: string | null | undefined): boolean {
  return sourceFamily(source) !== null;
}

// Payment model per source family — surfaced in the UI so pay-at-close leads aren't
// mislabeled as out-of-pocket "paid" spend. Realtor.com / Homes.com / Facebook /
// Google are paid up front (subscription or ad spend); Zillow (Flex) and referral
// networks pay a fee at close. "Wasted spend" framing applies ONLY to paid-up-front
// sources; an un-worked pay-at-close lead is untapped GCI, not out-of-pocket loss.
// NOTE (Eric): confirm per-source if a specific team's contracts differ.
export type PayModel = 'upfront' | 'atclose';
export const PAY_MODEL: Record<string, PayModel> = {
  'Zillow': 'atclose',
  'Realtor.com MVIP': 'atclose',  // Market VIP / Opcity = referral fee at close
  'Realtor.com': 'upfront',
  'Homes.com': 'upfront',
  'Facebook': 'upfront',
  'Google': 'upfront',
  'Referrals': 'atclose',
  'Other': 'upfront',
};
export function payModel(family: string | null | undefined): PayModel {
  return PAY_MODEL[family ?? ''] ?? 'upfront';
}
export const PAY_LABEL: Record<PayModel, string> = {
  upfront: 'Paid up front',
  atclose: 'Pay at close',
};

// Deal-stage classification (pipeline stage names vary per FUB account, so match
// by substring). Eric's rule: Under Contract and Closed are treated as the SAME —
// both count as closings (pay-at-close program requirements + untapped GCI).
export type StageClass = 'offer' | 'uc' | 'closed' | 'other';
export function stageClass(stage: string | null | undefined): StageClass {
  const s = (stage ?? '').toLowerCase();
  if (s.includes('close')) return 'closed';
  if (s.includes('contract') || s.includes('pending') || s.includes('escrow')) return 'uc';
  if (s.includes('offer')) return 'offer';
  return 'other';
}
/** Reached offer-or-beyond — the numerator for Offer Rate. */
export function isOfferPlus(c: StageClass): boolean {
  return c === 'offer' || c === 'uc' || c === 'closed';
}
/** A closing under Eric's rule (UC = Closed). */
export function isClosing(c: StageClass): boolean {
  return c === 'uc' || c === 'closed';
}

export interface EventLite {
  type: string | null;
  incoming: boolean | null;
  automated?: boolean | null;
}

/** Outbound contact: an outbound type, not incoming, and not an automated drip. */
export function isOutboundEvent(e: EventLite): boolean {
  const t = (e.type ?? '').trim().toLowerCase();
  return OUTBOUND_TYPES.has(t) && e.incoming !== true && e.automated !== true;
}

export function isStuckStage(stage: string | null | undefined): boolean {
  return STUCK_STAGES.has((stage ?? '').trim().toLowerCase());
}

/** Zillow live-connect: the tag is our proof of contact (the call never logs in FUB). */
export function isZillowConnected(tags: string[]): boolean {
  return tags.some((t) => (t ?? '').toLowerCase().includes(ZILLOW_CONNECTED_TAG));
}

// The "worked" rule (identical to the audit): real effort = 2+ outgoing texts OR
// 1+ call (either direction). A stuck-stage lead is always flagged stuck. A
// Zillow-Connected lead counts as worked (the live connect isn't logged in FUB).
export interface LeadActivity {
  stage: string | null;
  tags: string[];
  outgoingTexts: number;  // non-automated outgoing texts
  calls: number;          // calls, either direction
}

export type LeadFlag = 'stuck' | 'zero_contact' | 'worked';

export function classifyLead(a: LeadActivity): LeadFlag {
  if (isStuckStage(a.stage)) return 'stuck';
  if (isZillowConnected(a.tags)) return 'worked';
  if (a.outgoingTexts >= 2 || a.calls >= 1) return 'worked';
  return 'zero_contact';
}

/**
 * $-at-risk — deliberately conservative and fully disclosed (same as the audit):
 * zero-contact leads × close-rate × avg GCI, annualized from the window.
 * Counts every paid source equally, including pay-at-close — an un-worked
 * referral lead is still lost commission.
 */
export function gciAtRisk(opts: {
  zeroContact: number;
  avgGci: number;
  closeRatePct: number;
  windowDays: number;
}): { window: number; annual: number } {
  const win = opts.zeroContact * (opts.closeRatePct / 100) * opts.avgGci;
  const annual = win * (365 / Math.max(opts.windowDays, 1));
  return { window: win, annual };
}
