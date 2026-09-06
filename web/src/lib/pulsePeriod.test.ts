import { describe, expect, it } from 'vitest';
import { inPulsePeriod, pulseCutoff } from './pulsePeriod';
describe('Pulse calendar periods', () => {
  const now = new Date(2026, 8, 5, 12);
  it('starts month to date at local midnight on the first, not 30 days ago', () => {
    expect(pulseCutoff('mtd', now)).toBe(new Date(2026, 8, 1).getTime());
    expect(inPulsePeriod(new Date(2026, 7, 31, 23, 59).toISOString(), 'mtd', now)).toBe(false);
    expect(inPulsePeriod(new Date(2026, 8, 1).toISOString(), 'mtd', now)).toBe(true);
  });
  it('includes current month and five prior calendar months', () => {
    expect(pulseCutoff('6mo', now)).toBe(new Date(2026, 3, 1).getTime());
    expect(pulseCutoff('6mo', new Date(2026, 0, 31))).toBe(new Date(2025, 7, 1).getTime());
  });
  it('excludes invalid and future dates', () => {
    expect(inPulsePeriod(null, 'mtd', now)).toBe(false);
    expect(inPulsePeriod('invalid', 'mtd', now)).toBe(false);
    expect(inPulsePeriod(new Date(2026, 8, 6).toISOString(), 'mtd', now)).toBe(false);
  });
  it('uses two calendar years, including a leap day, and excludes older leads', () => {
    const leapWindow = new Date(2025, 0, 1, 12);
    expect(pulseCutoff('2yr', leapWindow)).toBe(new Date(2023, 0, 1).getTime());
    expect(inPulsePeriod(new Date(2022, 11, 31, 23, 59).toISOString(), '2yr', leapWindow)).toBe(false);
    expect(inPulsePeriod(new Date(2023, 0, 1).toISOString(), '2yr', leapWindow)).toBe(true);
  });
});
