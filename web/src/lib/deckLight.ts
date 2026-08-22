/**
 * The room's light, and how it answers you.
 *
 * The design system's whole thesis is that a page is a ROOM that is lit. Until
 * now the lighting was indifferent: a render drifting on a 110-second loop that
 * did not know the cursor existed, did not know the page had been scrolled, and
 * did not know whether the floor was on fire.
 *
 * Two behaviours here, and both of them are the same idea — light that responds:
 *
 *   PLATE LIGHT   Every glass plate catches a soft specular wash where the
 *                 cursor is. It is the room's own warm source falling on a
 *                 surface you happen to be touching, not a highlight bolted
 *                 onto a card.
 *
 *   PARALLAX      The light layer lags the page as you scroll. The ground
 *                 behind it does not, so scrolling separates them and the deck
 *                 stops being a picture and becomes a space you move through.
 *
 * Cost discipline, because this runs on every pointer move and every scroll
 * frame of a long roster:
 *
 *   - ONE delegated listener for the whole shell, not one per card.
 *   - Every read and every write is deferred to a single rAF, so a burst of
 *     forty pointermove events in a frame does forty cheap assignments and one
 *     layout read.
 *   - The only things written are custom properties feeding `transform` and a
 *     `background-position`, so nothing here can trigger layout.
 *   - Off entirely under prefers-reduced-motion.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

import { useReducedMotion } from './deckMotion';

/* The ceiling on the lag. The multiplier itself lives in the stylesheet
   (`.tru-room-move`, 0.045), because it belongs with the crop it has to stay
   inside; this only has to agree on how far the number is allowed to go.
   0.045 × 2400 is 108px of separation — enough to read as depth, well within
   the room's own -18% overscan. */
const LAG_CEILING = 2400;

export function useRoomLight(shellRef: RefObject<HTMLElement | null>): void {
  const reduced = useReducedMotion();

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || reduced) return;

    /* ---- the plate under the cursor ---- */
    let lit: HTMLElement | null = null;
    let point: { el: HTMLElement; cx: number; cy: number } | null = null;
    let pointFrame = 0;

    const douse = () => {
      if (!lit) return;
      lit.classList.remove('is-lit');
      lit = null;
    };

    const paintLight = () => {
      pointFrame = 0;
      if (!point) { douse(); return; }
      const { el, cx, cy } = point;
      // Measured HERE rather than in the move handler: one layout read per
      // frame instead of one per event, and it is automatically correct after
      // a scroll because a new frame re-reads it.
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (lit && lit !== el) douse();
      el.style.setProperty('--px', `${((cx - r.left) / r.width) * 100}%`);
      el.style.setProperty('--py', `${((cy - r.top) / r.height) * 100}%`);
      el.classList.add('is-lit');
      lit = el;
    };

    const onMove = (e: PointerEvent) => {
      // A finger is not a cursor: on a touch screen the "hover" would be a
      // light that appears under a tap and then strands itself there.
      if (e.pointerType === 'touch') return;
      const target = e.target as Element | null;
      const plate = target?.closest?.('.rs-plate') as HTMLElement | null;
      point = plate ? { el: plate, cx: e.clientX, cy: e.clientY } : null;
      if (!pointFrame) pointFrame = requestAnimationFrame(paintLight);
    };

    /* ---- the light lagging the page ---- */
    let scrollFrame = 0;
    const paintScroll = () => {
      scrollFrame = 0;
      const y = Math.min(window.scrollY, LAG_CEILING);
      shell.style.setProperty('--sy', String(y));
    };
    const onScroll = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(paintScroll);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    paintScroll();

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(pointFrame);
      cancelAnimationFrame(scrollFrame);
      douse();
      shell.style.removeProperty('--sy');
    };
  }, [shellRef, reduced]);
}
