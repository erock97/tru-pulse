import { describe, expect, it } from 'vitest';
import {
  WELCOME_PREFERRED_CARDS,
  WELCOME_PREFERRED_QS,
  WELCOME_PREFERRED_SCREEN_COUNT,
  welcomePreferredCopy,
} from './welcomePreferred';

describe('Welcome to Preferred (Module 1)', () => {
  it('keeps the learn-card screen count honest', () => {
    expect(WELCOME_PREFERRED_CARDS).toHaveLength(WELCOME_PREFERRED_SCREEN_COUNT);
    expect(WELCOME_PREFERRED_QS).toHaveLength(7);
  });

  it('opens with a finished intro, not an empty video player', () => {
    const first = WELCOME_PREFERRED_CARDS[0];
    expect(first.t).toBe('intro');
    expect(first.title).toMatch(/welcome from your team leader/i);
    expect(first.body).toBeTruthy();
    expect(WELCOME_PREFERRED_CARDS.filter((c) => c.t === 'video' && !c.url)).toHaveLength(0);
  });

  it('keeps the working Follow Up Boss Loom video', () => {
    const loom = WELCOME_PREFERRED_CARDS.find((c) => c.t === 'video');
    expect(loom?.url).toMatch(/loom\.com\/share\/10e2b74d1e3949a8bdcf96e67b474907/);
  });

  it('uses Preferred (not Flex) for the current program', () => {
    const copy = welcomePreferredCopy();
    expect(copy).not.toMatch(/\bFlex\b/);
    expect(copy).toMatch(/Zillow Preferred/);
    expect(copy).toMatch(/Preferred agent/);
  });
});
