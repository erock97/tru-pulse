import { describe, it, expect } from 'vitest';
import {
  applyLessonNav,
  clampIndex,
  createNavGesture,
  findDeckSlide,
  resolveDeckSlideNo,
  type LessonNavState,
} from './lessonNav';

/**
 * The live Day 1 module: 18 deck slides + 5 record exercises + 1 deals slide
 * = 24 steps. Titles match the in-app sidebar so the reported skips can be
 * named, not just numbered. No teaching body — this is the step list only.
 */
const DAY1: Array<{ t: string; slide?: number; title?: string; scenario?: string }> = [
  { t: 'slide', slide: 1, title: 'Title' },
  { t: 'slide', slide: 2, title: 'Two things' },
  { t: 'slide', slide: 3, title: 'Four days' },
  { t: 'slide', slide: 4, title: 'How a lead reaches you' },
  { t: 'slide', slide: 5, title: 'People' },
  { t: 'slide', slide: 6, title: 'Demo find the lead' },
  { t: 'slide', slide: 7, title: 'Four questions' },
  { t: 'slide', slide: 8, title: 'Details panel' },
  { t: 'slide', slide: 9, title: 'Context not story' },
  { t: 'slide', slide: 10, title: 'Stage truth' },
  { t: 'slide', slide: 11, title: 'Your turn stages' },
  { t: 'slide', slide: 12, title: 'The answers' },
  { t: 'practice', scenario: 'set-appointment' },
  { t: 'slide', slide: 13, title: 'Notes' },
  { t: 'practice', scenario: 'spoke-note' },
  { t: 'slide', slide: 14, title: 'Tasks' },
  { t: 'practice', scenario: 'noanswer-task' },
  { t: 'slide', slide: 15, title: 'Repair Avery' },
  { t: 'practice', scenario: 'avery-repair' },
  { t: 'slide', slide: 16, title: 'Four checks' },
  { t: 'dealslide' },
  { t: 'practice', scenario: 'offer-accepted' },
  { t: 'slide', slide: 17, title: 'Way back tomorrow' },
  { t: 'slide', slide: 18, title: 'Close' },
];

const LEN = DAY1.length;

function start(): LessonNavState {
  return { index: 0, seen: 0 };
}

function at(index: number, seen = index): LessonNavState {
  return { index, seen };
}

function titleAt(index: number): string {
  const c = DAY1[index];
  return c.title ?? c.scenario ?? c.t;
}

describe('Day 1 is a 24-step mixed list', () => {
  it('has 18 deck slides plus 6 interactive steps', () => {
    expect(LEN).toBe(24);
    expect(DAY1.filter((c) => c.t === 'slide').length).toBe(18);
    expect(DAY1.filter((c) => c.t === 'practice' || c.t === 'dealslide').length).toBe(6);
  });

  it('keeps Notes at step 14 / deck slide 13 — the header/footer drift', () => {
    // Viewer counter is 1-based index into the 24-step list. The HTML footer
    // is baked into the 18-slide JSON (13 on Notes). Same root cause as the
    // nav bugs only in the sense that the two numbers are different lists.
    expect(titleAt(13)).toBe('Notes');
    expect(DAY1[13].slide).toBe(13);
    expect(13 + 1).toBe(14);
  });
});

describe('Next and Back move exactly one step', () => {
  it('walks 0 → 23 one index at a time, never skipping a card', () => {
    let s = start();
    const seen: string[] = [titleAt(s.index)];
    for (let n = 0; n < LEN - 1; n++) {
      const next = applyLessonNav(s, { type: 'next' }, LEN);
      expect(next.index).toBe(s.index + 1);
      seen.push(titleAt(next.index));
      s = next;
    }
    expect(seen).toEqual(DAY1.map((_, i) => titleAt(i)));
    expect(s.index).toBe(23);
    expect(titleAt(s.index)).toBe('Close');
  });

  it('Next from slide 3 lands on slide 4, not 5', () => {
    const s = applyLessonNav(at(2), { type: 'next' }, LEN);
    expect(titleAt(2)).toBe('Four days');
    expect(s.index).toBe(3);
    expect(titleAt(s.index)).toBe('How a lead reaches you');
    expect(titleAt(s.index)).not.toBe('People');
  });

  it('Next from slide 9 lands on Stage truth, not slide 11', () => {
    const s = applyLessonNav(at(8), { type: 'next' }, LEN);
    expect(titleAt(8)).toBe('Context not story');
    expect(s.index).toBe(9);
    expect(titleAt(s.index)).toBe('Stage truth');
    expect(titleAt(s.index)).not.toBe('Your turn stages');
  });

  it('Next from slide 11 lands on The answers, not back at slide 6', () => {
    const s = applyLessonNav(at(10), { type: 'next' }, LEN);
    expect(titleAt(10)).toBe('Your turn stages');
    expect(s.index).toBe(11);
    expect(titleAt(s.index)).toBe('The answers');
    expect(titleAt(s.index)).not.toBe('Demo find the lead');
  });

  it('Back from Stage truth lands on Context not story, not slide 2', () => {
    const s = applyLessonNav(at(9, 9), { type: 'back' }, LEN);
    expect(titleAt(9)).toBe('Stage truth');
    expect(s.index).toBe(8);
    expect(titleAt(s.index)).toBe('Context not story');
    expect(titleAt(s.index)).not.toBe('Two things');
  });

  it('does not treat a deck slide number as a list index', () => {
    // Discarded hypothesis: using the 1-based deck number as the next index.
    // From "Four days" (deck 3) that lands on index 4 ("People") and skips
    // "How a lead reaches you". The viewer must increment the mixed-list index.
    const fromDeck3 = at(2);
    const slideNo = DAY1[fromDeck3.index].slide ?? 0;
    expect(titleAt(slideNo + 1)).toBe('People');
    const right = applyLessonNav(fromDeck3, { type: 'next' }, LEN);
    expect(titleAt(right.index)).toBe('How a lead reaches you');
  });
});

describe('completion / seen', () => {
  it('Next only raises seen — it never wipes earlier checkmarks', () => {
    let s = start();
    s = applyLessonNav(s, { type: 'next' }, LEN);
    s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.seen).toBe(2);
    s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.seen).toBe(3);
    expect(s.index).toBe(3);
  });

  it('Back from a later step re-locks only what is after the new position', () => {
    const s = applyLessonNav(at(9, 9), { type: 'back' }, LEN);
    expect(s.index).toBe(8);
    expect(s.seen).toBe(8);
    expect(s.seen).not.toBe(0);
    expect(s.seen).not.toBe(1);
  });

  it('a sidebar jump backward is an intentional back and re-locks later items', () => {
    const s = applyLessonNav(at(9, 9), { type: 'goto', index: 1 }, LEN);
    expect(s.index).toBe(1);
    expect(s.seen).toBe(1);
  });

  it('a sidebar jump cannot target a step the learner has not reached', () => {
    const s = applyLessonNav(at(2, 2), { type: 'goto', index: 10 }, LEN);
    expect(s.index).toBe(2);
    expect(s.seen).toBe(2);
  });
});

describe('clampIndex', () => {
  it('stays inside the list', () => {
    expect(clampIndex(-1, 24)).toBe(0);
    expect(clampIndex(24, 24)).toBe(23);
    expect(clampIndex(11, 24)).toBe(11);
    expect(clampIndex(0, 0)).toBe(0);
  });
});

describe('createNavGesture', () => {
  it('one gesture applies exactly one Next — a burst does not walk the deck', () => {
    const g = createNavGesture();
    let s = start();
    // Live bug: one Next from slide 1 jumped to 11/24 (~10 activations).
    for (let n = 0; n < 10; n++) {
      if (g.start()) s = applyLessonNav(s, { type: 'next' }, LEN);
    }
    expect(s.index).toBe(1);
    expect(titleAt(s.index)).toBe('Two things');
  });

  it('does not re-arm on finish — only after the pointer stayed up', () => {
    const g = createNavGesture();
    expect(g.start()).toBe(true);
    expect(g.start()).toBe(false);
    g.finish();
    // Remount fires pointerup (finish) then pointerdown on the new Next.
    expect(g.start()).toBe(false);
    g.releaseClicks();
    expect(g.start()).toBe(true);
  });

  it('ignores key repeat so a held Space/Enter cannot auto-advance', () => {
    const g = createNavGesture();
    expect(g.start()).toBe(true);
    g.finish();
    expect(g.start({ repeat: true })).toBe(false);
    g.releaseClicks();
    expect(g.start()).toBe(true);
  });

  it('a leftover click after a pointer Next cannot take another step', () => {
    const g = createNavGesture();
    let s = start();
    expect(g.start({ from: 'pointer' })).toBe(true);
    s = applyLessonNav(s, { type: 'next' }, LEN);
    g.finish();
    // pointerup already happened; the remounted Next still receives click
    expect(g.start({ from: 'click' })).toBe(false);
    expect(s.index).toBe(1);
    g.releaseClicks();
    expect(g.start({ from: 'click' })).toBe(true);
  });

  it('a remounted Next under a held press cannot walk 1 → 11', () => {
    const g = createNavGesture();
    let s = start();
    expect(g.start({ from: 'pointer' })).toBe(true);
    s = applyLessonNav(s, { type: 'next' }, LEN);
    // Live sequence: each remount fires pointerup then pointerdown on Next.
    for (let n = 0; n < 10; n++) {
      g.finish();
      if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    }
    expect(s.index).toBe(1);
    expect(titleAt(s.index)).toBe('Two things');
    g.releaseClicks();
    if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.index).toBe(2);
    expect(titleAt(s.index)).toBe('Four days');
  });

  it('does not auto-advance 4 → 5 → 6 → 7 or 10 → 11 from remount pointerups', () => {
    const g = createNavGesture();
    let s = at(3);
    expect(titleAt(s.index)).toBe('How a lead reaches you');
    if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    g.finish();
    if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    g.finish();
    if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.index).toBe(4);
    expect(titleAt(s.index)).toBe('People');

    g.releaseClicks();
    s = at(9);
    expect(titleAt(s.index)).toBe('Stage truth');
    if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    g.finish();
    if (g.start({ from: 'pointer' })) s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.index).toBe(10);
    expect(titleAt(s.index)).toBe('Your turn stages');
  });

  it('does not unlock while the pointer is still down', () => {
    const g = createNavGesture();
    expect(g.start({ from: 'pointer' })).toBe(true);
    g.finish();
    g.releaseClicks({ pointerDown: true });
    expect(g.start({ from: 'pointer' })).toBe(false);
    g.releaseClicks({ pointerDown: false });
    expect(g.start({ from: 'pointer' })).toBe(true);
  });

  it('a finished gesture is required before the next real step', () => {
    const g = createNavGesture();
    let s = at(3);
    if (g.start()) s = applyLessonNav(s, { type: 'next' }, LEN);
    if (g.start()) s = applyLessonNav(s, { type: 'next' }, LEN);
    if (g.start()) s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.index).toBe(4);
    expect(titleAt(s.index)).toBe('People');
    g.finish();
    g.releaseClicks();
    if (g.start()) s = applyLessonNav(s, { type: 'next' }, LEN);
    expect(s.index).toBe(5);
    expect(titleAt(s.index)).toBe('Demo find the lead');
  });
});

describe('resolveDeckSlideNo / findDeckSlide', () => {
  const slides = [
    { n: 1, label: 'Title' },
    { n: 10, label: 'Stage truth' },
    { n: 13, label: 'Notes' },
  ];

  it('finds a slide when the card stored the number as a string', () => {
    expect(resolveDeckSlideNo('10')).toBe(10);
    expect(findDeckSlide(slides, '10')?.label).toBe('Stage truth');
    expect(findDeckSlide(slides, 10)?.label).toBe('Stage truth');
  });

  it('does not fall back to another slide when the number is missing', () => {
    expect(findDeckSlide(slides, 99)).toBeNull();
    expect(findDeckSlide(slides, undefined)).toBeNull();
  });
});
