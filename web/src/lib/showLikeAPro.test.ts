import { describe, expect, it } from 'vitest';
import { demoCatalogTitles } from './api';
import { deckInjectedCss, deckSlideMarkup, type DeckData } from './deck';
import { parseDeckRoute } from './deckRoute';
import { SHOW_LIKE_A_PRO_CARDS, SHOW_LIKE_A_PRO_TITLE, SHOW_LIKE_A_PRO_TITLES } from './showLikeAPro';

const OFFICIAL_TRAINING_ID = 'a6666666-6666-6666-6666-666666666666';
const DAY3_ID = 'a7777777-7777-7777-7777-777777777777';
const TRACK_ID = 'b2222222-2222-2222-2222-222222222222';

const TITLES = [
  'The showing.',
  'Before anything else — a question for the room.',
  'Before you go.',
  'The touring agreement goes out before you go.',
  'Show two or three. Never one.',
  'Inside the house.',
  'You opened the door. Now get out of the way.',
  'Available, not attached.',
  'The trap is your own taste.',
  'Say the real thing. Skip the rest.',
  'The sidewalk.',
  'One more before we go outside.',
  'Here is what most agents say.',
  'Instead: five questions, in order.',
  "One — did you see one you'd write on?",
  'Two — rate it, one to ten.',
  'Three — what would make it an eight?',
  'Four — cash under the bed, or a lender?',
  'Five — is that date a guess, or a deadline?',
  'Look at what you have, and what you never asked.',
  'Now the answer changes what you do.',
  'Work the date backwards, out loud, with them.',
  'Leave with an appointment. Not an intention.',
  'Now you say it.',
  'Drill one — the open, and the rating.',
  'Drill two — the timeline, and the permission line.',
  'Now the whole thing, start to finish.',
  'Back together — what happened out there?',
  'Before you drive away — three things.',
  'Before Day 4 — one written exercise.',
  'The houses were the easy part.',
];

type SlideCard = { t: string; deck?: string; slide?: number; title?: string };

type Day3Seed = {
  MODULE_ID: string;
  TRACK_ID: string;
  TITLE: string;
  TITLES: string[];
  CARDS: SlideCard[];
  QUESTIONS: unknown[];
  MODULE: {
    id: string; title: string; kind: string; status: string; active: boolean;
    source: string; org_id: null; tags: string[];
  };
  TRACK_LINK: { track_id: string; module_id: string; idx: number; required: boolean };
};

async function loadSeed(): Promise<Day3Seed> {
  // Seed is a plain .mjs (Day 1 pattern). tsc does not include ../db.
  // @ts-expect-error runtime import of the seed file
  return import('../../../db/rep_zillow_day3.mjs');
}

async function loadDeck(): Promise<DeckData> {
  return import('../../public/decks/zillow-day3.json').then((m) => m.default as DeckData);
}

describe('Show Like a Pro (Day 3)', () => {
  it('keeps the title exact and seeds 31 zillow-day3 slides only', async () => {
    const seed = await loadSeed();
    expect(seed.TITLE).toBe('Show Like a Pro');
    expect(seed.MODULE.title).toBe('Show Like a Pro');
    expect(seed.MODULE_ID).toBe(DAY3_ID);
    expect(seed.TITLES).toEqual(TITLES);
    expect(seed.CARDS).toHaveLength(31);
    expect(seed.CARDS.every((c) => c.t === 'slide' && c.deck === 'zillow-day3')).toBe(true);
    expect(seed.CARDS.map((c) => c.slide)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(seed.CARDS.map((c) => c.title)).toEqual(TITLES);
    expect(seed.CARDS.some((c) => c.t === 'practice' || c.t === 'lab' || c.t === 'dealslide')).toBe(false);
    expect(seed.QUESTIONS).toHaveLength(10);
    expect(seed.MODULE.kind).toBe('lesson');
    expect(seed.MODULE.status).toBe('published');
    expect(seed.MODULE.active).toBe(true);
    expect(seed.MODULE.source).toBe('system');
    expect(seed.MODULE.org_id).toBeNull();
    expect(seed.MODULE.tags).toEqual(['zillow', 'day-3', 'showing', 'official']);
    expect(seed.TRACK_LINK).toEqual({
      track_id: TRACK_ID,
      module_id: DAY3_ID,
      idx: 3,
      required: true,
    });
  });

  it('does not modify Official Training / a6666', async () => {
    const seed = await loadSeed();
    expect(seed.MODULE_ID).not.toBe(OFFICIAL_TRAINING_ID);
    expect(seed.MODULE.title).not.toMatch(/Official Training/i);
    expect(seed.TITLE).toBe('Show Like a Pro');
  });

  it('has a 31-slide deck JSON and injects optional css without requiring it', async () => {
    const deck = await loadDeck();
    expect(deck.slides).toHaveLength(31);
    expect(deck.slides.map((s) => s.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(deck.slides.map((s) => s.label)).toEqual(TITLES);

    // Day 1 decks have no css field. The player must not require one.
    expect(deckInjectedCss({})).toBeNull();
    expect(deckInjectedCss({ css: undefined })).toBeNull();
    expect(deckSlideMarkup(undefined, '<section>hi</section>')).toBe('<section>hi</section>');
    const sample = '@keyframes riseIn{} @keyframes fadeIn{} @keyframes wipeIn{} @keyframes kenburns{}';
    expect(deckInjectedCss({ css: sample })).toBe(sample);
    expect(deckSlideMarkup(sample, '<section>hi</section>')).toBe(`<style>${sample}</style><section>hi</section>`);

    expect(deck.css).toBeTruthy();
    for (const name of ['riseIn', 'fadeIn', 'wipeIn', 'kenburns']) {
      expect(deck.css).toContain(name);
    }
    expect(deck.css).toContain('.deck-scale');
    expect(deck.css).toContain('data-deck-active');
    const first = deckSlideMarkup(deck.css, deck.slides[0].html);
    expect(first.startsWith('<style>')).toBe(true);
    expect(first).toContain(deck.slides[0].html);
  });

  it('parses #/deck/zillow-day3/1 and lands on The showing.', () => {
    expect(parseDeckRoute('/deck/zillow-day3/1')).toEqual({ deck: 'zillow-day3', n: 1 });
    expect(parseDeckRoute('#/deck/zillow-day3/1')).toEqual({ deck: 'zillow-day3', n: 1 });
    expect(parseDeckRoute('/deck/zillow-day3')).toEqual({ deck: 'zillow-day3', n: 1 });
    expect(parseDeckRoute('/deck/zillow-day3/31')).toEqual({ deck: 'zillow-day3', n: 31 });
    expect(parseDeckRoute('/learn')).toBeNull();
    expect(SHOW_LIKE_A_PRO_TITLES[0]).toBe('The showing.');
    expect(SHOW_LIKE_A_PRO_CARDS[0]).toEqual({
      t: 'slide', deck: 'zillow-day3', slide: 1, title: 'The showing.',
    });
  });

  it('puts only Show Like a Pro in the demo catalog', () => {
    const titles = demoCatalogTitles();
    expect(titles).toEqual([SHOW_LIKE_A_PRO_TITLE]);
    expect(titles).not.toContain('Welcome to Preferred');
    expect(titles).not.toContain('The ALMS Call Framework');
    expect(titles).not.toContain('The TRU Way: Speed to Lead');
    expect(titles).not.toContain('Working a Paid Lead End to End');
    expect(titles).not.toContain('Follow-Up Discipline & the CRM');
    expect(SHOW_LIKE_A_PRO_CARDS).toHaveLength(31);
    expect(SHOW_LIKE_A_PRO_CARDS.every((c) => c.t === 'slide' && c.deck === 'zillow-day3')).toBe(true);
  });
});
