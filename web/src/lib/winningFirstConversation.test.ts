import { describe, expect, it } from 'vitest';
import { demoCatalogTitles } from './api';
import { deckInjectedCss, deckSlideMarkup, type DeckData } from './deck';
import { parseDeckRoute } from './deckRoute';
import { SHOW_LIKE_A_PRO_TITLE } from './showLikeAPro';
import {
  WINNING_FIRST_CONVERSATION_CARDS,
  WINNING_FIRST_CONVERSATION_TITLE,
  WINNING_FIRST_CONVERSATION_TITLES,
} from './winningFirstConversation';

const OFFICIAL_TRAINING_ID = 'a6666666-6666-6666-6666-666666666666';
const DAY2_ID = 'a8888888-8888-8888-8888-888888888888';
const DAY3_ID = 'a7777777-7777-7777-7777-777777777777';
const TRACK_ID = 'b2222222-2222-2222-2222-222222222222';

const TITLES = [
  'The first conversation.',
  'Before anything else — a question for the room.',
  'They are asking one question.',
  'Quick round — the worst sales call you have ever gotten.',
  'The fastest way to lose an online lead.',
  'Advocate, not gatekeeper.',
  'Before you dial — ten minutes.',
  'The whole call is about five minutes.',
  'Before we go on — when do you ask for the appointment?',
  'Four beats. That is the whole call.',
  'Lead with who you are.',
  'Extend the invitation.',
  'Ask and listen.',
  'Quick one — would you stay in that store?',
  'What you do not ask on a first call.',
  'Deliver the summary.',
  'What they actually say.',
  'Six moves. The fourth one is the whole thing.',
  'Then bring them back at the end.',
  'When the home is already under contract.',
  'Now you talk.',
  'Drill 1 — the introduction.',
  'Drill 2 — the appointment ask.',
  'Drill 3 — parking the questions.',
  'Now the whole call, start to finish.',
  'Back together — what happened?',
  'Most of them will not pick up.',
  'Then text them.',
  'How many times do you follow up before you stop?',
  'The first seven days do the work.',
  'Your own words, not mine.',
];

type SlideCard = { t: string; deck?: string; slide?: number; title?: string };

type Day2Seed = {
  MODULE_ID: string;
  TRACK_ID: string;
  TITLE: string;
  TITLES: string[];
  CARDS: SlideCard[];
  QUESTIONS: Array<{ prompt: string; choices: string[]; answer: number; explain: string }>;
  MODULE: {
    id: string; title: string; kind: string; status: string; active: boolean;
    source: string; org_id: null; tags: string[]; summary: string;
  };
  TRACK_LINK: { track_id: string; module_id: string; idx: number; required: boolean };
};

async function loadSeed(): Promise<Day2Seed> {
  // Seed is a plain .mjs (Day 3 pattern). tsc does not include ../db.
  // @ts-expect-error runtime import of the seed file
  return import('../../../db/rep_zillow_day2.mjs');
}

async function loadDeck(): Promise<DeckData> {
  return import('../../public/decks/zillow-day2.json').then((m) => m.default as DeckData);
}

describe('Winning the First Conversation (Day 2)', () => {
  it('keeps the title exact and seeds 31 zillow-day2 slides only', async () => {
    const seed = await loadSeed();
    expect(seed.TITLE).toBe('Winning the First Conversation');
    expect(seed.MODULE.title).toBe('Winning the First Conversation');
    expect(seed.MODULE_ID).toBe(DAY2_ID);
    expect(seed.TITLES).toEqual(TITLES);
    expect(seed.CARDS).toHaveLength(31);
    expect(seed.CARDS.every((c) => c.t === 'slide' && c.deck === 'zillow-day2')).toBe(true);
    expect(seed.CARDS.map((c) => c.slide)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(seed.CARDS.map((c) => c.title)).toEqual(TITLES);
    expect(seed.CARDS.some((c) => c.t === 'practice' || c.t === 'lab' || c.t === 'dealslide')).toBe(false);
    expect(seed.QUESTIONS).toHaveLength(10);
    expect(seed.MODULE.kind).toBe('lesson');
    expect(seed.MODULE.status).toBe('published');
    expect(seed.MODULE.active).toBe(true);
    expect(seed.MODULE.source).toBe('system');
    expect(seed.MODULE.org_id).toBeNull();
    expect(seed.MODULE.tags).toEqual(['zillow', 'day-2', 'conversation', 'official']);
    expect(seed.TRACK_LINK).toEqual({
      track_id: TRACK_ID,
      module_id: DAY2_ID,
      idx: 2,
      required: true,
    });
    expect(seed.MODULE_ID).not.toBe(DAY3_ID);
  });

  it('does not modify Official Training / a6666 and is not a July rename', async () => {
    const seed = await loadSeed();
    expect(seed.MODULE_ID).not.toBe(OFFICIAL_TRAINING_ID);
    expect(seed.MODULE.title).not.toMatch(/Official Training/i);
    expect(seed.TITLE).toBe('Winning the First Conversation');
    expect(seed.TITLE).not.toMatch(/ALMS|Welcome to Preferred|Speed to Lead/i);
  });

  it('has a 31-slide deck JSON and css with the four keyframes', async () => {
    const deck = await loadDeck();
    expect(deck.slides).toHaveLength(31);
    expect(deck.slides.map((s) => s.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(deck.slides.map((s) => s.label)).toEqual(TITLES);

    expect(deckInjectedCss({})).toBeNull();
    expect(deck.css).toBeTruthy();
    for (const name of ['riseIn', 'fadeIn', 'wipeIn', 'kenburns']) {
      expect(deck.css).toContain(`@keyframes ${name}`);
    }
    const first = deckSlideMarkup(deck.css, deck.slides[0].html);
    expect(first.startsWith('<style>')).toBe(true);
    expect(first).toContain(deck.slides[0].html);
  });

  it('parses #/deck/zillow-day2/1 and lands on The first conversation.', () => {
    expect(parseDeckRoute('/deck/zillow-day2/1')).toEqual({ deck: 'zillow-day2', n: 1 });
    expect(parseDeckRoute('#/deck/zillow-day2/1')).toEqual({ deck: 'zillow-day2', n: 1 });
    expect(parseDeckRoute('/deck/zillow-day2')).toEqual({ deck: 'zillow-day2', n: 1 });
    expect(parseDeckRoute('/deck/zillow-day2/31')).toEqual({ deck: 'zillow-day2', n: 31 });
    expect(parseDeckRoute('/learn')).toBeNull();
    expect(WINNING_FIRST_CONVERSATION_TITLES[0]).toBe('The first conversation.');
    expect(WINNING_FIRST_CONVERSATION_CARDS[0]).toEqual({
      t: 'slide', deck: 'zillow-day2', slide: 1, title: 'The first conversation.',
    });
  });

  it('puts Winning the First Conversation and Show Like a Pro in the demo catalog', () => {
    const titles = demoCatalogTitles();
    expect(titles).toContain(WINNING_FIRST_CONVERSATION_TITLE);
    expect(titles).toContain(SHOW_LIKE_A_PRO_TITLE);
    expect(titles).not.toContain('Welcome to Preferred');
    expect(titles).not.toContain('The ALMS Call Framework');
    expect(titles).not.toContain('The TRU Way: Speed to Lead');
    expect(titles).not.toContain('Working a Paid Lead End to End');
    expect(titles).not.toContain('Follow-Up Discipline & the CRM');
    expect(WINNING_FIRST_CONVERSATION_CARDS).toHaveLength(31);
    expect(WINNING_FIRST_CONVERSATION_CARDS.every((c) => c.t === 'slide' && c.deck === 'zillow-day2')).toBe(true);
  });

  it('asks ten questions from these slides only — LEAD, appointment, park, seven days, note+task', async () => {
    const seed = await loadSeed();
    const blob = seed.QUESTIONS.map((q) => `${q.prompt} ${q.choices.join(' ')} ${q.explain}`).join('\n');
    expect(blob).toMatch(/LEAD/i);
    expect(blob).toMatch(/appointment/i);
    expect(blob).toMatch(/park/i);
    expect(blob).toMatch(/seven days|first week|5–7|5-7/i);
    expect(blob).toMatch(/note/i);
    expect(blob).toMatch(/dated task/i);
    expect(blob).not.toMatch(/Follow Up Boss|\bFUB\b|ALMS|touring agreement/i);
  });
});
