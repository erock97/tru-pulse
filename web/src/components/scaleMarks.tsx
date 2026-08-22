/**
 * The marks — what a lead tile carries now that the drawn artwork is gone.
 *
 * One dot per agent on a single scale, and the line you judge them against.
 * That is the whole thing. No rays, no rings, no hairline lattice: those were
 * the "scribbles", and they were scribbles because fine drawn lines crushed
 * into a card cannot look like anything else.
 *
 * The beauty comes from the room behind the card. The card's job is to be
 * true. Every dot here is an agent at their real number, and the only reason
 * anything is coloured is that it crossed a threshold you set.
 *
 * All three deck pages use it now, on three different axes, because the
 * reading is the same gesture every time — where does this person sit, and who
 * is past the line:
 *
 *   Pulse  leads per contract, against your line
 *   Coach  days since a 1:1, against your cadence
 *   Rep    modules cleared, against the full programme
 *
 * Coach and Rep were carrying captions that described pictures — "rings are 7,
 * 14 and 30 days", "every dot is an agent, every mark a module" — over an
 * empty card. They have the picture now, and it is this one rather than a
 * second and third kind of chart.
 *
 * TWO things move. A dot travels rather than jumping when the window changes,
 * and the dot the page is pointing at swells and says its name. Both are done
 * with `transform` alone: a dot is placed by a translate measured in `cqw`
 * (one percent of the rail's own width), so its position is a compositor
 * property rather than a layout one. Animating `left` on ten dots would
 * relayout the card on every frame of every change.
 */

import type { CSSProperties } from 'react';

import { useDeckFocus } from './deckFocus';

export interface ScaleMark {
  key: string;
  /** Where it sits on the scale, in the scale's own units. */
  value: number | null;
  /** past-line | behind | holding | no-volume, in the room's vocabulary. */
  tone: 'bad' | 'warn' | 'ok' | 'none';
  /** Who it is. Shown only while this dot is the one being pointed at. */
  label?: string;
  /** Their number, in the axis's own words — "1 : 34", "22d", "3 of 4". */
  reading?: string;
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
  const focus = useDeckFocus();
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
  const placed = marks.filter((m) => m.value !== null);
  if (placed.length === 0) return null;

  /* People who land on the same number stack upward instead of hiding each
     other. This is not decoration: on Rep, three dots piled at module two is a
     fact about MODULE TWO, not about three agents — and drawn flat it looked
     like one person and two missing ones. Pulse had the same silent overlap
     wherever two agents converted at the same rate.

     Sorted by value first, so the walk only ever has to compare against the
     one before it. */
  const stacked = [...placed]
    .sort((a, b) => (a.value as number) - (b.value as number))
    .map((m, i, all) => ({ m, x: at(m.value as number), i, all }))
    .reduce<Array<{ m: ScaleMark; x: number; lift: number }>>((out, { m, x }) => {
      const prev = out[out.length - 1];
      // 2.2% of the rail is about one dot's width on a lead tile, so anything
      // closer than that would overlap rather than sit beside.
      const lift = prev && Math.abs(prev.x - x) < 2.2 ? prev.lift + 1 : 0;
      out.push({ m, x, lift });
      return out;
    }, []);

  const anyOn = focus.active !== null && placed.some((m) => m.key === focus.active);

  return (
    <span className={`sm-scale${anyOn ? ' is-focused' : ''}`}>
      <span className="sm-rail" aria-hidden />
      {/* Rep's line is the finish, which sits at the far right — so past
          halfway the line labels itself leftward, exactly as a dot does,
          rather than hanging its caption off the end of the card. */}
      <span
        className={`sm-line${at(line) > 58 ? ' flip' : ''}`}
        style={{ left: `${at(line)}%` }}
        aria-hidden
      >
        <b>{lineLabel}</b>
      </span>
      {stacked.map(({ m, x, lift }, i) => {
        const on = focus.active === m.key;
        return (
          <span
            key={m.key}
            className={[
              'sm-dot',
              on ? 'is-on' : '',
              focus.pinned === m.key ? 'is-pinned' : '',
              // A dot past halfway would hang its own name off the end of the
              // card, so that one labels itself to the left instead.
              x > 58 ? 'flip' : '',
            ].filter(Boolean).join(' ')}
            style={{
              '--at': x,
              '--lift': lift,
              // Its place in the running order, so the scale populates left to
              // right after the tile has landed rather than all at once.
              '--n': i,
              color: TONE[m.tone],
              background: TONE[m.tone],
            } as CSSProperties}
            onMouseEnter={() => focus.point(m.key)}
            onMouseLeave={() => focus.point(null)}
          >
            {m.label && (
              <b className="sm-flag" aria-hidden>
                {m.label}
                {m.reading && <s>{m.reading}</s>}
              </b>
            )}
          </span>
        );
      })}
    </span>
  );
}
