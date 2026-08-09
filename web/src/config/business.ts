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

export const BUSINESS = {
  brand: 'TRU',
  brandFull: 'TRU HQ',
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

// True while `legalEntity` still names the outgoing company. The build guard
// refuses to ship a stale name once this is false.
export const PENDING_ENTITY_CHANGE = true;
