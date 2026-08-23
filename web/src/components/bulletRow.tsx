/**
 * THE BULLET ROW — one agent, three signals, against their targets.
 *
 * This replaces a three-ring dial, and the reason is not taste. The
 * ui-ux-pro-max chart guidance is explicit about it:
 *
 *   Gauge / dial — "When NOT to use: comparing multiple KPIs at once
 *                   (use bullet chart grid). For 3+ KPIs use bullet chart grid."
 *   Bullet chart — "When to use: dashboard with multiple KPIs side by side;
 *                   space-constrained contexts where a gauge is too large.
 *                   Ideal for 3–10 in a grid; scales to any count."
 *
 * Three concentric rings on one dial is precisely the named anti-pattern. It
 * also cannot be compared DOWN a list — the thing a leader actually does with
 * a roster — because arcs at different radii are not visually comparable, and
 * the same value looks bigger on the outer ring than the inner one.
 *
 * Two accessibility rules from the same guidance are followed here rather than
 * assumed: "place the number and target text beside the bar" (colour alone is
 * insufficient), and "label every qualitative range and target with text".
 * Each bar carries its own number and its target is a labelled marker, so the
 * chart still reads with colour removed entirely.
 */

export interface Bullet {
  key: string;
  label: string;
  /** 0..1 of the track. */
  value: number;
  /** 0..1 — where "good enough" sits. Drawn as the marker. */
  target: number;
  /** The real figure, shown as text beside the bar. */
  readout: string;
  /** Plain-language state, so meaning never rests on colour. */
  state: 'good' | 'warn' | 'bad' | 'none';
}

const TONE: Record<Bullet['state'], string> = {
  good: 'var(--sea)',
  warn: 'var(--accent)',
  bad: 'var(--ember)',
  none: 'var(--text-40)',
};

export function BulletRow({ name, sub, bullets, onOpen }: {
  name: string;
  sub?: string;
  bullets: readonly Bullet[];
  onOpen?: () => void;
}) {
  const worst = [...bullets]
    .filter((b) => b.state !== 'none')
    .sort((a, b) => (a.value - a.target) - (b.value - b.target))[0];

  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag
      className="bl-row"
      {...(onOpen ? { onClick: onOpen, type: 'button' as const } : {})}
    >
      <span className="bl-who">
        <b>{name}</b>
        {sub && <i>{sub}</i>}
      </span>

      <span className="bl-bars">
        {bullets.map((b) => (
          <span className="bl-b" key={b.key}>
            <span className="bl-b-k">{b.label}</span>
            <span className="bl-track">
              <i className="bl-fill" style={{ width: `${Math.min(100, b.value * 100)}%`, background: TONE[b.state] }} />
              {/* The target marker. Labelled in the title so it is not a
                  meaningless tick to anyone reading without colour. */}
              <i
                className="bl-target"
                style={{ left: `${Math.min(100, b.target * 100)}%` }}
                title={`target · ${b.label}`}
              />
            </span>
            <span className="bl-b-v">{b.readout}</span>
          </span>
        ))}
      </span>

      <span className="bl-verdict">
        {worst
          ? <>weakest: <b>{worst.label.toLowerCase()}</b></>
          : 'nothing measured yet'}
      </span>
    </Tag>
  );
}
