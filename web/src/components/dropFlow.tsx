/**
 * THE DROP — the pipeline drawn at true scale.
 *
 * Pulse has always told you 398 leads became 27 contracts, but it told you as
 * five numbers in five separate boxes. Five boxes of similar size make a 93%
 * collapse look like five facts of equal weight. It is not five facts. It is
 * one fact, and the fact is the collapse.
 *
 * So this draws it. Height is volume, linearly and honestly — no log scale, no
 * minimum bar height, nothing that would flatter the shape. 27 out of 398 is
 * 6.8% of the height because it IS 6.8%. The ribbon narrows to almost nothing
 * on the right, and that is the point of the picture.
 *
 * What the eye lands on is the widest gap, and the widest gap is where the
 * business is actually being lost. On this team it is not the leads nobody
 * called — that is a rounding error. It is the 324 people who were worked and
 * never got as far as an offer.
 *
 * No <filter> anywhere. A full-bleed SVG with feGaussianBlur rasterises at
 * display resolution and freezes the renderer — softness is baked into gradient
 * stops instead.
 */

export interface Stage {
  key: string;
  label: string;
  value: number;
  /** What it means to have reached this stage, in the leader's language. */
  note: string;
}

const W = 1000;
const H = 300;
const PAD_T = 14;
const PAD_B = 30;

/** Smooth shoulder between two stages — a ribbon, not a staircase. */
function ribbon(pts: Array<{ x: number; y: number }>, mirrorY: (y: number) => number) {
  const top = pts.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const mx = (prev.x + p.x) / 2;
    return `C ${mx} ${prev.y} ${mx} ${p.y} ${p.x} ${p.y}`;
  }).join(' ');
  const back = [...pts].reverse().map((p, i) => {
    const y = mirrorY(p.y);
    if (i === 0) return `L ${p.x} ${y}`;
    const prev = [...pts].reverse()[i - 1];
    const mx = (prev.x + p.x) / 2;
    return `C ${mx} ${mirrorY(prev.y)} ${mx} ${y} ${p.x} ${y}`;
  }).join(' ');
  return `${top} ${back} Z`;
}

export function DropFlow({ stages }: { stages: readonly Stage[] }) {
  const top = stages[0]?.value ?? 0;
  if (!top || stages.length < 2) return null;

  const usable = H - PAD_T - PAD_B;
  const mid = PAD_T + usable / 2;
  const step = W / (stages.length - 1);
  const half = (v: number) => (v / top) * (usable / 2);

  const pts = stages.map((s, i) => ({ x: i * step, y: mid - half(s.value) }));
  const path = ribbon(pts, (y) => mid + (mid - y));

  // The losses BETWEEN stages — the whole reason the picture exists.
  const drops = stages.slice(1).map((s, i) => {
    const from = stages[i];
    const lost = from.value - s.value;
    return {
      key: s.key,
      lost,
      pct: from.value ? Math.round((lost / from.value) * 100) : 0,
      x: (i + 0.5) * step,
      // The biggest single loss gets called out; the rest stay quiet.
      worst: false as boolean,
    };
  });
  const worstIdx = drops.reduce((b, d, i) => (d.lost > drops[b].lost ? i : b), 0);
  if (drops[worstIdx]) drops[worstIdx].worst = true;

  return (
    <div className="df-wrap">
      <svg className="df-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="dfFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(143, 176, 162, 0.30)" />
            <stop offset="45%" stopColor="rgba(226, 240, 230, 0.14)" />
            <stop offset="100%" stopColor="rgba(242, 178, 60, 0.34)" />
          </linearGradient>
          <linearGradient id="dfEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(180, 214, 196, 0.55)" />
            <stop offset="100%" stopColor="rgba(247, 200, 110, 0.85)" />
          </linearGradient>
        </defs>

        {/* The volume that arrived, and what was left of it at each gate. */}
        <path d={path} fill="url(#dfFill)" stroke="url(#dfEdge)" strokeWidth="1.2"
              vectorEffect="non-scaling-stroke" />

        {/* Gate lines. Deliberately hairline: the ribbon is the subject. */}
        {pts.map((p, i) => (
          <line key={stages[i].key} x1={p.x} x2={p.x} y1={PAD_T - 6} y2={H - PAD_B + 6}
                stroke="rgba(226,240,230,0.13)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      {/* Type sits in the DOM, not the SVG — the SVG is stretched with
          preserveAspectRatio="none", which would distort any text inside it. */}
      <div className="df-gates">
        {stages.map((s, i) => (
          <div className="df-gate" key={s.key} style={{ left: `${(i / (stages.length - 1)) * 100}%` }}>
            <b>{s.value.toLocaleString()}</b>
            <span>{s.label}</span>
            <i>{s.note}</i>
          </div>
        ))}
      </div>

      <div className="df-drops">
        {drops.map((d) => (
          <div className={d.worst ? 'df-drop is-worst' : 'df-drop'} key={d.key}
               style={{ left: `${(d.x / W) * 100}%` }}>
            <b>−{d.lost.toLocaleString()}</b>
            <span>{d.pct}% lost here</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One agent's shape, small enough to scan a column of them. Same encoding as
 *  the big ribbon, so a person whose shape differs from the team's is visible
 *  without reading a single number. */
export function DropSpark({ stages, tone }: { stages: readonly number[]; tone: string }) {
  const top = stages[0];
  if (!top) return <span className="df-spark is-empty" aria-hidden />;
  const w = 100, h = 26, mid = h / 2;
  const step = w / (stages.length - 1);
  const pts = stages.map((v, i) => ({ x: i * step, y: mid - (v / top) * (mid - 1) }));
  const path = ribbon(pts, (y) => mid + (mid - y));
  return (
    <svg className="df-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={path} fill={tone} opacity="0.85" />
    </svg>
  );
}
