/**
 * The deck's physics.
 *
 * Three small primitives, shared by Pulse, Coach and Rep, that turn the deck
 * from a picture of the numbers into something that responds when you touch it:
 *
 *   useTween  — a number travels to its new value instead of being swapped for
 *               it. The window tabs are the one control that changes every
 *               figure on the page, and swapping them all at once reads as a
 *               reload. Travelling reads as the same team, measured over a
 *               different stretch of time.
 *
 *   useFlip   — rows move to their new position when you sort, rather than the
 *               table redrawing. FIRST/LAST/INVERT/PLAY: measure where each row
 *               is, let React reorder it, measure again, then put it back where
 *               it was with a transform and release it. Nothing but `transform`
 *               is ever animated, so it stays on the compositor.
 *
 *   useReducedMotion — every one of them is off when the machine asks for it.
 *
 * No dependency is added for any of this; the platform already has requestAnimationFrame
 * and Element.animate.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function prefersReduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** Live, because a leader can change the setting without reloading the app. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReduced);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Travel to `target` over `ms`, easing out.
 *
 * The FIRST value is never animated — a page arriving should not count up from
 * zero, which is the tell of a marketing site rather than an instrument. Only
 * a change, once the number is already on screen, is worth moving.
 *
 * `null` means "no number here" and is passed straight through; a tile with no
 * data must not tween to or from zero, because zero is a real answer and no
 * data is not.
 */
export function useTween(target: number | null, ms = 620): number | null {
  const [shown, setShown] = useState<number | null>(target);
  // Where the number is RIGHT NOW, mid-flight included. Starting a new run
  // from the last settled value instead would snap the digits back to the
  // previous window before setting off again, which is exactly what clicking
  // 7d then 30d twice in a second would do.
  const at = useRef<number | null>(target);
  const frame = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const from = at.current;
    // Straight through: no data, first paint, arriving from nothing, or the
    // machine has asked for stillness.
    if (target === null || from === null || reduced || from === target) {
      at.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = p < 1 ? from + (target - from) * eased : target;
      at.current = value;
      setShown(value);
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, ms, reduced]);

  return shown;
}

/**
 * Move rows to where they now belong.
 *
 * Every element that should travel carries `data-flip="<stable key>"`. On the
 * first pass there is nothing to compare against, so nothing moves — which is
 * what lets the table's own staggered entrance play uninterrupted on arrival.
 *
 * `offsetTop`, not getBoundingClientRect: the page can scroll between two
 * renders, and a viewport-relative measurement would turn that scroll into a
 * fake delta and fling every row across the screen.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, signature: string): void {
  const seen = useRef<Map<string, number>>(new Map());
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'));
    const now = new Map<string, number>();
    for (const el of rows) {
      const key = el.dataset.flip;
      if (key) now.set(key, el.offsetTop);
    }
    const before = seen.current;
    seen.current = now;
    if (before.size === 0 || reduced) return;

    for (const el of rows) {
      const key = el.dataset.flip;
      if (!key) continue;
      const was = before.get(key);
      const is = now.get(key);
      if (was === undefined || is === undefined) continue;
      const dy = was - is;
      if (Math.abs(dy) < 1) continue;
      el.animate(
        [{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'none' }],
        { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
  }, [ref, signature, reduced]);
}

/**
 * The marker travels instead of teleporting.
 *
 * A selected tab used to be drawn by putting the highlight ON the selected
 * item, so choosing a different one meant the mark vanished in one place and
 * appeared in another. Nothing connected the two, and the eye has to re-find
 * the selection every time.
 *
 * One marker, moved. It slides from where it was to where it now belongs,
 * which says "this is the same thing, it is over here now" — and on the two
 * controls this is used for (the sidebar, and the window tabs that change
 * every number on the page) that is worth the twenty lines.
 *
 * Measured rather than calculated. Deriving the offset from an index and an
 * assumed row height works right up until a label wraps or a tab is added.
 *
 * `offsetTop` / `offsetLeft`, so the reading is relative to the track itself
 * and survives a scroll. The track needs `position: relative` for that to be
 * true, which its stylesheet rule declares.
 */
/* Where each remembered marker was last seen. Module scope, because the thing
   that owns the marker does not necessarily survive the change it is marking:
   the sidebar's shell is remounted on every tab switch, so a marker whose only
   memory is component state is BORN AT THE TOP of the rail every time, and its
   transition then sweeps it down to the active link — from the top, always,
   wherever you actually came from. Flipping through tabs read as the pill
   leaping to the top and diving back down, over and over.

   Seeded from here, the fresh marker's first frame is the OLD tab's position,
   and the transition carries it from there to the new one — which is the
   continuous marker the hook promised in the first place. */
const glideMemory = new Map<string, { off: number; size: number }>();

export function useGlide(
  trackRef: RefObject<HTMLElement | null>,
  selector: string,
  axis: 'x' | 'y',
  /** Anything whose change can move the marker — usually the active key. */
  dep: unknown,
  /** Names a marker whose position should survive its component. Omit for
   *  markers that live and die with their view, like the window tabs. */
  memoryKey?: string,
): CSSProperties {
  const [box, setBox] = useState<{ off: number; size: number } | null>(
    () => (memoryKey ? glideMemory.get(memoryKey) ?? null : null),
  );

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = track.querySelector<HTMLElement>(selector);
      if (!el) { setBox(null); return; }
      const next = axis === 'y'
        ? { off: el.offsetTop, size: el.offsetHeight }
        : { off: el.offsetLeft, size: el.offsetWidth };
      if (memoryKey) glideMemory.set(memoryKey, next);
      setBox(next);
    };
    measure();
    // Fonts landing, a sidebar collapsing, a label wrapping: all of them move
    // the target without anything in React changing.
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [trackRef, selector, axis, dep, memoryKey]);

  // Nothing selected — the marker is simply not there, rather than parked at
  // the top of the track waiting to be noticed.
  if (!box) return { opacity: 0 };
  return axis === 'y'
    ? { opacity: 1, transform: `translateY(${box.off}px)`, height: box.size }
    : { opacity: 1, transform: `translateX(${box.off}px)`, width: box.size };
}
