/**
 * The two pieces of artwork Pulse uses, shared by both roster layouts.
 */

import { useEffect, useMemo, useRef } from 'react';

import type { Health, Row } from '../lib/rosterData';
import { useDeckFocus } from './deckFocus';

/* ── the burst ─────────────────────────────────────────────────────────────
   Two layers, and the split is the point.

   Behind: `burst-plate.webp`, a rendered image. Drawing light this good in
   code was the thing that kept coming out cheap — a real render has depth and
   colour behaviour that hand-drawn strokes do not.

   In front: a canvas carrying only what is true of this team — the ring at
   your line, and one node per agent at their own leads-per-contract. Those
   move per team, so they cannot live in the image.

   The plate is decoration and says so; every mark on top of it is measured.

   Positions are tied together: the plate's own light source sits at 20% across
   and halfway down, and the canvas uses the same origin. Swap the plate for a
   different render and those two numbers have to move with it, or the dots
   will float beside the burst instead of sitting in it. */
export function Burst({ rows, line }: { rows: readonly Row[]; line: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const marks = useMemo(() => {
    const rates = rows
      .map((r) => r.perContract)
      .filter((v): v is number => v !== null);
    if (rates.length === 0) return null;

    // The line gets a fixed place on the dial and everyone is read against
    // it. Anyone worse than the line lands outside the ring, which is the
    // entire reason for drawing it this way round.
    const hi = Math.max(line, ...rates) * 1.18;
    const fan = [...rows].sort((a, b) => (b.perContract ?? -1) - (a.perContract ?? -1));
    const SPREAD = (52 * Math.PI) / 180;
    const step = fan.length > 1 ? (SPREAD * 2) / (fan.length - 1) : 0;
    const TONE: Record<Health, string> = {
      'past-line': '255, 106, 69',
      behind: '242, 178, 60',
      holding: '143, 176, 162',
      'no-volume': '110, 128, 116',
    };

    // The dial starts partway out rather than at the source. Marks drawn close
    // in land on top of the number and its caption, and a dial with a non-zero
    // origin is normal as long as the ring sits on the same scale — which it
    // does, so the reading is unchanged.
    const band = (v: number) => 0.44 + (Math.min(v, hi) / hi) * 0.56;

    return {
      spread: SPREAD,
      lineAt: band(line),
      dots: fan.map((r, i) => ({
        angle: fan.length > 1 ? -SPREAD + i * step : 0,
        // No volume has no rate to place, so it sits at the foot of the dial
        // rather than being given a number it does not have.
        at: r.perContract === null ? 0.40 : band(r.perContract),
        tone: TONE[r.health],
        faded: r.perContract === null,
      })),
    };
  }, [rows, line]);

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

      const cx = w * 0.20, cy = h * 0.502;
      // The dial is an ellipse, not a circle. The card is roughly twice as wide
      // as it is tall, so a circular dial throws its widest marks straight out
      // of the bottom edge.
      const rx = w * 0.74, ry = h * 0.44;
      const { spread, lineAt, dots } = marks;
      const at = (a: number, f: number) =>
        [cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f] as const;

      // The type sits on the left, so the plate is knocked back off it. This
      // is the only thing painted rather than drawn.
      const left = g.createLinearGradient(0, 0, w * 0.46, 0);
      left.addColorStop(0, 'rgba(7, 15, 10, 0.94)');
      left.addColorStop(0.42, 'rgba(7, 15, 10, 0.72)');
      left.addColorStop(1, 'rgba(7, 15, 10, 0)');
      g.fillStyle = left;
      g.fillRect(0, 0, w * 0.46, h);

      g.strokeStyle = 'rgba(255, 145, 116, 0.85)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 5]);
      g.beginPath();
      g.ellipse(cx, cy, rx * lineAt, ry * lineAt, 0, -spread - 0.16, spread + 0.16);
      g.stroke();
      g.setLineDash([]);

      for (const d of dots) {
        const [x, y] = at(d.angle, d.at);
        const halo = g.createRadialGradient(x, y, 0, x, y, 13);
        halo.addColorStop(0, `rgba(${d.tone}, ${d.faded ? 0.22 : 0.42})`);
        halo.addColorStop(1, `rgba(${d.tone}, 0)`);
        g.fillStyle = halo;
        g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();

        g.fillStyle = `rgba(${d.tone}, ${d.faded ? 0.55 : 1})`;
        g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();

        g.strokeStyle = `rgba(${d.tone}, 0.5)`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 6.4, 0, Math.PI * 2); g.stroke();
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
      <img className="rs-plate-art" src="/burst-plate.webp" alt="" aria-hidden decoding="async" />
      <canvas className="rs-burst" ref={ref} aria-hidden />
    </>
  );
}

/* ── the strips ────────────────────────────────────────────────────────────
   One bar per agent, in the order the roster sits. Same form on every
   supporting card so the shape of the team is comparable between them.

   Deliberately NOT a sparkline: a sparkline claims a history, and Follow Up
   Boss carries no stage history to draw one from.

   Each bar now knows WHOSE it is. Give the strip the same keys the table gives
   its rows and the five small tiles stop being decoration: point at a row and
   you can see, in one movement, that this is the person who is fifth on leads,
   second on worked and first on stuck. That is five readings the page was
   already drawing and nobody could line up.

   Heights are set with `transform: scaleY`, not `height` — a strip is up to
   thirty bars, and animating height would relayout the tile for every one of
   them on every frame. The bar sits bottom-anchored so the scale reads from
   the floor. */
export function Strip({
  values, tone, keys, labels,
}: {
  values: readonly number[];
  tone: string;
  /** Same order and length as `values`. Without it the strip stays decorative. */
  keys?: readonly string[];
  /** What to say about a bar on hover — "Dana Cole · 71 leads". */
  labels?: readonly string[];
}) {
  const focus = useDeckFocus();
  const max = Math.max(1, ...values);
  const linked = !!keys && keys.length === values.length;
  const anyOn = linked && focus.active !== null && keys.includes(focus.active);

  return (
    <span className={`rs-strip t-${tone}${anyOn ? ' is-focused' : ''}`} aria-hidden={!linked}>
      {values.map((v, i) => {
        const key = linked ? keys[i] : null;
        return (
          <i
            key={key ?? i}
            className={key !== null && focus.active === key ? 'is-on' : ''}
            style={{
              // `scaleY` from a floor of 7% keeps a zero bar visible as a zero
              // rather than as a missing agent.
              transform: `scaleY(${Math.max(0.07, v / max)})`,
              opacity: v === 0 ? 0.22 : 1,
            }}
            title={labels && key !== null ? labels[i] : undefined}
            onMouseEnter={key !== null ? () => focus.point(key) : undefined}
            onMouseLeave={key !== null ? () => focus.point(null) : undefined}
          />
        );
      })}
    </span>
  );
}
