/**
 * The Trinity — the room's own structure, behind every page.
 *
 * Three points and the arcs between them. Not decoration: the arcs run in the
 * direction the work actually flows, and light travels along them.
 *
 *   Pulse  →  who you need to talk to
 *   Coach  →  the conversation you have with them
 *   Rep    →  what you train them on afterwards
 *   ↳ back to Pulse, because it changes what the numbers say next week
 *
 * The node for wherever you are standing is lit and the other two sit back,
 * so the backdrop quietly answers "where am I" as well as "what is this".
 *
 * Two rules keep it from becoming the generic three-circles-and-lines graphic
 * that every AI-designed dashboard has: the points are placed asymmetrically
 * rather than as a tidy triangle, and the connections are arcs with something
 * travelling along them. A straight line between two dots says "related". A
 * curve with light moving down it says "this feeds that".
 *
 * ── Why it is built this way ────────────────────────────────────────────────
 * The first version put everything in one SVG scaled with `slice`. On a wide
 * monitor that blew the figure up so far past the viewport that ALL THREE
 * nodes landed off screen and only stray arc fragments showed.
 *
 * So the two halves are separated by what each needs:
 *   - the NODES are positioned in percentages, so they are always on screen
 *     and always perfectly round whatever the window's aspect ratio
 *   - the ARCS live in an SVG with preserveAspectRatio="none", whose viewBox
 *     is 0..100 in both axes — the same percentages — so the curves always
 *     land exactly on the nodes. Stretching an abstract curve costs nothing;
 *     stretching a circle would be obvious.
 *
 * Cost: three divs, three paths, one dash animation. No canvas, no JS loop,
 * nothing recalculated on scroll or resize.
 */

export type TrinityNode = 'pulse' | 'coach' | 'rep';

/** Percentages of the viewport. Deliberately not a symmetric triangle. */
const P: Record<TrinityNode, { x: number; y: number }> = {
  pulse: { x: 15, y: 24 },
  coach: { x: 86, y: 44 },
  rep: { x: 41, y: 87 },
};

/** Bowed off the straight line so the loop reads as a circuit, not a diagram. */
function arc(a: { x: number; y: number }, b: { x: number; y: number }, bow: number) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return `M ${a.x} ${a.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x} ${b.y}`;
}

const LEGS = [
  { key: 'pulse-coach', d: arc(P.pulse, P.coach, 13), delay: '0s' },
  { key: 'coach-rep', d: arc(P.coach, P.rep, 13), delay: '-7s' },
  { key: 'rep-pulse', d: arc(P.rep, P.pulse, 13), delay: '-14s' },
];

export function Trinity({ active }: { active: TrinityNode }) {
  return (
    <div className="trinity" aria-hidden>
      <svg className="trinity-web" viewBox="0 0 100 100" preserveAspectRatio="none">
        {LEGS.map((l) => <path key={l.key} className="trinity-leg" d={l.d} />)}
        {LEGS.map((l) => (
          <path key={`${l.key}-run`} className="trinity-run" d={l.d} style={{ animationDelay: l.delay }} />
        ))}
      </svg>

      {(Object.keys(P) as TrinityNode[]).map((k) => (
        <span
          key={k}
          className={k === active ? 'trinity-node on' : 'trinity-node'}
          style={{ left: `${P[k].x}%`, top: `${P[k].y}%` }}
        >
          <i className="trinity-glow" />
          <i className="trinity-ring" />
          <i className="trinity-core" />
        </span>
      ))}
    </div>
  );
}
