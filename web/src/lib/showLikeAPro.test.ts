import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deckInjectedCss, type DeckData } from './deck';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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

async function loadSeed() {
  return import(pathToFileURL(resolve(root, 'db/rep_zillow_day3.mjs')).href) as Promise<{
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
  }>;
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
    const seedSrc = readFileSync(resolve(root, 'db/rep_zillow_day3.mjs'), 'utf8');
    const curriculum = readFileSync(resolve(root, 'db/rep_curriculum.mjs'), 'utf8');
    expect(seed.MODULE_ID).not.toBe(OFFICIAL_TRAINING_ID);
    expect(seedSrc).not.toContain(OFFICIAL_TRAINING_ID);
    expect(existsSync(resolve(root, 'db/rep_zillow_day1.mjs'))).toBe(false);
    expect(curriculum).toContain("title: 'Welcome to Preferred'");
    expect(curriculum).not.toContain('Official Training');
    expect(curriculum).not.toContain(OFFICIAL_TRAINING_ID);
  });

  it('has a 31-slide deck JSON and injects optional css without requiring it', () => {
    const deck = JSON.parse(
      readFileSync(resolve(root, 'web/public/decks/zillow-day3.json'), 'utf8'),
    ) as DeckData;
    expect(deck.slides).toHaveLength(31);
    expect(deck.slides.map((s) => s.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(deck.slides.map((s) => s.label)).toEqual(TITLES);

    // Day 1 decks have no css field. The player must not require one.
    expect(deckInjectedCss({})).toBeNull();
    expect(deckInjectedCss({ css: undefined })).toBeNull();
    const sample = '@keyframes riseIn{} @keyframes fadeIn{} @keyframes wipeIn{} @keyframes kenburns{}';
    expect(deckInjectedCss({ css: sample })).toBe(sample);

    if (deck.css) {
      for (const name of ['riseIn', 'fadeIn', 'wipeIn', 'kenburns']) {
        expect(deck.css).toContain(name);
      }
    }
  });
});
