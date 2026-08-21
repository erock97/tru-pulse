/**
 * The marks — what the hero tile carries now that the drawn artwork is gone.
 *
 * One dot per agent on a single scale, and your line marked on it. That is
 * the whole thing. No rays, no rings, no hairline lattice: those were the
 * "scribbles", and they were scribbles because fine drawn lines crushed into
 * a card cannot look like anything else.
 *
 * The beauty comes from the room behind the card. The card's job is to be
 * true. Every dot here is an agent at their real number, and the only reason
 * anything is coloured is that it crossed a threshold you set.
 */

export interface ScaleMark {
  key: string;
  /** Where it sits on the scale, in the scale's own units. */
  value: number | null;
  /** past-line | behind | holding | no-volume, in the room's vocabulary. */
  tone: 'bad' | 'warn' | 'ok' | 'none';
}

const TONE: Record<ScaleMark['tone'], string> = {
  bad: 'var(--ember)',
  warn: 'var(--accent)',
  ok: 'var(--sea)',
  none: 'var(--text-40)',
};

export function ScaleMarks({
  marks, line, lo, hi, lineLabel,
}: {
  marks: readonly ScaleMark[];
  line: number;
  lo: number;
  hi: number;
  lineLabel: string;
}) {
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
  const placed = marks.filter((m) => m.value !== null);
  if (placed.length === 0) return null;

  return (
    <span className="sm-scale" aria-hidden>
      <span className="sm-rail" />
      <span className="sm-line" style={{ left: `${at(line)}%` }}>
        <b>{lineLabel}</b>
      </span>
      {placed.map((m) => (
        <span
          key={m.key}
          className="sm-dot"
          style={{ left: `${at(m.value as number)}%`, background: TONE[m.tone] }}
        />
      ))}
    </span>
  );
}
