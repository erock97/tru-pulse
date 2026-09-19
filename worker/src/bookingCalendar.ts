import type { Env } from './env.js';
import { db } from './db.js';
import { availableSlots, slotChecker, validateRules, type Busy, type Meeting, type Rules } from './bookingAvailability.js';
import { BOOKING_OWNER, GOOGLE_EVENTS, GoogleCalendar, type BookingRow } from './bookingGoogle.js';

const HOUR = 3600000, DAY = 86400000;
type Snapshot = { busy: Busy[]; updated: number; through: number };
type Watch = { id: string; token: string; resourceId?: string; expiration: number };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// One serialized settlement lane for the explicitly mapped legacy host. A
// Google-linked second owner must never fall back to these vault credentials.
export class BookingCalendar {
  private google: GoogleCalendar;
  private lane: Promise<unknown> = Promise.resolve();
  private refreshPending?: Promise<void>;
  private tickPending?: Promise<void>;
  constructor(private state: DurableObjectState, private env: Env) { this.google = new GoogleCalendar(env); }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lane.then(fn, fn);
    this.lane = result.catch(() => {});
    return result;
  }
  private async linked() {
    const rows = await db(this.env).select('booking_calendar_links', `select=provider,status&owner_id=eq.${BOOKING_OWNER}&limit=1`);
    if (rows[0]?.provider !== 'infisical' || rows[0]?.status !== 'live') throw new Error('Calendar is not linked');
  }
  private async config(slug?: string) {
    const database = db(this.env);
    const [r, types] = await Promise.all([
      database.select('scheduling_availability', `select=rules,timezone&user_id=eq.${BOOKING_OWNER}&bookable=eq.true&limit=1`),
      database.select('meeting_types', `select=*&user_id=eq.${BOOKING_OWNER}${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ''}`),
    ]);
    if (!r[0]?.rules) throw new Error('Scheduling rules unavailable');
    const rules = { ...r[0].rules, timezone: r[0].rules.timezone || r[0].timezone } as Rules;
    return { rules, types: types as Meeting[] };
  }
  private async holds(start: number, end: number, except?: string): Promise<Busy[]> {
    const rows = await db(this.env).select('bookings', `select=starts_at,ends_at&user_id=eq.${BOOKING_OWNER}&status=in.(pending,confirmed)&starts_at=lt.${new Date(end).toISOString()}&ends_at=gt.${new Date(start).toISOString()}${except ? `&id=neq.${except}` : ''}&limit=10000`);
    if (rows.length >= 10000) throw new Error('Reservation window too large');
    return rows.map(b => ({ start: b.starts_at, end: b.ends_at }));
  }
  private refresh(): Promise<void> {
    if (this.refreshPending) return this.refreshPending;
    this.refreshPending = (async () => {
      await this.linked();
      const now = Date.now(), through = now + 63 * DAY;
      const busy = await this.google.busy(now - DAY, through);
      await this.state.storage.put('snapshot', { busy, updated: Date.now(), through } satisfies Snapshot);
    })().finally(() => { this.refreshPending = undefined; });
    return this.refreshPending;
  }
  private async ensureWatch() {
    const current = await this.state.storage.get<Watch>('watch');
    if (current && current.resourceId && current.expiration > Date.now() + DAY) return;
    const pending: Watch = { id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(), expiration: Date.now() + 7 * DAY };
    // Google can send the initial sync message before watch() returns.
    await this.state.storage.put('pendingWatch', pending);
    const res = await this.google.request(`${GOOGLE_EVENTS}/watch`, { method: 'POST', body: JSON.stringify({
      id: pending.id, token: pending.token, type: 'web_hook', address: 'https://api.truhq.co/calendar-public/google-push', params: { ttl: '604800' },
    }) });
    if (!res.ok) throw new Error('Calendar push registration unavailable');
    const data = await res.json() as { resourceId?: string; expiration?: string };
    if (!data.resourceId || !Number.isFinite(Number(data.expiration))) throw new Error('Calendar push receipt unavailable');
    const watch = { ...pending, resourceId: data.resourceId, expiration: Number(data.expiration) };
    await this.state.storage.put('watch', watch);
    await this.state.storage.delete('pendingWatch');
    if (current?.resourceId) {
      await this.google.request('https://www.googleapis.com/calendar/v3/channels/stop', { method: 'POST', body: JSON.stringify({ id: current.id, resourceId: current.resourceId }) }).catch(() => {});
    }
  }
  private async patchBooking(id: string, filter: string, patch: Record<string, unknown>): Promise<BookingRow[]> {
    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}&user_id=eq.${BOOKING_OWNER}&${filter}`, {
      method: 'PATCH', headers: { apikey: this.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('Booking transition unavailable');
    return res.json();
  }
  private async confirm(b: BookingRow, eventId: string) {
    const rows = await this.patchBooking(b.id, 'status=eq.pending', { status: 'confirmed', calendar_event_id: eventId, settling_at: null });
    if (!rows.length) {
      // Cancellation may win while Google is answering. Keep the event in a
      // durable outbox until removal succeeds, even if this process dies.
      await this.google.remove(eventId);
    }
    await this.state.storage.delete(`intent:${b.id}`);
  }
  private async settle(b: BookingRow, rules: Rules, type?: Meeting) {
    const cancel = async (reason: string) => {
      await this.patchBooking(b.id, 'status=eq.pending', { status: 'cancelled', cancelled_reason: reason, settling_at: null });
    };
    try {
      // Reconcile FIRST: an earlier successful insert with a lost response is
      // our own busy interval, never a reason to reject the visitor's booking.
      const existing = await this.google.find(b);
      if (existing) { await this.confirm(b, existing); return; }
      if (!type || !type.published) { await cancel('type_unavailable'); return; }
      validateRules(rules, type);
      const start = Date.parse(b.starts_at), end = Date.parse(b.ends_at);
      if (!Number.isFinite(start) || !Number.isFinite(end)) { await cancel('booking_invalid'); return; }
      const [busy, held] = await Promise.all([this.google.busy(start - DAY, end + DAY), this.holds(start - DAY, end + DAY, b.id)]);
      if (!slotChecker(rules, type, busy.concat(held), Date.now())(start, end)) { await cancel('slot_taken'); return; }
      // A fresh database read catches a cancellation made during the live check.
      const current = await db(this.env).select('bookings', `select=status&user_id=eq.${BOOKING_OWNER}&id=eq.${b.id}&limit=1`);
      if (current[0]?.status !== 'pending') return;
      await this.state.storage.put(`intent:${b.id}`, b);
      const event = await this.google.create(b, type);
      await this.confirm(b, event);
    } catch {
      // A possibly successful Google write must be reconciled, never abandoned.
      const intent = await this.state.storage.get(`intent:${b.id}`);
      if (!intent && Date.now() - Date.parse(b.created_at) > 15 * 60000) await cancel('calendar_unreachable');
      await this.state.storage.put('lastSettlementErrorAt', Date.now());
    }
  }
  private async settleQueue() {
    await this.linked();
    const { rules, types } = await this.config();
    const database = db(this.env);
    const rows = await database.select('bookings', `select=*&user_id=eq.${BOOKING_OWNER}&status=eq.pending&order=created_at.asc&limit=10`);
    const cutoff = new Date(Date.now() - 3 * 60000).toISOString();
    for (const b of rows as BookingRow[]) {
      const claimed = await this.patchBooking(b.id, `status=eq.pending&or=(settling_at.is.null,settling_at.lt.${cutoff})`, { settling_at: new Date().toISOString() });
      if (claimed.length) await this.settle(b, rules, types.find(t => t.id === b.meeting_type_id));
    }
    const cancelled = await database.select('bookings', `select=*&user_id=eq.${BOOKING_OWNER}&status=eq.cancelled&calendar_event_id=not.is.null&limit=20`);
    for (const b of cancelled as BookingRow[]) {
      await this.google.remove(b.calendar_event_id!);
      await this.patchBooking(b.id, 'status=eq.cancelled', { calendar_event_id: null });
    }
    const intents = await this.state.storage.list<BookingRow>({ prefix: 'intent:' });
    for (const [key, b] of intents) {
      const current = await database.select('bookings', `select=status&user_id=eq.${BOOKING_OWNER}&id=eq.${b.id}&limit=1`);
      if (current[0]?.status === 'cancelled' || !current.length) {
        const event = await this.google.find(b);
        if (event) await this.google.remove(event);
        await this.state.storage.delete(key);
      } else if (current[0]?.status === 'confirmed') await this.state.storage.delete(key);
    }
    if (rows.length || cancelled.length || intents.size) await this.refresh();
  }
  private tick(): Promise<void> {
    if (this.tickPending) return this.tickPending;
    this.tickPending = this.serial(async () => {
      try { await this.settleQueue(); await this.state.storage.put('lastSettlementAt', Date.now()); }
      catch { await this.state.storage.put('lastSettlementErrorAt', Date.now()); }
    }).finally(() => { this.tickPending = undefined; });
    return this.tickPending;
  }
  async alarm() {
    if (!await this.state.storage.get('active')) return;
    // Install the next alarm first; a failed upstream must not stop the clock.
    await this.state.storage.setAlarm(Date.now() + 60000);
    await this.tick();
    const snapshot = await this.state.storage.get<Snapshot>('snapshot');
    try {
      if (!snapshot || Date.now() - snapshot.updated >= HOUR) await this.refresh();
      await this.ensureWatch();
      await this.state.storage.put('lastAlarmAt', Date.now());
    } catch { await this.state.storage.put('lastRefreshErrorAt', Date.now()); }
  }
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (path === '/status') {
        const s = await this.state.storage.get<Snapshot>('snapshot'), w = await this.state.storage.get<Watch>('watch');
        return json({ active: !!await this.state.storage.get('active'), cachedAt: s?.updated, cachedThrough: s?.through, watchRegistered: !!w?.resourceId, watchExpiresAt: w?.expiration, nextAlarmAt: await this.state.storage.getAlarm(), lastAlarmAt: await this.state.storage.get('lastAlarmAt'), lastPushAt: await this.state.storage.get('lastPushAt'), lastSettlementAt: await this.state.storage.get('lastSettlementAt'), lastSettlementErrorAt: await this.state.storage.get('lastSettlementErrorAt') });
      }
      if (path === '/prepare') {
        await this.refresh();
        await this.ensureWatch();
        return json({ ready: true });
      }
      if (path === '/activate') {
        await this.refresh();
        await this.ensureWatch();
        await this.state.storage.put('active', true);
        await this.state.storage.setAlarm(Date.now() + 1000);
        return json({ active: true });
      }
      if (path === '/pause') {
        await this.state.storage.put('active', false);
        await this.state.storage.deleteAlarm();
        return json({ active: false });
      }
      if (path === '/push') {
        const candidates = [await this.state.storage.get<Watch>('watch'), await this.state.storage.get<Watch>('pendingWatch')];
        const w = candidates.find(w => w && w.id === req.headers.get('x-goog-channel-id') && w.token === req.headers.get('x-goog-channel-token') && (!w.resourceId || w.resourceId === req.headers.get('x-goog-resource-id')));
        if (!w) return json({ error: 'Invalid notification' }, 403);
        await this.state.storage.put('lastPushAt', Date.now());
        this.state.waitUntil(this.refresh().catch(() => this.state.storage.put('lastRefreshErrorAt', Date.now())));
        return new Response(null, { status: 204 });
      }
      if (path === '/wake') {
        if (await this.state.storage.get('active')) this.state.waitUntil(this.tick());
        return json({ accepted: true });
      }
      if (path === '/slots') {
        const { slug, days = 21 } = await req.json() as { slug: string; days?: number };
        if (typeof slug !== 'string' || !/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(slug) || !Number.isInteger(days) || days < 1 || days > 62) return json({ error: 'Invalid booking request' }, 400);
        const { rules, types } = await this.config(slug);
        const type = types.find(t => t.published && t.is_public);
        if (!type) return json({ error: 'That booking link is not available.' }, 404);
        await this.linked();
        let snapshot = await this.state.storage.get<Snapshot>('snapshot');
        if (!snapshot || Date.now() - snapshot.updated > 2 * HOUR) {
          await this.refresh(); snapshot = await this.state.storage.get<Snapshot>('snapshot');
        } else if (Date.now() - snapshot.updated > HOUR) this.state.waitUntil(this.refresh().catch(() => {}));
        if (!snapshot) throw new Error('No availability snapshot');
        const now = Date.now();
        const held = await this.holds(now - DAY, now + (days + 1) * DAY);
        return json({ slots: availableSlots(rules, type, snapshot.busy.concat(held), now, days), updated_at: new Date(snapshot.updated).toISOString() });
      }
      return json({ error: 'Not found' }, 404);
    } catch {
      return json({ error: "We couldn't reach the calendar just now. Please try again shortly." }, 503);
    }
  }
}

export async function handleCloudBooking(req: Request, env: Env, ctx: ExecutionContext, cors: Record<string, string>): Promise<Response | null> {
  const url = new URL(req.url), path = url.pathname;
  if (!path.startsWith('/calendar-public/') && !path.startsWith('/ops/booking-calendar/')) return null;
  const reply = (res: Response) => { const headers = new Headers(res.headers); Object.entries(cors).forEach(([k, v]) => headers.set(k, v)); headers.set('Cache-Control', 'no-store'); return new Response(res.body, { status: res.status, headers }); };
  if (!env.BOOKING_CALENDAR) return reply(json({ error: 'Calendar unavailable' }, 503));
  const stub = env.BOOKING_CALENDAR.get(env.BOOKING_CALENDAR.idFromName(BOOKING_OWNER));
  if (path.startsWith('/ops/booking-calendar/')) {
    if (!env.ADMIN_TOKEN || req.headers.get('x-admin-token') !== env.ADMIN_TOKEN) return reply(json({ error: 'Unauthorized' }, 401));
    const action = path.split('/').pop()!;
    if (!['status', 'prepare', 'activate', 'pause'].includes(action) || req.method !== (action === 'status' ? 'GET' : 'POST')) return reply(json({ error: 'Not found' }, 404));
    return reply(await stub.fetch(`https://booking/${action}`, { method: req.method }));
  }
  if (req.method !== 'POST') return reply(json({ error: 'POST required' }, 405));
  if (path === '/calendar-public/google-push') return stub.fetch(new Request('https://booking/push', { method: 'POST', headers: req.headers }));
  // Public read/write abuse guard. The original edge functions retain their
  // own booking/token validation and per-visitor attempt limits.
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)))).map(b => b.toString(16).padStart(2, '0')).join('');
  const bucket = `booking-rate:${digest}:${Math.floor(Date.now() / 60000)}`;
  const count = Number(await env.SESSIONS.get(bucket) || 0);
  if (count > 100) return reply(json({ error: 'Too many requests. Please try again shortly.' }, 429));
  ctx.waitUntil(env.SESSIONS.put(bucket, String(count + 1), { expirationTtl: 120 }));
  if (Number(req.headers.get('content-length') || 0) > 12000) return reply(json({ error: 'Request too large' }, 413));
  const text = await req.text();
  if (text.length > 12000) return reply(json({ error: 'Request too large' }, 413));
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); if (!body || Array.isArray(body)) throw new Error(); } catch { return reply(json({ error: 'Invalid request' }, 400)); }
  if (path === '/calendar-public/slots') return reply(await stub.fetch('https://booking/slots', { method: 'POST', body: JSON.stringify({ slug: body.meeting_type_slug, days: body.days }) }));
  const actions: Record<string, string> = { book: 'jarvis-book', status: 'jarvis-booking-status', cancel: 'jarvis-cancel', reschedule: 'jarvis-reschedule' };
  const action = actions[path.slice('/calendar-public/'.length)];
  if (!action) return reply(json({ error: 'Not found' }, 404));
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, 'cf-connecting-ip': ip }, body: text, signal: AbortSignal.timeout(20000) });
  if (res.ok) ctx.waitUntil(stub.fetch('https://booking/wake', { method: 'POST' }).then(() => {}));
  return reply(res);
}
