/** Shared by offline evidence adoption and forward event interpretation. */
export const HISTORY_POLICY = 'truehq-exact-sources-2026-v1';
export const HISTORY_START = '2026-01-01T08:00:00.000Z';
export const HISTORY_SOURCES = ['Zillow', 'Zillow Preferred', 'Zillow Premier Agent', 'Zillow Flex', 'Realtor.com', 'realtordotcom', 'Realtor.com MVIP', 'Market VIP via Opcity BLA'] as const;
export function normalizeSource(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}
export function classifyHistorySource(value: unknown): 'eligible' | 'excluded' | 'review' {
  const label = normalizeSource(value);
  if (HISTORY_SOURCES.some(source => normalizeSource(source) === label)) return 'eligible';
  if (!label) return 'review';
  if (/\brentals?\b/.test(label)) return 'excluded';
  if (/zillow|realtor|opcity/.test(label) && !/upnest/.test(label)) return 'review';
  return 'excluded';
}
/** Reject timestamps without an offset: host timezone must never define coverage. */
export function historyTime(value: unknown): number {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('An explicit timestamp and offset are required');
  return Date.parse(value);
}
export type HistoryInterval = {from: string; through: string};
/** Half-open intervals [from, through); adjacent receipts form continuous coverage. */
export function missingIntervals(request: HistoryInterval, receipts: HistoryInterval[]): HistoryInterval[] {
  let cursor = historyTime(request.from);
  const end = historyTime(request.through);
  if (cursor >= end) throw Error('Invalid history interval');
  const missing: HistoryInterval[] = [];
  for (const [from, through] of receipts.map(r => [historyTime(r.from), historyTime(r.through)]).sort((a,b) => a[0]-b[0])) {
    if (from >= through) throw Error('Invalid receipt interval');
    if (through <= cursor || from >= end) continue;
    if (from > cursor) missing.push({from:new Date(cursor).toISOString(), through:new Date(Math.min(from,end)).toISOString()});
    cursor = Math.max(cursor, Math.min(through,end));
  }
  if (cursor < end) missing.push({from:new Date(cursor).toISOString(), through:new Date(end).toISOString()});
  return missing;
}
