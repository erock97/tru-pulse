import { describe, expect, it } from 'vitest';
import { BUSINESS } from '../config/business';
import aboutPage from './pages/About.tsx?raw';

const THIRTY_CONSULT = /thirty minutes|30-minute|30 minute|\b30 min\b/i;
const SIXTY_CONSULT = /60 minutes|60-minute/i;

const extraPages = import.meta.glob('./pages/{Home,Services}.tsx', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

describe('public consult CTA duration', () => {
  it('About matches the 60-minute client-consultation-call, not 30', () => {
    expect(aboutPage).toMatch(/60 minutes, your real numbers/);
    expect(aboutPage).not.toMatch(THIRTY_CONSULT);
    expect(aboutPage).toContain('BUSINESS.bookingUrl');
    expect(BUSINESS.bookingUrl).toContain('client-consultation-call');
  });

  it('homepage and services still say 60 when those pages are on this branch', () => {
    // Live truhq.co home and /services already say 60. They are not on main;
    // if they land here later, this keeps them from drifting back to 30.
    for (const src of Object.values(extraPages)) {
      expect(src).toMatch(SIXTY_CONSULT);
      expect(src).not.toMatch(THIRTY_CONSULT);
    }
  });
});
