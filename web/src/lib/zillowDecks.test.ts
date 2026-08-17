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
});
