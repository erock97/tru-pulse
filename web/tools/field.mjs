/**
 * Generates the TRU HQ depth-of-field layer.
 *
 * The point of this file is the thing CSS cannot do: real depth of field.
 * Every light gets a softness proportional to its size, so a handful sit
 * sharp and everything else falls away out of focus. That separation is what
 * makes a background read as a photograph of a room rather than a gradient.
 *
 * IMPORTANT — no <filter> elements. A first version used feGaussianBlur, and
 * a full-viewport `cover` background rasterises those at display resolution;
 * with large stdDeviations that froze the renderer outright. Softness here is
 * baked into radial gradient stops instead, which the compositor draws for
 * free. Same look, no filter pass.
 *
 * Deterministic — a fixed seed, so regenerating never reshuffles the design.
 */

import { writeFileSync } from 'node:fs';

const W = 1600;
const H = 1000;

/* mulberry32 — small, fast, and stable across runs */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260820);
const pickI = (a) => Math.floor(r() * a.length);
const between = (lo, hi) => lo + r() * (hi - lo);

/* The palette is the forest deck's own. Amber is the light source, sea green
   is bounce off the room, and the near-whites are the few sharp highlights. */
const WARM = ['#F2B23C', '#E8A63A', '#FFDC93', '#C98A2E'];
const COOL = ['#8FB0A2', '#60A87C', '#4E8468', '#2F6247'];
const HUES = [...WARM, ...COOL];

/* Four focus levels. Level 0 is a crisp disc with a soft rim; level 3 is so
   far out of focus it is only a smudge of light. The stop curves are what a
   gaussian blur would have produced, precomputed. */
const FOCUS = [
  [[0, 1], [0.80, 1], [0.92, 0.55], [1, 0]],
  [[0, 1], [0.50, 0.92], [0.78, 0.42], [1, 0]],
  [[0, 1], [0.26, 0.68], [0.62, 0.24], [1, 0]],
  [[0, 1], [0.16, 0.46], [0.48, 0.14], [1, 0]],
];
/* a blurred disc covers more ground than a sharp one of the same radius */
const SPREAD = [1.06, 1.5, 2.1, 3.0];

const defs = [];
for (let h = 0; h < HUES.length; h++) {
  for (let f = 0; f < FOCUS.length; f++) {
    const stops = FOCUS[f]
      .map(([o, a]) => `<stop offset="${o}" stop-color="${HUES[h]}" stop-opacity="${a}"/>`)
      .join('');
    defs.push(`<radialGradient id="g${h}_${f}">${stops}</radialGradient>`);
  }
}

const lights = [];
const light = (cx, cy, rad, hue, focus, opacity) =>
  lights.push(
    `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(rad * SPREAD[focus]).toFixed(0)}" ` +
    `fill="url(#g${hue}_${focus})" opacity="${opacity.toFixed(3)}"/>`
  );

/* ---- far wash: a few very large, very dim shapes that set the depth ---- */
for (let i = 0; i < 8; i++) {
  light(between(-60, W + 60), between(-40, H + 40), between(170, 300),
    r() > 0.55 ? pickI(WARM) : 4 + pickI(COOL), 3, between(0.040, 0.078));
}

/* ---- mid bokeh: the recognisable out-of-focus discs ---- */
for (let i = 0; i < 40; i++) {
  const rad = between(22, 88);
  light(between(-30, W + 30), between(-20, H + 20), rad,
    r() > 0.48 ? pickI(WARM) : 4 + pickI(COOL),
    rad > 62 ? 3 : 2, between(0.055, 0.125));
}

/* ---- near specks: small, brighter, barely softened. These are what the eye
       reads as "in focus", and they are why the rest reads as not. ---- */
for (let i = 0; i < 96; i++) {
  const rad = between(2, 11);
  light(between(0, W), between(0, H), rad,
    r() > 0.42 ? pickI(WARM) : 4 + pickI(COOL),
    rad > 8 ? 1 : 0, between(0.30, 0.72));
}

/* ---- the lattice: faint connected points, low and to the sides, so the room
       has structure behind the data without competing with it. ---- */
const nodes = [];
for (let i = 0; i < 58; i++) {
  // Across the WHOLE frame. The first version pinned these to the left and
  // right edges below the halfway line, which left the middle and the bottom
  // right visibly empty once the image was cropped to a wide viewport.
  nodes.push({ x: between(0, W), y: between(0, H) });
}
const lines = [];
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
    if (d < 178) {
      lines.push(
        `<line x1="${nodes[i].x.toFixed(0)}" y1="${nodes[i].y.toFixed(0)}" ` +
        `x2="${nodes[j].x.toFixed(0)}" y2="${nodes[j].y.toFixed(0)}" ` +
        `stroke="#8FB0A2" stroke-width="0.7" opacity="${(0.10 - d / 178 * 0.062).toFixed(3)}"/>`
      );
    }
  }
}
const dots = nodes.map((n) =>
  `<circle cx="${n.x.toFixed(0)}" cy="${n.y.toFixed(0)}" r="${between(1, 2.4).toFixed(1)}" ` +
  `fill="${r() > 0.66 ? '#F2B23C' : '#8FB0A2'}" opacity="${between(0.16, 0.42).toFixed(3)}"/>`
).join('\n    ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
     width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
  <!-- TRU HQ field. Generated and deterministic; see web/tools/field.mjs.
       Softness scales with size on purpose: that is the depth of field.
       No <filter> here by design - see the note at the top of the generator. -->
  <defs>
    ${defs.join('\n    ')}
  </defs>
  <g>
    ${lines.join('\n    ')}
    ${dots}
  </g>
  <g>
    ${lights.join('\n    ')}
  </g>
</svg>
`;

const out = process.argv[2];
writeFileSync(out, svg);
console.log(`wrote ${out} — ${(svg.length / 1024).toFixed(1)} KB, ${lights.length} lights, ${lines.length} lattice lines, 0 filters`);
