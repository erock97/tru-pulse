// Pure scheduling arithmetic. Only busy intervals leave the Google adapter.
import { checkRules, checkTypeFields } from './booking.js';
export type Busy = { start: string; end: string };
export type Meeting = { id: string; user_id: string; slug: string; name: string; published: boolean; is_public: boolean; duration_minutes: number; buffer_minutes?: number | null; lead_minutes?: number | null; horizon_days?: number | null };
export type Rules = { timezone: string; hours: { weekday: number; start: string; end: string }[]; blocks?: { weekdays: number[]; start: string; end: string }[]; buffer_minutes: number; lead_minutes: number; horizon_days: number; slot_minutes: number };
const MIN = 60000, DAY = 86400000;
const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function validateRules(rules: Rules, type: Meeting) {
  if (typeof rules.timezone !== 'string' || !rules.timezone.trim()) throw new Error('Missing scheduling timezone');
  if (checkRules(rules) || checkTypeFields(type as unknown as Record<string, unknown>, false)) throw new Error('Invalid scheduling configuration');
  for (const k of ['buffer_minutes', 'lead_minutes', 'horizon_days'] as const) if (!Number.isInteger(rules[k])) throw new Error('Incomplete scheduling configuration');
  if (rules.horizon_days < 1 || new Set(rules.hours.map(h => h.weekday)).size !== rules.hours.length) throw new Error('Ambiguous scheduling configuration');
  if (rules.blocks?.some(b => !Array.isArray(b.weekdays) || !b.weekdays.length || b.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error('Invalid blocked weekdays');
  new Intl.DateTimeFormat('en-US', { timeZone: rules.timezone }).format();
}
function clock(zone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map(p => [p.type, p.value]));
    const date = `${p.year}-${p.month}-${p.day}`;
    return { date, weekday: (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7, minute: Number(p.hour) * 60 + Number(p.minute) };
  };
}
export function slotChecker(rules: Rules, type: Meeting, busy: Busy[], now: number) {
  validateRules(rules, type);
  const local = clock(rules.timezone);
  const duration = type.duration_minutes, buffer = Math.max(rules.buffer_minutes, type.buffer_minutes ?? 0);
  const lead = Math.max(rules.lead_minutes, type.lead_minutes ?? 0);
  const horizon = Math.min(rules.horizon_days, type.horizon_days ?? rules.horizon_days);
  const blocked = busy.map(b => ({ start: Date.parse(b.start) - buffer * MIN, end: Date.parse(b.end) + buffer * MIN }));
  if (blocked.some(b => !Number.isFinite(b.start) || !Number.isFinite(b.end) || b.end <= b.start)) throw new Error('Invalid busy response');
  return (start: number, end: number) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== duration * MIN || start < now + lead * MIN || end > now + horizon * DAY || start % MIN !== 0) return false;
    const s = local(start), e = local(end);
    const h = rules.hours.find(h => h.weekday === s.weekday);
    if (!h || s.date !== e.date || e.minute - s.minute !== duration || s.minute < minute(h.start) + buffer || e.minute > minute(h.end) - buffer) return false;
    const step = Math.min(duration, 60);
    if ((s.minute % 60) % step !== 0) return false;
    if (rules.blocks?.some(b => b.weekdays.includes(s.weekday) && s.minute < minute(b.end) + buffer && e.minute > minute(b.start) - buffer)) return false;
    return !blocked.some(b => start < b.end && end > b.start);
  };
}
export function availableSlots(rules: Rules, type: Meeting, busy: Busy[], now = Date.now(), days = 21, limit = 50): Busy[] {
  const allowed = slotChecker(rules, type, busy, now);
  const slots: Busy[] = [];
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  // Quarter-hour timezone offsets are supported; one-minute increments remain
  // necessary for unusual durations such as 17 minutes.
  const increment = gcd(gcd(type.duration_minutes, 60), 15) * MIN;
  const endWindow = now + Math.min(days, rules.horizon_days, type.horizon_days ?? 365) * DAY;
  let cursor = Math.ceil((now + Math.max(rules.lead_minutes, type.lead_minutes ?? 0) * MIN) / increment) * increment;
  while (cursor + type.duration_minutes * MIN <= endWindow && slots.length < limit) {
    const end = cursor + type.duration_minutes * MIN;
    if (allowed(cursor, end)) { slots.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() }); cursor = end; }
    else cursor += increment;
  }
  return slots;
}
