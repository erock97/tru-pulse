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
      if (r.top < window.innerHeight && r.bottom > 0) show(el);
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

export type HqTheme = 'dark' | 'warm';
const THEME_KEY = 'tru-hq-theme';

/** Reads/writes the HQ dark/warm theme onto <html data-theme>. Defaults to dark.
 *  Only the .tru-dark subtree reacts to data-theme, so this can't repaint the
 *  not-yet-reskinned pages. */
export function useHqTheme(): [HqTheme, () => void] {
  const read = (): HqTheme => {
    try {
      return localStorage.getItem(THEME_KEY) === 'warm' ? 'warm' : 'dark';
    } catch {
      return 'dark';
    }
  };
  const [theme, setTheme] = useState<HqTheme>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'warm') root.setAttribute('data-theme', 'warm');
    else root.removeAttribute('data-theme');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  // Clean up the html attribute when the dark Home unmounts so it can't affect
  // other routes that might one day read data-theme.
  useEffect(() => () => document.documentElement.removeAttribute('data-theme'), []);
  return [theme, () => setTheme((t) => (t === 'warm' ? 'dark' : 'warm'))];
}
