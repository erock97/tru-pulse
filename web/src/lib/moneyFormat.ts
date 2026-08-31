/**
 * Month and dollar formatting shared by the money console and the public
 * broker confirm page. Tiny on purpose: everything here is display-only.
 * The one rule that matters — overview figures are whole dollars, invoice
 * amounts are cents with preformatted labels — lives with the api types;
 * nothing in this file converts between the two.
 */

export const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "March 2026". Month is 1-based, like everything the worker speaks. */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month] ?? ''} ${year}`.trim();
}

/** Walk a (year, month) pair by whole months, either direction. */
export function monthShift(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

/** Options for a "which month did it actually close?" select, offsets around
 *  an anchor month. Value is "YYYY-M" (unpadded, split with Number() on read). */
export function monthOptions(
  year: number, month: number, from: number, to: number,
): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let i = from; i <= to; i++) {
    const s = monthShift(year, month, i);
    out.push({ value: `${s.year}-${s.month}`, label: monthLabel(s.year, s.month) });
  }
  return out;
}

/** Whole dollars with thousands separators: 4250 → "$4,250". */
export function money(n: number | null | undefined): string {
  return `$${Math.round(n || 0).toLocaleString('en-US')}`;
}

/** The current month as an <input type="month"> value, e.g. "2026-08". */
export function currentYm(): string {
  const now = new Date();
  const mm = now.getMonth() + 1;
  return `${now.getFullYear()}-${mm < 10 ? '0' : ''}${mm}`;
}

/** "2026-08" → { year, month }, or null if it isn't one. */
export function parseYm(ym: string): { year: number; month: number } | null {
  const m = ym.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!(month >= 1 && month <= 12)) return null;
  return { year, month };
}

/** "2026-07-04" → "Jul 4" — the short stamp on a sent-to-broker flag. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_NAMES[d.getMonth() + 1].slice(0, 3)} ${d.getDate()}`;
}
