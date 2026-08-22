/**
 * One person at a time, across the whole page.
 *
 * A deck page shows the same team three ways at once: as dots on a scale in
 * the lead tile, as bars in the small tiles, and as rows in the table. Until
 * now those were three pictures of one team that had no idea the other two
 * existed — you could see that somebody was an outlier and had no way to find
 * out who without reading every number.
 *
 * This is the wire between them. Point at a row and that person's dot swells
 * and says its name, their bar lights in every strip, and everything else
 * steps back. Point at a dot and the row lights instead. It is one instrument
 * with several faces rather than several charts.
 *
 * Two levels, on purpose:
 *   - POINTING is what the cursor or the arrow keys are doing right now.
 *   - PINNING survives letting go. You pin the person you came here about and
 *     they stay lit through a sort, a window change and a scroll, so you can
 *     read the rest of the page against them.
 *
 * Nothing here changes a colour. The tone of every mark is still whatever the
 * data made it; the only thing focus changes is how much light it gets.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useTween } from '../lib/deckMotion';

interface DeckFocus {
  /** Under the cursor / under the keyboard cursor. */
  pointed: string | null;
  /** Held until it is let go. */
  pinned: string | null;
  /** Pointed if anything is pointed, otherwise whatever is pinned. */
  active: string | null;
  point: (key: string | null) => void;
  pin: (key: string | null) => void;
  togglePin: (key: string) => void;
}

const Ctx = createContext<DeckFocus | null>(null);

/** Safe outside a provider: every consumer degrades to "nothing is focused". */
const IDLE: DeckFocus = {
  pointed: null, pinned: null, active: null,
  point: () => {}, pin: () => {}, togglePin: () => {},
};

export function useDeckFocus(): DeckFocus {
  return useContext(Ctx) ?? IDLE;
}

export function DeckFocusProvider({ children }: { children: ReactNode }) {
  const [pointed, setPointed] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const value = useMemo<DeckFocus>(() => ({
    pointed,
    pinned,
    active: pointed ?? pinned,
    point: setPointed,
    pin: setPinned,
    togglePin: (key: string) => setPinned((cur) => (cur === key ? null : key)),
  }), [pointed, pinned]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The props every row, dot and bar wants: it lights when it is the one being
 * looked at, and it tells the rest of the page when the cursor arrives.
 *
 * Returned as a plain object so a caller can spread it onto a <tr> without
 * this file needing to know what a row looks like on their page.
 */
export function focusBinding(key: string, focus: DeckFocus) {
  return {
    onMouseEnter: () => focus.point(key),
    onMouseLeave: () => focus.point(null),
    onFocus: () => focus.point(key),
    onBlur: () => focus.point(null),
  };
}

/* ── walking the roster from the keyboard ─────────────────────────────────
   The ⌘K bar made the deck reachable without a mouse; this makes it readable
   without one. Up and down (or j and k, for the people who never left vim)
   walk the list, and because walking POINTS at each person in turn, the dot
   travels along the scale beside you as you go.

   It stands down whenever something else has a claim on the keyboard: a text
   field, a modal, or a page where a sheet is open over the roster. */
export function useDeckKeys({
  keys, onOpen, onEscape, enabled = true,
}: {
  keys: readonly string[];
  onOpen?: (key: string) => void;
  onEscape?: () => void;
  enabled?: boolean;
}) {
  const focus = useDeckFocus();
  // Read through a ref so the listener is bound once rather than on every
  // sort — rebinding on each render is how key handlers start missing presses.
  const state = useRef({ keys, onOpen, onEscape, focus });
  state.current = { keys, onOpen, onEscape, focus };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
      );
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const { keys: list, onOpen: open, onEscape: esc, focus: f } = state.current;

      if (e.key === 'Escape') {
        if (f.pinned) { f.pin(null); e.preventDefault(); return; }
        if (esc) { esc(); e.preventDefault(); }
        return;
      }
      if (list.length === 0) return;

      const step = e.key === 'ArrowDown' || e.key === 'j' ? 1
        : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
      if (step !== 0) {
        e.preventDefault();
        const here = f.active ? list.indexOf(f.active) : -1;
        const next = here === -1
          ? (step === 1 ? 0 : list.length - 1)
          : Math.min(list.length - 1, Math.max(0, here + step));
        const key = list[next];
        f.point(key);
        document
          .querySelector<HTMLElement>(`[data-flip="${CSS.escape(key)}"]`)
          ?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (!f.active) return;
      if (e.key === 'Enter' && open) { e.preventDefault(); open(f.active); return; }
      // Hold this one. The single most useful thing on a page you are reading
      // against one person.
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); f.togglePin(f.active); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/* ── numbers that travel ──────────────────────────────────────────────────
   The window tabs change every figure on the page at once. Swapped, they read
   as a fresh page load; travelled, they read as the same team measured over a
   different stretch of time — which is what actually happened. */
export function Num({
  n, prefix = '', suffix = '', empty = '—', decimals = 0,
}: {
  n: number | null;
  prefix?: string;
  suffix?: string;
  /** What to show when there is no number. Zero is a number; null is not. */
  empty?: string;
  decimals?: number;
}) {
  const shown = useTween(n);
  if (shown === null) return <>{empty}</>;
  const rounded = decimals > 0
    ? shown.toFixed(decimals)
    : String(Math.round(shown));
  return <>{prefix}{rounded}{suffix}</>;
}

/** Same, for a value read as part of a longer string (`1 : 24`). */
export function useRounded(n: number | null): number | null {
  const shown = useTween(n);
  return shown === null ? null : Math.round(shown);
}
