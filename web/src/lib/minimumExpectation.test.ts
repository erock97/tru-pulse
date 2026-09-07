import { describe, expect, it } from 'vitest';
import { minimumExpectation, contractRateLabel } from './minimumExpectation';

describe('minimum conversion expectation', () => {
  it('treats both 1 in 11 and 1 in 16 as exceeding a 1 in 30 minimum', () => {
    expect(minimumExpectation(11, 30)).toBe('Exceeds minimum');
    expect(minimumExpectation(16, 30)).toBe('Exceeds minimum');
  });
  it('distinguishes equality and deterioration without rounding away the boundary', () => {
    expect(minimumExpectation(30, 30)).toBe('At minimum');
    expect(minimumExpectation(30.1, 30)).toBe('Below minimum');
    expect(minimumExpectation(29.9, 30)).toBe('Exceeds minimum');
  });
  it('does not praise an absent outcome ratio', () => {
    expect(minimumExpectation(null, 30)).toBe('Not established');
  });
});

describe('contract rate display', () => {
  it('counts leads even before the first contract, without a grace period', () => {
    for (const leads of [0, 5, 20, 30, 45]) expect(contractRateLabel(null, leads)).toBe(`0 for ${leads}`);
    expect(minimumExpectation(null, 30, 20)).toBe('No contracts yet');
    expect(minimumExpectation(null, 30, 0)).toBe('No leads in this period');
  });
  it('retains the established ratio once there is a contract', () => {
    expect(contractRateLabel(20, 40)).toBe('1 in 20');
    expect(contractRateLabel(30.5, 61)).toBe('1 in 30');
  });
});
