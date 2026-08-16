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
    // before they get here (createNavGesture + rail only accepts seen steps).
    return { index: prev, seen: prev };
  }

  const target = clampIndex(intent.index, length);
  if (target > seen) return { index, seen };
  if (target < index) return { index: target, seen: target };
  return { index: target, seen: Math.max(seen, target) };
}

export type NavGestureFrom = 'pointer' | 'click' | 'key';

/** One navigation per pointer/key gesture.
 *
 *  A time window is the wrong lock: the live deck remounts on every step, and
 *  a held click or Space/Enter repeat keeps firing after 300ms — one Next
 *  walked ~10 steps (1→11), and the deck advanced on its own (4→5→6→7,
 *  10→11) while someone only took snapshots.
 *
 *  finish() means the physical pointer/key went up. It must NOT re-arm.
 *  Remounting Next fires pointerup then another pointerdown on the new
 *  button; unlocking there is what walked the deck with no second click.
 *  releaseClicks() is the unlock, and only after the pointer stayed up. */
export function createNavGesture(): {
  start: (opts?: { repeat?: boolean; from?: NavGestureFrom }) => boolean;
  finish: () => void;
  releaseClicks: (opts?: { pointerDown?: boolean }) => void;
  reset: () => void;
} {
  let held = false;
  let blockClick = false;
  return {
    start(opts) {
      if (opts?.repeat) return false;
      if (opts?.from === 'click' && blockClick) return false;
      if (held) return false;
      held = true;
      if (opts?.from === 'pointer') blockClick = true;
      return true;
    },
    finish() {
      // Physical release only. Re-arming here lets a remounted Next take
      // another step from the same held press.
    },
    releaseClicks(opts) {
      if (opts?.pointerDown) return;
      held = false;
      blockClick = false;
    },
    reset() {
      held = false;
      blockClick = false;
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
