/**
 * The wire, drawn.
 *
 * The deck already knew that a row in the table and a dot on the scale were
 * the same person — pointing at one lit the other. But the connection was an
 * inference you had to make: two things glowed in two different parts of the
 * screen and you were left to trust that they were related.
 *
 * So draw it. A thread of light leaves the dot, curves down the page and lands
 * on the row. It is the same fact the highlight was already stating, said out
 * loud, and it turns "these two are linked" from something you deduce into
 * something you watch happen.
 *
 * Three rules keep it from becoming a diagram:
 *
 *   It FADES toward the row. The gradient runs bright at the dot and to
 *   nothing at the far end, so it reads as light leaving a source, not as a
 *   connector joining two boxes. A line of even weight between two points is
 *   an org chart.
 *
 *   It DRAWS rather than appearing — 340ms from the dot outward, so the eye is
 *   led along it in the direction the meaning travels.
 *
 *   It gives up quietly. No dot, no row, too short a span to be worth saying,
 *   reduced motion: nothing renders at all.
 *
 * Geometry is written straight onto the SVG attributes from a rAF loop rather
 * than through React state. The endpoints move on every scroll frame, and a
 * setState per frame would re-render the whole deck sixty times a second to
 * move one line.
 */

import { useEffect, useId, useRef } from 'react';

import { useDeckFocus } from './deckFocus';
import { useReducedMotion } from '../lib/deckMotion';

/** Below this the two ends are close enough that a line says nothing. */
const MIN_SPAN = 90;

export function FocusWire() {
  const focus = useDeckFocus();
  const reduced = useReducedMotion();
  const gradId = useId().replace(/:/g, '');
  const wrapRef = useRef<SVGSVGElement | null>(null);
  const lineRef = useRef<SVGPathElement | null>(null);
  const glowRef = useRef<SVGPathElement | null>(null);
  const gradRef = useRef<SVGLinearGradientElement | null>(null);
  const key = focus.active;

  useEffect(() => {
    const svg = wrapRef.current;
    if (!svg || !key || reduced) return;

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const row = document.querySelector<HTMLElement>(`[data-flip="${CSS.escape(key)}"]`);
      const dot = document.querySelector<HTMLElement>('.sm-dot.is-on');
      if (!row || !dot) { svg.classList.remove('is-on'); return; }

      const r = row.getBoundingClientRect();
      const d = dot.getBoundingClientRect();
      if (!r.height || !d.height) { svg.classList.remove('is-on'); return; }

      // The dot's middle, and the row's name — not its left edge, which would
      // land the thread on the plate's rim rather than on the person.
      const x2 = d.left + d.width / 2;
      const y2 = d.top + d.height / 2;
      const x1 = r.left + Math.min(150, r.width * 0.16);
      const y1 = r.top + r.height / 2;

      if (Math.hypot(x2 - x1, y2 - y1) < MIN_SPAN) { svg.classList.remove('is-on'); return; }

      /* Leaves the dot straight down and arrives at the row straight up, so
         both ends meet their anchor square on. A straight diagonal would cut
         across the tiles at an angle that reads as a scratch on the glass. */
      const bend = Math.max(28, Math.abs(y2 - y1) * 0.42);
      const path = `M ${x2} ${y2} C ${x2} ${y2 + bend}, ${x1} ${y1 - bend}, ${x1} ${y1}`;
      lineRef.current?.setAttribute('d', path);
      glowRef.current?.setAttribute('d', path);

      // The gradient runs along the thread itself, so "bright at the dot" stays
      // true whichever way round the two ends happen to sit.
      const g = gradRef.current;
      if (g) {
        g.setAttribute('x1', String(x2));
        g.setAttribute('y1', String(y2));
        g.setAttribute('x2', String(x1));
        g.setAttribute('y2', String(y1));
      }
      svg.classList.add('is-on');
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      svg.classList.remove('is-on');
    };
  }, [key, reduced]);

  if (!key || reduced) return null;

  return (
    <svg className="fw" ref={wrapRef} aria-hidden focusable="false">
      <defs>
        {/* userSpaceOnUse, not the default: the stops have to line up with the
            thread's real endpoints on screen, not with the bounding box of a
            curve that changes shape every frame. */}
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" ref={gradRef}>
          <stop offset="0%" stopColor="var(--accent-hi)" stopOpacity="0.85" />
          <stop offset="38%" stopColor="var(--accent)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Two passes: a wide soft one for the bloom, a hairline for the thread.
          `key` remounts both when the person changes, which is what restarts
          the draw-in — one honest re-render per person, not one per frame. */}
      <path key={`${key}-glow`} ref={glowRef} className="fw-glow" pathLength={1} stroke={`url(#${gradId})`} />
      <path key={`${key}-line`} ref={lineRef} className="fw-line" pathLength={1} stroke={`url(#${gradId})`} />
    </svg>
  );
}
