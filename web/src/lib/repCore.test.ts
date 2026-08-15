import { describe, it, expect } from 'vitest';
import { isCoreModule } from './repCore';

describe('isCoreModule', () => {
  it('treats missing and true as core so existing curriculum stays on the badge', () => {
    expect(isCoreModule({})).toBe(true);
    expect(isCoreModule({ core: true })).toBe(true);
    expect(isCoreModule({ core: null })).toBe(true);
  });

  it('keeps explicit library rows off the certification ring', () => {
    expect(isCoreModule({ core: false })).toBe(false);
  });
});
