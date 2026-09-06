import { describe, expect, it } from 'vitest';
import { minimumExpectation } from './minimumExpectation';

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
