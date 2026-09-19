import { beforeEach, describe, expect, it, vi } from 'vitest';
import { availableSlots, slotChecker, type Rules, type Meeting } from './bookingAvailability.js';
import { BookingCalendar, handleCloudBooking } from './bookingCalendar.js';
import { BOOKING_OWNER, GoogleCalendar, type BookingRow } from './bookingGoogle.js';
import type { Env } from './env.js';

const rules: Rules = { timezone: 'America/Los_Angeles', hours: [0, 1, 2, 3, 4].map(weekday => ({ weekday, start: '09:00', end: '16:00' })), blocks: [{ weekdays: [0,1,2,3,4], start: '12:00', end: '13:00' }], slot_minutes: 30, buffer_minutes: 30, lead_minutes: 1440, horizon_days: 30 };
const meeting: Meeting = { id: 'type', user_id: BOOKING_OWNER, slug: 'assessment', name: 'Assessment', duration_minutes: 30, published: true, is_public: true };
const now = Date.parse('2026-09-19T18:00:00Z');
const iso = (s: string) => Date.parse(s);
describe('cloud scheduling', () => {
  it('preserves working boundaries, lunch buffers and live busy buffers', () => {
    const slots = availableSlots(rules, meeting, [{ start: '2026-09-21T21:00:00Z', end: '2026-09-21T22:00:00Z' }], now, 3);
    expect(slots.filter(s => s.start.startsWith('2026-09-21')).map(s => s.start)).toEqual(['2026-09-21T16:30:00.000Z','2026-09-21T17:00:00.000Z','2026-09-21T17:30:00.000Z','2026-09-21T18:00:00.000Z']);
  });
  it('obeys DST and never uses the server timezone', () => {
    const r = { ...rules, lead_minutes: 0 };
    const slots = availableSlots(r, meeting, [], iso('2026-10-30T00:00:00Z'), 6);
    expect(slots.some(s => s.start === '2026-10-30T16:30:00.000Z')).toBe(true);
    expect(slots.some(s => s.start === '2026-11-02T17:30:00.000Z')).toBe(true);
  });
  it('uses the stricter type bounds and fails closed on missing or bad rules', () => {
    expect(availableSlots(rules, { ...meeting, horizon_days: 1 }, [], now)).toEqual([]);
    expect(() => availableSlots({ ...rules, timezone: 'bad' }, meeting, [], now)).toThrow();
    expect(() => availableSlots({ ...rules, blocks: [{ start: '12:00', end: '13:00' } as any] }, meeting, [], now)).toThrow();
    expect(() => availableSlots(rules, meeting, [{ start: 'bad', end: 'bad' }], now)).toThrow();
  });
  it('checks a selected later slot independently of the first 50 offers', () => {
    const check = slotChecker(rules, meeting, [], now);
    expect(check(iso('2026-10-09T17:00:00Z'), iso('2026-10-09T17:30:00Z'))).toBe(true);
    expect(check(iso('2026-09-21T17:15:00Z'), iso('2026-09-21T17:45:00Z'))).toBe(false);
    expect(check(iso('2026-09-21T17:00:00Z'), iso('2026-09-21T18:00:00Z'))).toBe(false);
  });
});

function fixture() {
  const values = new Map<string, any>();
  const storage = { get: vi.fn(async (k: string) => values.get(k)), put: vi.fn(async (k: string, v: any) => { values.set(k,v); }), delete: vi.fn(async (k: string) => values.delete(k)), list: vi.fn(async () => new Map([...values].filter(([k]) => k.startsWith('intent:')))), setAlarm: vi.fn(), getAlarm: vi.fn(), deleteAlarm: vi.fn() };
  const jobs: Promise<unknown>[] = [];
  const state = { storage, waitUntil: (p: Promise<unknown>) => jobs.push(p) } as unknown as DurableObjectState;
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', ADMIN_TOKEN: 'admin' } as Env;
  const obj = new BookingCalendar(state, env);
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('booking_calendar_links')) return Response.json([{ provider: 'infisical', status: 'live' }]);
    if (url.includes('scheduling_availability')) return Response.json([{ rules }]);
    if (url.includes('meeting_types')) return Response.json([meeting]);
    if (url.includes('/bookings')) {
      if (init?.method === 'PATCH') return Response.json([{ id: 'b', ...JSON.parse(init.body as string) }]);
      return Response.json([]);
    }
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', fetcher);
  return { values, storage, state, env, obj, fetcher, jobs };
}
beforeEach(() => { vi.restoreAllMocks(); });
describe('cloud cache and settlement', () => {
  it('rejects missing slugs instead of falling back to another meeting', async () => {
    const f = fixture();
    expect((await f.obj.fetch(new Request('https://booking/slots', { method: 'POST', body: '{}' }))).status).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('keeps the hourly fallback running through a Google outage', async () => {
    const f = fixture(); f.values.set('active', true); f.values.set('snapshot', { busy: [], updated: Date.now()-3600001 });
    vi.spyOn(GoogleCalendar.prototype, 'busy').mockRejectedValue(new Error('offline'));
    await f.obj.alarm();
    expect(f.storage.setAlarm).toHaveBeenCalled();
    expect(f.values.has('lastRefreshErrorAt')).toBe(true);
  });
  it('serves a warm snapshot without contacting Google and scopes all database reads', async () => {
    const f = fixture();
    f.values.set('snapshot', { busy: [], updated: Date.now(), through: Date.now()+63*86400000 });
    const busy = vi.spyOn(GoogleCalendar.prototype, 'busy');
    const res = await f.obj.fetch(new Request('https://booking/slots', { method: 'POST', body: JSON.stringify({ slug: 'assessment' }) }));
    expect(res.status).toBe(200);
    expect(busy).not.toHaveBeenCalled();
    expect(f.fetcher.mock.calls.every(([u]) => u.includes(BOOKING_OWNER))).toBe(true);
    const body = await res.json() as any;
    expect(body.slots.every((s: any) => Object.keys(s).sort().join() === 'end,start')).toBe(true);
  });
  it('does not treat a stale cache plus Google failure as free time', async () => {
    const f = fixture(); f.values.set('snapshot', { busy: [], updated: Date.now()-3*3600000 });
    vi.spyOn(GoogleCalendar.prototype, 'busy').mockRejectedValue(new Error('offline'));
    expect((await f.obj.fetch(new Request('https://booking/slots', { method: 'POST', body: JSON.stringify({ slug: 'assessment' }) }))).status).toBe(503);
  });
  it('rejects forged push notifications and refreshes an authenticated one', async () => {
    const f = fixture(); f.values.set('watch', { id: 'channel', token: 'secret', resourceId: 'resource' });
    const busy = vi.spyOn(GoogleCalendar.prototype, 'busy').mockResolvedValue([]);
    expect((await f.obj.fetch(new Request('https://booking/push', { method: 'POST' }))).status).toBe(403);
    const res = await f.obj.fetch(new Request('https://booking/push', { method: 'POST', headers: { 'x-goog-channel-id': 'channel', 'x-goog-channel-token': 'secret', 'x-goog-resource-id': 'resource' } }));
    expect(res.status).toBe(204); await Promise.all(f.jobs); expect(busy).toHaveBeenCalledTimes(1);
  });
  it('renews expiring notification channels and stops the old channel', async () => {
    const f = fixture(); f.values.set('watch', { id: 'old', token: 'old', resourceId: 'r', expiration: Date.now()+1000 });
    vi.spyOn(GoogleCalendar.prototype, 'busy').mockResolvedValue([]);
    const request = vi.spyOn(GoogleCalendar.prototype, 'request').mockResolvedValue(Response.json({ resourceId: 'new', expiration: String(Date.now()+7*86400000) }));
    expect((await f.obj.fetch(new Request('https://booking/prepare', { method: 'POST' }))).status).toBe(200);
    expect(request.mock.calls[0][0]).toContain('/watch'); expect(request.mock.calls[1][0]).toContain('/channels/stop');
    expect(f.values.get('watch').resourceId).toBe('new');
  });
  const booking = { id: '12345678-1234-1234-1234-123456789012', user_id: BOOKING_OWNER, meeting_type_id: 'type', starts_at: '2026-09-21T17:00:00Z', ends_at: '2026-09-21T17:30:00Z', created_at: new Date(now).toISOString(), status: 'pending', invitee_name: 'Test', invitee_email: 'test@example.com' } as BookingRow;
  it('reconciles a previously created event before checking busy or inserting again', async () => {
    const f = fixture();
    vi.spyOn(GoogleCalendar.prototype, 'find').mockResolvedValue('existing');
    const busy = vi.spyOn(GoogleCalendar.prototype, 'busy'); const create = vi.spyOn(GoogleCalendar.prototype, 'create');
    await (f.obj as any).settle(booking, rules, meeting);
    expect(busy).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(f.fetcher.mock.calls.some(([,i]) => i?.body?.toString().includes('"status":"confirmed"'))).toBe(true);
  });
  it('never creates an event when the live check fails', async () => {
    const f = fixture(); vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(GoogleCalendar.prototype, 'find').mockResolvedValue(null);
    vi.spyOn(GoogleCalendar.prototype, 'busy').mockRejectedValue(new Error('offline'));
    const create = vi.spyOn(GoogleCalendar.prototype, 'create');
    await (f.obj as any).settle(booking, rules, meeting); expect(create).not.toHaveBeenCalled();
    expect(f.fetcher.mock.calls.some(([,i]) => i?.body?.toString().includes('cancelled'))).toBe(false);
  });
  it('removes the event if cancellation wins while insertion is in flight', async () => {
    const f = fixture(); f.fetcher.mockResolvedValue(Response.json([]));
    f.values.set(`intent:${booking.id}`, booking);
    const remove = vi.spyOn(GoogleCalendar.prototype, 'remove').mockResolvedValue();
    await (f.obj as any).confirm(booking, 'created'); expect(remove).toHaveBeenCalledWith('created');
    expect(f.values.has(`intent:${booking.id}`)).toBe(false);
  });
  it('retains a durable cleanup intent when cancellation cleanup fails', async () => {
    const f = fixture(); f.fetcher.mockResolvedValue(Response.json([])); f.values.set(`intent:${booking.id}`, booking);
    vi.spyOn(GoogleCalendar.prototype, 'remove').mockRejectedValue(new Error('offline'));
    await expect((f.obj as any).confirm(booking, 'created')).rejects.toThrow();
    expect(f.values.has(`intent:${booking.id}`)).toBe(true);
  });
  it('requires admin authentication to activate the settlement engine', async () => {
    const f = fixture(); f.env.BOOKING_CALENDAR = { get: () => ({ fetch: vi.fn() }), idFromName: vi.fn() } as any;
    expect((await handleCloudBooking(new Request('https://api/ops/booking-calendar/activate', { method: 'POST' }), f.env, {} as ExecutionContext, {}))?.status).toBe(401);
  });
});
