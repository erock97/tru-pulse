import { describe, it, expect } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  it('gives every common FUB shape the same dashes', () => {
    expect(formatPhone('5552048817')).toBe('555-204-8817');
    expect(formatPhone('(555) 204-8817')).toBe('555-204-8817');
    expect(formatPhone('555.204.8817')).toBe('555-204-8817');
    expect(formatPhone('+1 555 204 8817')).toBe('555-204-8817');
    expect(formatPhone('15552048817')).toBe('555-204-8817');
  });
  it('leaves anything that is not a plain US number untouched', () => {
    expect(formatPhone('555-2048')).toBe('555-2048');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone('  ')).toBeNull();
  });
});
