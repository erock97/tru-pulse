/** Step-list navigation for the in-app lesson viewer.
 *
 *  A module is a mixed list: HTML deck slides and interactive record
 *  exercises share one index. Next/Back must move that index by exactly one
 *  — never by a deck slide number, and never by a second click that lands
 *  after the slide remounts and the layout shifts under the pointer.
 */

export type LessonNavState = {
  /** 0-based index into the mixed card list. */
  index: number;
  /** Highest index the learner has been allowed to open. */
  seen: number;
};

export type LessonNavIntent =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; index: number };

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

export function applyLessonNav(
  state: LessonNavState,
  intent: LessonNavIntent,
  length: number,
): LessonNavState {
  const index = clampIndex(state.index, length);
  const seen = clampIndex(Math.max(state.seen, index), length);

  if (intent.type === 'next') {
    const next = clampIndex(index + 1, length);
    return { index: next, seen: Math.max(seen, next) };
  }

  if (intent.type === 'back') {
    const prev = clampIndex(index - 1, length);
    // Intentional back: later steps re-lock. Accidental jumps are stopped
    // before they get here (createNavGate + rail only accepts seen steps).
    return { index: prev, seen: prev };
  }

  const target = clampIndex(intent.index, length);
  if (target > seen) return { index, seen };
  if (target < index) return { index: target, seen: target };
  return { index: target, seen: Math.max(seen, target) };
}

/** Ignore a second activation while the first click's layout is still settling.
 *  The live viewer remounts the slide on every step (`key={i}`), and a tall
 *  slide changing height moves Next/Back/sidebar under the still-down pointer. */
export function createNavGate(lockMs = 300): { allow: () => boolean; reset: () => void } {
  let lockedUntil = 0;
  return {
    allow() {
      const now = Date.now();
      if (now < lockedUntil) return false;
      lockedUntil = now + lockMs;
      return true;
    },
    reset() {
      lockedUntil = 0;
    },
  };
}

export function resolveDeckSlideNo(n: number | string | undefined | null): number | null {
  if (n == null || n === '') return null;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 1) return null;
  return v;
}

export function findDeckSlide<T extends { n: number }>(
  slides: T[],
  n: number | string | undefined | null,
): T | null {
  const want = resolveDeckSlideNo(n);
  if (want == null) return null;
  return slides.find((s) => s.n === want) ?? null;
}
