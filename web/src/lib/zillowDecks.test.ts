import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function loadOriginDeck(name: 'zillow-day1' | 'zillow-day2' | 'zillow-day3'): DeckData {
  const raw = execFileSync('git', ['show', `origin/main:web/public/decks/${name}.json`], {
    encoding: 'utf8',
  });
  return JSON.parse(raw) as DeckData;
}

function htmlHash(html: string): string {
  return createHash('sha256').update(html).digest('hex');
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
    const origin = loadOriginDeck('zillow-day1');

    for (let i = 0; i < 17; i++) {
      expect(current.slides[i].n).toBe(origin.slides[i].n);
      expect(current.slides[i].label).toBe(origin.slides[i].label);
      expect(htmlHash(current.slides[i].html)).toBe(htmlHash(origin.slides[i].html));
    }
  });

  it('does not change Day 2 or Day 3 JSON vs origin/main', async () => {
    const day2 = await loadDeck('zillow-day2');
    const day3 = await loadDeck('zillow-day3');
    expect(day2).toEqual(loadOriginDeck('zillow-day2'));
    expect(day3).toEqual(loadOriginDeck('zillow-day3'));
  });
});
