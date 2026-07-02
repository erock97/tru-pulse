import { describe, it, expect } from 'vitest';
import { screenFairHousing, appendDisclosure, runGuardrail } from './guardrail.js';

describe('screenFairHousing — steering/discriminatory language', () => {
  it('flags familial-status steering', () => {
    expect(screenFairHousing('This home is perfect for a family with kids.').ok).toBe(false);
    expect(screenFairHousing('No kids allowed in this quiet building.').ok).toBe(false);
    expect(screenFairHousing('Adults-only community, very peaceful.').ok).toBe(false);
  });
  it('flags religion steering', () => {
    expect(screenFairHousing('Walking distance to church and shops.').ok).toBe(false);
  });
  it('flags the "safe neighborhood" proxy phrase', () => {
    expect(screenFairHousing('Located in a safe neighborhood with good schools.').ok).toBe(false);
  });
  it('flags disability-related exclusionary phrasing', () => {
    expect(screenFairHousing('Not wheelchair accessible, upstairs unit.').ok).toBe(false);
  });
  it('passes clean, property-focused copy', () => {
    const r = screenFairHousing('Just listed: a bright 3-bed with a huge backyard and a brand-new kitchen. Message me for a private tour!');
    expect(r.ok).toBe(true);
    expect(r.flags).toEqual([]);
  });
  it('reports every distinct hit, not just the first', () => {
    const r = screenFairHousing('Perfect for a family, no kids noise though — adults-only vibe on this street.');
    expect(r.flags.length).toBeGreaterThanOrEqual(2);
  });
});

describe('appendDisclosure', () => {
  const brandKit = { brokerageName: 'Costigan Group', licenseNumber: '12345' };
  it('appends the disclosure when missing', () => {
    const { text, appended } = appendDisclosure('Just listed on Maple St!', brandKit);
    expect(appended).toBe(true);
    expect(text).toContain('Costigan Group');
    expect(text).toContain('12345');
  });
  it('does not double-append if the brokerage name is already present', () => {
    const { text, appended } = appendDisclosure('Just listed! — Costigan Group', brandKit);
    expect(appended).toBe(false);
    expect(text).toBe('Just listed! — Costigan Group');
  });
  it('is a no-op with no brand kit configured', () => {
    const { text, appended } = appendDisclosure('Just listed on Maple St!', undefined);
    expect(appended).toBe(false);
    expect(text).toBe('Just listed on Maple St!');
  });
  it('prefers an explicit disclosureText override', () => {
    const { text } = appendDisclosure('Hello', { disclosureText: 'Custom Disclosure LLC' });
    expect(text).toContain('Custom Disclosure LLC');
  });
});

describe('runGuardrail — the combined pre-storage check', () => {
  it('flags steering AND still appends disclosure (advisory, not blocking)', () => {
    const r = runGuardrail('Perfect for a family in a safe neighborhood.', { brokerageName: 'Acme Realty' });
    expect(r.ok).toBe(false);
    expect(r.flags.length).toBeGreaterThan(0);
    expect(r.disclosureAppended).toBe(true);
    expect(r.text).toContain('Acme Realty');
  });
  it('clean copy with no brand kit: ok, no disclosure appended', () => {
    const r = runGuardrail('New listing this weekend — 4 beds, 2 baths, move-in ready.');
    expect(r.ok).toBe(true);
    expect(r.disclosureAppended).toBe(false);
  });
});
