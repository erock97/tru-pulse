import { describe, expect, it } from 'vitest';
import { minimumExpectation, contractRateLabel, belowMinimum, contractSortValue } from './minimumExpectation';

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
    expect(contractRateLabel(30.5, 61)).toBe('1 in 30.5');
    expect(contractRateLabel(7.75,31)).toBe('1 in 7.75');
    expect(contractRateLabel(52/6,52)).toBe('≈ 1 in 8.67');
  });
});

it('distinguishes a zero-contract agent from an empty or missing cohort',()=>{expect(belowMinimum(null,30,5)).toBe(true);expect(belowMinimum(null,30,30)).toBe(true);expect(belowMinimum(null,30,0)).toBe(false);expect(belowMinimum(30,30,30)).toBe(false);expect(belowMinimum(30.01,30,3001)).toBe(true);});

it('ranks zero contracts as a known weak rate while keeping empty cohorts unranked',()=>{expect(contractSortValue({leads:15,perContract:null})).toBe(Infinity);expect(contractSortValue({leads:0,perContract:null})).toBeNull();expect(contractSortValue(undefined)).toBeNull();expect(contractSortValue({leads:61,perContract:30.5})).toBe(30.5);});
