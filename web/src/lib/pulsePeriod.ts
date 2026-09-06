export type PulsePeriod = number | 'mtd' | 'ytd' | '6mo' | '2yr' | null;
/** Calendar boundaries use the viewer's local timezone, disclosed in the UI. */
export function pulseCutoff(period: PulsePeriod, now = new Date()): number | null {
  if (period === null) return null;
  if (period === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (period === 'ytd') return new Date(now.getFullYear(), 0, 1).getTime();
  if (period === '6mo') return new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
  if (period === '2yr') return new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).getTime();
  return now.getTime() - period * 86400000;
}
export function inPulsePeriod(created: string | null | undefined, period: PulsePeriod, now = new Date()): boolean {
  const time = Date.parse(created ?? '');
  const cutoff = pulseCutoff(period, now);
  return Number.isFinite(time) && time <= now.getTime() && (cutoff === null || time >= cutoff);
}
