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

import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

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
  marks, line, lo, hi, lineLabel, onLineChange, lineName = 'the line',
}: {
  marks: readonly ScaleMark[];
  line: number;
  lo: number;
  hi: number;
  lineLabel: string;
  /* Hand this in and the line becomes something you can TAKE HOLD OF.
     Everything downstream already derives from it, so moving it re-judges the
     whole page live — who is past it, how many conversations you owe, what
     every row's tag says. See the note on the handle below. */
  onLineChange?: (next: number) => void;
  lineName?: string;
}) {
  const focus = useDeckFocus();
  const railRef = useRef<HTMLSpanElement | null>(null);
  // The flag is a REF as well as state: a fast drag can deliver a pointermove
  // in the same tick as the pointerdown, and a state read there would still be
  // `false` from the stale closure and drop the move on the floor. The state
  // copy exists only so the class can change.
  const holding = useRef(false);
  const [dragging, setDragging] = useState(false);
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
  const placed = marks.filter((m) => m.value !== null);

  /* Where the pointer is, in the axis's own units, clamped to the rail. The
     domain is fixed by the CALLER and deliberately does not depend on `line`
     — an axis that rescaled as you dragged would make the line feel like it
     was resisting you. */
  const valueAt = (clientX: number): number => {
    const rail = railRef.current;
    if (!rail) return line;
    const r = rail.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    return Math.max(Math.ceil(lo) + 1, Math.min(Math.floor(hi) - 1, Math.round(lo + f * (hi - lo))));
  };

  const onDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onLineChange) return;
    // preventDefault stops the drag from selecting the caption text — and it
    // also stops the handle taking focus, so focus has to be asked for. Without
    // that line the arrow keys silently did nothing after a click, which is the
    // worst kind of broken: it looks fine.
    e.preventDefault();
    e.currentTarget.focus();
    // Capture, so the drag survives leaving the 46px-tall rail — which on a
    // control this thin is what happens on essentially every drag.
    e.currentTarget.setPointerCapture(e.pointerId);
    holding.current = true;
    setDragging(true);
    onLineChange(valueAt(e.clientX));
  };
  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onLineChange || !holding.current) return;
    onLineChange(valueAt(e.clientX));
  };
  const onUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!holding.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    holding.current = false;
    setDragging(false);
  };
  const onKey = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!onLineChange) return;
    const step = e.shiftKey ? 5 : 1;
    const bounds = (v: number) => Math.max(Math.ceil(lo) + 1, Math.min(Math.floor(hi) - 1, v));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); onLineChange(bounds(line - step)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); onLineChange(bounds(line + step)); }
  };

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
      <span className="sm-rail" ref={railRef} aria-hidden />
      <span className="sm-axis" aria-hidden><span>{lo}</span><span>{Math.round((lo + hi) / 2)}</span><span>{hi}</span></span>
      {/* Rep's line is the finish, which sits at the far right — so past
          halfway the line labels itself leftward, exactly as a dot does,
          rather than hanging its caption off the end of the card.

          On Pulse it is also a HANDLE. The threshold every agent on this page
          is judged against was a constant baked into the page; drag it and the
          whole deck re-judges itself live — the dots re-tone, the eyebrow
          re-counts, the priority rows change, every row's tag rewrites. It is
          the difference between a dashboard reporting a rule and an instrument
          for asking what a different rule would mean. Nothing is written
          anywhere: this is a question, not a setting. */}
      <span
        className={[
          'sm-line',
          at(line) > 58 ? 'flip' : '',
          onLineChange ? 'is-grab' : '',
          dragging ? 'is-dragging' : '',
        ].filter(Boolean).join(' ')}
        style={{ left: `${at(line)}%` }}
        role={onLineChange ? 'slider' : undefined}
        tabIndex={onLineChange ? 0 : undefined}
        aria-label={onLineChange ? `Move ${lineName}` : undefined}
        aria-valuemin={onLineChange ? Math.ceil(lo) + 1 : undefined}
        aria-valuemax={onLineChange ? Math.floor(hi) - 1 : undefined}
        aria-valuenow={onLineChange ? line : undefined}
        aria-hidden={onLineChange ? undefined : true}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <b>{lineLabel}</b>
        {onLineChange && <s className="sm-grip" aria-hidden />}
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
