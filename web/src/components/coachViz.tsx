/**
 * The drift map — Coach's answer to Pulse's dial.
 *
 * Pulse measures output, so its dial is a target: rays thrown outward and a
 * ring you are judged against. Coach measures something else entirely —
 * cadence. How long since you actually sat down with each person.
 *
 * So distance here means time. Every agent is a point, and how far out they
 * sit is how many days it has been since their last 1:1. People you spoke to
 * this week cluster near the light; people you have not seen in a month drift
 * out to the edge. Neglect becomes a distance you can see rather than a
 * number you have to read.
 *
 * The rings are the week, the fortnight and the month. Crossing one is the
 * whole point of the picture.
 *
 * Same two-layer technique as the Pulse burst: a rendered plate behind
 * carrying the light, a canvas in front carrying only what is true of this
 * team. The plate's own source sits at 25% across and 49% down, and the
 * canvas uses the same origin — move one and you must move the other.
 *
 * (drift-plate.webp: source at 25% across, 49% down.)
 */

import { useEffect, useMemo, useRef } from 'react';

import type { RosterAgent } from '../lib/coachData';

/** Where the rings sit, in days. Anything past the last one pins to the edge. */
const RINGS = [7, 14, 30] as const;
const MAX_DAYS = 45;

export function DriftMap({ roster }: { roster: readonly RosterAgent[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const marks = useMemo(() => {
    if (roster.length === 0) return null;

    // `lastDays` uses 99 as its "never" sentinel. Never is not 99 days — it is
    // worse than any number — so it pins to the outer edge and is drawn hollow
    // rather than being placed on a scale it was never on.
    const at = (d: number) => Math.min(d, MAX_DAYS) / MAX_DAYS;

    // Spread them by how stale they are, worst at the top, so the eye travels
    // down the fan from the person you have neglected most.
    const fan = [...roster].sort((a, b) => b.lastDays - a.lastDays);
    const SPREAD = (54 * Math.PI) / 180;
    const step = fan.length > 1 ? (SPREAD * 2) / (fan.length - 1) : 0;

    return {
      spread: SPREAD,
      rings: RINGS.map((d) => ({ days: d, at: 0.2 + at(d) * 0.8 })),
      dots: fan.map((a, i) => {
        const never = a.lastDays >= 99;
        return {
          key: a.id,
          angle: fan.length > 1 ? -SPREAD + i * step : 0,
          at: never ? 1 : 0.2 + at(a.lastDays) * 0.8,
          never,
          // The room's own vocabulary: sea green is fine, amber is slipping,
          // ember is stalled. Same three tones Pulse uses for health.
          tone: never || a.lastDays >= 30 ? '255, 106, 69'
            : a.lastDays >= 14 ? '242, 178, 60'
              : '143, 176, 162',
        };
      }),
    };
  }, [roster]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !marks) return;

    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);

      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const cx = w * 0.25, cy = h * 0.49;
      // Elliptical for the same reason Pulse's is: the card is far wider than
      // it is tall, and a circle throws its widest marks out of the bottom.
      const rx = w * 0.76, ry = h * 0.44;
      const { spread, rings, dots } = marks;
      const at = (a: number, f: number) =>
        [cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f] as const;

      // The type sits on the left, so the plate is knocked back off it.
      const left = g.createLinearGradient(0, 0, w * 0.46, 0);
      left.addColorStop(0, 'rgba(7, 15, 10, 0.94)');
      left.addColorStop(0.42, 'rgba(7, 15, 10, 0.72)');
      left.addColorStop(1, 'rgba(7, 15, 10, 0)');
      g.fillStyle = left;
      g.fillRect(0, 0, w * 0.46, h);

      // one week, two weeks, a month
      g.setLineDash([3, 5]);
      for (const r of rings) {
        g.strokeStyle = r.days >= 30 ? 'rgba(255, 145, 116, 0.6)' : 'rgba(226, 240, 230, 0.20)';
        g.lineWidth = r.days >= 30 ? 1.4 : 1;
        g.beginPath();
        g.ellipse(cx, cy, rx * r.at, ry * r.at, 0, -spread - 0.14, spread + 0.14);
        g.stroke();

        const [lx, ly] = at(-spread - 0.14, r.at);
        g.setLineDash([]);
        g.fillStyle = r.days >= 30 ? 'rgba(255, 145, 116, 0.75)' : 'rgba(226, 240, 230, 0.38)';
        g.font = '600 9px ui-sans-serif, system-ui, sans-serif';
        g.fillText(`${r.days}d`, lx - 8, ly - 6);
        g.setLineDash([3, 5]);
      }
      g.setLineDash([]);

      for (const d of dots) {
        const [x, y] = at(d.angle, d.at);
        const halo = g.createRadialGradient(x, y, 0, x, y, 13);
        halo.addColorStop(0, `rgba(${d.tone}, 0.42)`);
        halo.addColorStop(1, `rgba(${d.tone}, 0)`);
        g.fillStyle = halo;
        g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();

        if (d.never) {
          // Never spoken to. Drawn hollow, because there is no elapsed time to
          // place them by — they are at the edge for a different reason.
          g.strokeStyle = `rgba(${d.tone}, 0.95)`;
          g.lineWidth = 1.6;
          g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.stroke();
        } else {
          g.fillStyle = `rgba(${d.tone}, 1)`;
          g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();
        }

        g.strokeStyle = `rgba(${d.tone}, 0.45)`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 6.6, 0, Math.PI * 2); g.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [marks]);

  if (!marks) return null;
  return (
    <>
      <img className="rs-plate-art" src="/drift-plate.webp" alt="" aria-hidden decoding="async" />
      <canvas className="rs-burst" ref={ref} aria-hidden />
    </>
  );
}
