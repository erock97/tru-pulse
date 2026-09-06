import { describe, expect, it } from 'vitest';
import { earningsFields, reviewEarnings, earnings, csvCell, type EarningsField } from './earningsImport';

const mapping = Object.fromEntries(earningsFields.map(k => [k, k])) as Record<EarningsField, string>;
const header = earningsFields.join(',');
describe('closing statement review', () => {
  it('deducts referral fees before the brokerage split and keeps missing expenses unknown', () => {
    const result = reviewEarnings(header+'\nA,Test Agent,2026-08-31,10000,2500,20,,Zillow', mapping, '');
    expect(result.errors).toEqual([]);
    expect(earnings(result.rows[0])).toEqual({retained:1500, contribution:null});
  });
  it('applies the default share only when absent, and includes explicitly entered expenses', () => {
    const result = reviewEarnings(header+'\nA,Test Agent,2026-08-31,10000,0,,200,Zillow', mapping, '25');
    expect(result.errors).toEqual([]);
    expect(earnings(result.rows[0])).toEqual({retained:2500, contribution:2300});
  });
  it('flags duplicated deals and impossible dates for correction before acceptance', () => {
    const result = reviewEarnings(header+'\nA,Test Agent,2026-08-31,10000,0,20,0,Zillow\nA,Test Agent,2026-08-31,10000,0,20,0,Zillow\nB,Test Agent,2026-02-30,10000,0,20,0,Zillow', mapping, '');
    expect(result.errors).toHaveLength(2);
  });
  it('exports spreadsheet formula-like names as text', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
  });
});
