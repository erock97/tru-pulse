/**
 * Numbers that roll.
 *
 * A counting tween was the first attempt and it was wrong in a specific way:
 * to get from 398 to 210 it draws every number in between, so for six hundred
 * milliseconds the tile is showing figures that are not true of anything. On a
 * page whose rule is that every number traces to a real loader, inventing three
 * hundred fake ones on the way to a real one is a strange thing to do.
 *
 * An odometer does not do that. Each digit is a column of ten, and changing the
 * value slides the column. The digits that did not change do not move at all —
 * 398 to 390 rolls one wheel and leaves the other two standing, which is
 * exactly the reading you want: almost nothing changed. Going 398 to 210 rolls
 * all three, and you feel the size of the change in how much of the tile moves.
 *
 * The columns settle right to left, a few milliseconds apart, because that is
 * the order a mechanical counter carries in and the eye already knows it.
 *
 * Every character is an inline-block of the same height, digits and separators
 * alike, so `1 : 15` keeps one baseline instead of the digits floating against
 * the colon.
 */

import { useReducedMotion } from '../lib/deckMotion';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** A bare space between two inline-blocks collapses to nothing, which is how
 *  "1 : 15" came out as "1:15". */
const SPACE = ' ';

export function Odometer({
  value, prefix = '', suffix = '', empty = '—',
}: {
  value: number | null;
  prefix?: string;
  suffix?: string;
  /** Zero is a number. Null is not, and gets this instead of rolling to zero. */
  empty?: string;
}) {
  const reduced = useReducedMotion();
  if (value === null) return <span className="od">{empty}</span>;

  const text = `${prefix}${Math.round(value)}${suffix}`;
  const chars = [...text];

  /* Every wheel carries all ten digits, so the accessible name has to be
     STATED rather than read off the DOM — otherwise a screen reader announces
     "zero one two three four five six seven eight nine" once per digit. The
     wheels are hidden and the real figure is given here. */
  return (
    <span className="od" role="img" aria-label={text}>
      {chars.map((c, i) => {
        const digit = DIGITS.indexOf(c);
        // Keyed from the RIGHT so a number that gains a digit slides its
        // existing wheels along instead of re-labelling every one of them.
        const fromRight = chars.length - 1 - i;
        if (digit < 0) {
          return (
            <span className="od-c" key={`s${fromRight}`} aria-hidden>
              {c === ' ' ? SPACE : c}
            </span>
          );
        }
        return (
          <span className="od-c od-d" key={`d${fromRight}`} aria-hidden>
            <b
              style={{
                transform: `translateY(${-digit * 10}%)`,
                transitionDelay: reduced ? '0ms' : `${Math.min(fromRight, 5) * 34}ms`,
              }}
            >
              {DIGITS.map((d) => <i key={d}>{d}</i>)}
            </b>
          </span>
        );
      })}
    </span>
  );
}
