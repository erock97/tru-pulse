// Every entity-dependent value on the public site lives here and nowhere else.
//
// TRU is the brand and the surviving identity. The legal entity below is the
// OUTGOING one — it is expected to be replaced around August 2026. When the new
// entity is registered: update the fields, set PENDING_ENTITY_CHANGE to false,
// and `npm run build` will verify no stale name survived.
//
// The brand appears everywhere a human reads. The legal entity appears in exactly
// four places, because the contracting party must be named: the footer copyright,
// the privacy policy, the terms of service, and the refund policy.

// The incoming entity, confirmed by Eric on 2026-08-09. NOT yet in use —
// see PENDING_ENTITY_CHANGE at the bottom of this file for the switch-over rule.
export const INCOMING_LEGAL_ENTITY = 'TRU Revenue LLC';

export const BUSINESS = {
  // Public-facing brand is plain "TRU" (confirmed 2026-08-09). "TRU HQ" is the
  // name of the logged-in product at app.truhq.co, not the business.
  brand: 'TRU',
  brandFull: 'TRU',
  tagline: 'The operating system for real estate team leaders',

  legalEntity: 'Terrason Consulting Group',
  legalAddress: ['3008 228th St SE', 'Bothell, WA 98021'],
  contactEmail: 'Admin@terrasonconsulting.com',

  // Locked — stays put through the entity change (confirmed 2026-08-09).
  governingState: 'Washington',
  governingVenue: 'Snohomish County, Washington',

  policiesUpdated: 'August 2026',

  siteUrl: 'https://truhq.co',
  appUrl: 'https://app.truhq.co',
  calendly: 'https://calendly.com/adamt-terrasonconsulting',
} as const;

// True while `legalEntity` still names the outgoing company.
//
// The switch to INCOMING_LEGAL_ENTITY happens when TRU Revenue LLC is registered
// AND is the party actually on the client agreements — not before. The privacy
// policy, terms, and refund policy name whoever a client is contracting with and
// whoever is liable; naming a company that does not yet hold the engagements
// would be wrong in the one place on the site that has to be exactly right.
//
// To switch: set legalEntity to INCOMING_LEGAL_ENTITY, update legalAddress if the
// registered address differs, set this to false, and run `npm run build` — the
// guard fails if any stale value survives.
export const PENDING_ENTITY_CHANGE = true;
