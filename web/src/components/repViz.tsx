/**
 * The track — Rep's answer to Pulse's dial and Coach's drift map.
 *
 * Certification is not a rate and it is not a duration. It is a sequence:
 * four modules, in order, each one passed or not. So this is the one page
 * whose picture is not radial at all. It is a line, left to right, with a
 * marker at every module and a dot for every agent showing how far along
 * they have actually got.
 *
 * Two things fall out of drawing it this way, and both are the point:
 *
 *   Where the dots pile up is where people stall. A column three deep at
 *   module two is a fact about module two, not about three agents.
 *
 *   Agents who were never sent a login sit BEFORE the start gate, drawn
 *   hollow. They have not stalled — they were never able to begin, which is
 *   a completely different problem with a completely different fix. Averaging
 *   them in with the stalled is how that distinction gets lost.
 *
 * Same two-layer technique as its siblings: a rendered plate carrying the
 * light, a canvas carrying only what is true. This plate streaks along the
 * direction of travel rather than radiating, because the geometry underneath
 * it travels.
 */

import { useEffect, useMemo, useRef } from 'react';

export interface TrackAgent {
  id: string;
  name: string;
  /** Modules passed, 0..total. */
  passed: number;
  /** A login has been sent. Without one they cannot start at all. */
  invited: boolean;
  /** Fully certified and signed off. */
  signed: boolean;
}

export function Track({ agents, modules }: { agents: readonly TrackAgent[]; modules: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const marks = useMemo(() => {
    if (agents.length === 0 || modules === 0) return null;

    // Stack agents that sit on the same mark, so a pile-up reads as a pile-up
    // rather than one dot drawn six times.
    const columns = new Map<string, TrackAgent[]>();
    for (const a of agents) {
      const key = a.invited ? String(a.passed) : 'gate';
      const col = columns.get(key) ?? [];
      col.push(a);
      columns.set(key, col);
    }

    return {
      columns: [...columns.entries()].map(([key, list]) => ({
        key,
        atGate: key === 'gate',
        step: key === 'gate' ? 0 : Number(key),
        list,
      })),
      deepest: Math.max(...[...columns.values()].map((c) => c.length)),
    };
  }, [agents, modules]);

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

      // The type sits on the left, same as its siblings.
      const wash = g.createLinearGradient(0, 0, w * 0.40, 0);
      wash.addColorStop(0, 'rgba(7, 15, 10, 0.94)');
      wash.addColorStop(0.42, 'rgba(7, 15, 10, 0.70)');
      wash.addColorStop(1, 'rgba(7, 15, 10, 0)');
      g.fillStyle = wash;
      g.fillRect(0, 0, w * 0.40, h);

      const x0 = w * 0.40, x1 = w * 0.94;
      const baseY = h * 0.70;
      const at = (step: number) => x0 + ((x1 - x0) * step) / modules;
      const gateX = x0 - (x1 - x0) * 0.10;

      // the line itself
      g.strokeStyle = 'rgba(226, 240, 230, 0.22)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, baseY); g.lineTo(x1, baseY); g.stroke();

      // the start gate — everything left of it has not been let in yet
      g.setLineDash([3, 4]);
      g.strokeStyle = 'rgba(255, 145, 116, 0.55)';
      g.beginPath(); g.moveTo(x0, baseY - h * 0.30); g.lineTo(x0, baseY + h * 0.10); g.stroke();
      g.setLineDash([]);

      // a tick per module, and the finish
      g.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      for (let s = 0; s <= modules; s++) {
        const x = at(s);
        const finish = s === modules;
        g.strokeStyle = finish ? 'rgba(242, 178, 60, 0.85)' : 'rgba(226, 240, 230, 0.30)';
        g.lineWidth = finish ? 1.6 : 1;
        g.beginPath(); g.moveTo(x, baseY - 5); g.lineTo(x, baseY + 5); g.stroke();

        g.fillStyle = finish ? 'rgba(255, 220, 147, 0.9)' : 'rgba(226, 240, 230, 0.4)';
        const label = s === 0 ? 'start' : finish ? 'certified' : String(s);
        g.fillText(label, x - g.measureText(label).width / 2, baseY + 18);
      }

      // one dot per agent, stacked upward from the line
      const GAP = Math.min(15, (h * 0.46) / Math.max(1, marks.deepest));
      for (const col of marks.columns) {
        const x = col.atGate ? gateX : at(col.step);
        col.list.forEach((a, i) => {
          const y = baseY - 14 - i * GAP;
          const tone = col.atGate ? '150, 168, 156'
            : a.signed ? '242, 178, 60'
              : a.passed === 0 ? '255, 106, 69'
                : a.passed === modules ? '242, 178, 60'
                  : '143, 176, 162';

          const halo = g.createRadialGradient(x, y, 0, x, y, 11);
          halo.addColorStop(0, `rgba(${tone}, ${col.atGate ? 0.20 : 0.40})`);
          halo.addColorStop(1, `rgba(${tone}, 0)`);
          g.fillStyle = halo;
          g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();

          if (col.atGate) {
            // Never invited. Hollow, because they have not stalled — they were
            // never able to start.
            g.strokeStyle = `rgba(${tone}, 0.9)`;
            g.lineWidth = 1.4;
            g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.stroke();
          } else {
            g.fillStyle = `rgba(${tone}, 1)`;
            g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();
          }
        });

        if (col.atGate && col.list.length > 0) {
          g.fillStyle = 'rgba(255, 145, 116, 0.75)';
          const t = 'no login';
          g.fillText(t, x - g.measureText(t).width / 2, baseY + 18);
        }
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [marks, modules]);

  if (!marks) return null;
  return (
    <>
      <img className="rs-plate-art" src="/track-plate.webp" alt="" aria-hidden decoding="async" />
      <canvas className="rs-burst" ref={ref} aria-hidden />
    </>
  );
}
