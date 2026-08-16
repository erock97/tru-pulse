import { describe, it, expect } from 'vitest';
import { BUSINESS, PENDING_ENTITY_CHANGE } from './business';

describe('BUSINESS config', () => {
  it('brands the site TRU, not the legal entity', () => {
    expect(BUSINESS.brand).toBe('TRU');
    expect(BUSINESS.siteUrl).toBe('https://truhq.co');
  });

  it('carries every value the legal pages interpolate', () => {
    for (const key of [
      'legalEntity', 'contactEmail', 'governingState', 'governingVenue', 'policiesUpdated',
    ] as const) {
      expect(BUSINESS[key], `${key} must not be empty`).toBeTruthy();
    }
    expect(BUSINESS.legalAddress.length).toBeGreaterThan(0);
  });

  it('locks the governing venue to Snohomish County through the entity change', () => {
    expect(BUSINESS.governingState).toBe('Washington');
    expect(BUSINESS.governingVenue).toBe('Snohomish County, Washington');
  });

  it('flags that the legal entity is still the outgoing one', () => {
    // Flips to false only when the new entity is registered and filled in.
    expect(PENDING_ENTITY_CHANGE).toBe(true);
  });
});
