import { describe, expect, it } from 'vitest';
import { demoCatalogTitles } from './api';
import type { DeckData } from './deck';
import { parseDeckRoute } from './deckRoute';

async function loadDeck(name: 'zillow-day1' | 'zillow-day2' | 'zillow-day3'): Promise<DeckData> {
  if (name === 'zillow-day1') {
    return import('../../public/decks/zillow-day1.json').then((m) => m.default as DeckData);
  }
  if (name === 'zillow-day2') {
    return import('../../public/decks/zillow-day2.json').then((m) => m.default as DeckData);
  }
  return import('../../public/decks/zillow-day3.json').then((m) => m.default as DeckData);
}

/** FNV-1a + length. Stable without node:crypto so tsc (vite/client types only) still passes. */
function htmlHash(html: string): string {
  let h = 2166136261;
  for (let i = 0; i < html.length; i++) {
    h ^= html.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${html.length}`;
}

// Labels + HTML hashes of Day 1 slides 1–17 on origin/main @ b58d7bb.
const ORIGIN_MAIN_DAY1_SLIDES_1_TO_17 = [
  { n: 1, label: 'Title', hash: 'a7f82d37:3004' },
  { n: 2, label: 'Two things', hash: 'edffaac4:3644' },
  { n: 3, label: 'Four days', hash: '22cc5141:4608' },
  { n: 4, label: 'How a lead reaches you', hash: '601d4e19:4340' },
  { n: 5, label: 'People', hash: '1529cf12:4454' },
  { n: 6, label: 'Demo find the lead', hash: '71445539:5016' },
  { n: 7, label: 'Four questions', hash: '1161496e:3219' },
  { n: 8, label: 'Details panel', hash: '092223eb:3400' },
  { n: 9, label: 'Context not story', hash: '277caf46:4209' },
  { n: 10, label: 'Stage truth', hash: 'fb37832c:7290' },
  { n: 11, label: 'Your turn stages', hash: '133f9152:4304' },
  { n: 12, label: 'The answers', hash: 'dacf7c04:4534' },
  { n: 13, label: 'Notes', hash: '44eec71e:4761' },
  { n: 14, label: 'Tasks', hash: '3f159e55:4731' },
  { n: 15, label: 'Repair Avery', hash: 'f08b1f1a:5281' },
  { n: 16, label: 'Four checks', hash: 'b4fdf5b0:4441' },
  { n: 17, label: 'Way back tomorrow', hash: '79013091:3255' },
] as const;

describe('Zillow Preferred deck files on main', () => {
  it('keeps all three JSON decks: day1 18 slides, day2 and day3 31', async () => {
    const day1 = await loadDeck('zillow-day1');
    const day2 = await loadDeck('zillow-day2');
    const day3 = await loadDeck('zillow-day3');

    expect(day1.slides).toHaveLength(18);
    expect(day2.slides).toHaveLength(31);
    expect(day3.slides).toHaveLength(31);
    expect(day1.slides.map((s) => s.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(day2.slides.map((s) => s.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(day3.slides.map((s) => s.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it('uses the existing #/deck/:name/:n player for all three decks', () => {
    expect(parseDeckRoute('#/deck/zillow-day1/1')).toEqual({ deck: 'zillow-day1', n: 1 });
    expect(parseDeckRoute('#/deck/zillow-day1/18')).toEqual({ deck: 'zillow-day1', n: 18 });
    expect(parseDeckRoute('#/deck/zillow-day2/1')).toEqual({ deck: 'zillow-day2', n: 1 });
    expect(parseDeckRoute('#/deck/zillow-day2/31')).toEqual({ deck: 'zillow-day2', n: 31 });
    expect(parseDeckRoute('#/deck/zillow-day3/1')).toEqual({ deck: 'zillow-day3', n: 1 });
    expect(parseDeckRoute('#/deck/zillow-day3/31')).toEqual({ deck: 'zillow-day3', n: 31 });
  });

  it('does not bring July modules back into the demo catalog', () => {
    const titles = demoCatalogTitles();
    expect(titles).not.toContain('Welcome to Preferred');
    expect(titles).not.toContain('The ALMS Call Framework');
    expect(titles).not.toContain('The TRU Way: Speed to Lead');
    expect(titles).not.toContain('Working a Paid Lead End to End');
    expect(titles).not.toContain('Follow-Up Discipline & the CRM');
    expect(titles).not.toContain('Official Training');
  });

  it('replaces Day 1 slide 18 homework with a Follow Up Boss closer', async () => {
    const day1 = await loadDeck('zillow-day1');
    const close = day1.slides[17];
    expect(close.n).toBe(18);
    expect(close.label).toBe('Close');

    const text = `${close.notes}\n${close.html}`;
    expect(text).not.toMatch(/homework/i);
    expect(text).not.toMatch(/Avery/i);
    expect(text).not.toMatch(/initials/i);
    expect(text).not.toMatch(/instructor/i);

    expect(text).toContain('Follow Up Boss');
    expect(text).toContain('Open People');
    expect(text).toContain('Day 2');
    expect(text).toContain('first conversation');
  });

  it('leaves Day 1 slides 1–17 labels and HTML unchanged vs origin/main', async () => {
    const current = await loadDeck('zillow-day1');

    for (let i = 0; i < 17; i++) {
      const origin = ORIGIN_MAIN_DAY1_SLIDES_1_TO_17[i];
      expect(current.slides[i].n).toBe(origin.n);
      expect(current.slides[i].label).toBe(origin.label);
      expect(htmlHash(current.slides[i].html)).toBe(origin.hash);
    }
  });
});
