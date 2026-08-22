import { useEffect, useRef, useState } from 'react';

/** Adds `.in` to `.reveal` elements: immediately for anything already on-screen at
 *  mount (so the hero never sits blank), on intersection for the rest, with a timed
 *  fallback so a misfiring observer can never leave content hidden.
 *  Scoped to a root element so it only reveals the dark Home subtree. */
export function useReveal(deps: unknown[] = [], root?: HTMLElement | null) {
  useEffect(() => {
    const scope: ParentNode = root ?? document;
    const els = Array.from(scope.querySelectorAll<HTMLElement>('.reveal'));
    const show = (el: HTMLElement) => {
      const delay = Number(el.dataset.delay || 0);
      window.setTimeout(() => el.classList.add('in'), delay);
    };
    if (!('IntersectionObserver' in window)) {
      els.forEach(show);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            show(e.target as HTMLElement);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      // Already on screen when the page mounts? Then it is part of the page's
      // arrival, and the page transition owns that — show it at once. Running
      // its data-delay here staggered the visible tiles on their own setTimeout
      // clocks, against a page that was already animating in. That collision,
      // not slow rendering, was the stutter on every tab change.
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
      else io.observe(el);
    });
    const fallback = window.setTimeout(() => els.forEach((el) => el.classList.add('in')), 1200);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Count-up animation for a stat number once it enters the viewport. */
export function useCountUp(target: number, durationMs = 1400) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);
  // Track which target we last animated to (null = never). Keyed on the target
  // rather than a boolean flag so that when the value changes (e.g. the window
  // tab switches MTD→12mo and a count goes 1→25) the number re-animates instead
  // of freezing at the first value it ever showed.
  const ranFor = useRef<number | null>(null);
  const valRef = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let raf = 0;
    const run = () => {
      if (ranFor.current === target) return;
      const from = valRef.current;
      ranFor.current = target;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        const cur = Math.round(from + (target - from) * eased);
        valRef.current = cur;
        setVal(cur);
        if (p < 1) raf = requestAnimationFrame(tick);
        else { valRef.current = target; setVal(target); }
      };
      raf = requestAnimationFrame(tick);
    };
    const r = node.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      run();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && run()),
      { threshold: 0.5 },
    );
    io.observe(node);
    const fallback = window.setTimeout(run, 1200);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);

  return { ref, val };
}

export const HQ_THEME_KEY = 'tru-hq-theme';

type ThemeStore = Pick<Storage, 'getItem' | 'setItem'>;
type ThemeRoot = Pick<Element, 'removeAttribute'>;

/** HQ is Dark only. A leftover Warm preference (localStorage or
 *  <html data-theme="warm">) must not re-skin the shell. Store and root are
 *  injectable so this stays testable in the node vitest environment. */
export function forceHqDarkTheme(
  store: ThemeStore | null = typeof localStorage === 'undefined' ? null : localStorage,
  root: ThemeRoot | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  try {
    if (store?.getItem(HQ_THEME_KEY) === 'warm') store.setItem(HQ_THEME_KEY, 'dark');
  } catch {
    /* private mode / quota — nothing to persist */
  }
  try {
    root?.removeAttribute('data-theme');
  } catch {
    /* no document */
  }
}

/** Pin the HQ shell to Dark on every mount, including stale Warm storage. */
export function useForceHqDark() {
  useEffect(() => {
    forceHqDarkTheme();
    return () => {
      try {
        document.documentElement.removeAttribute('data-theme');
      } catch {
        /* no document */
      }
    };
  }, []);
}
