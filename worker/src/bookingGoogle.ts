import type { Env } from './env.js';
import { getSecret } from './infisical.js';
import type { Busy, Meeting } from './bookingAvailability.js';

export const BOOKING_OWNER = 'd6b9504c-f35e-49c9-af99-6a2de2069db8';
export const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
export type BookingRow = { id: string; user_id: string; meeting_type_id: string; status: string; starts_at: string; ends_at: string; created_at: string; invitee_name: string; invitee_email: string; invitee_note?: string; calendar_event_id?: string | null };
export class GoogleCalendar {
  private token?: { value: string; until: number };
  constructor(private env: Env) {}
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token || this.token.until < Date.now()) {
      const values = await Promise.all(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].map(k => getSecret(this.env, k, '/Google')));
      if (values.some(v => !v)) throw new Error('Calendar credential unavailable');
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: values[0]!, client_secret: values[1]!, refresh_token: values[2]! }), signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error('Calendar authentication unavailable');
      const data = await res.json() as { access_token: string; expires_in: number };
      if (!data.access_token) throw new Error('Calendar authentication unavailable');
      this.token = { value: data.access_token, until: Date.now() + Math.max(60, data.expires_in - 120) * 1000 };
    }
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token.value}`, ...init.headers }, signal: AbortSignal.timeout(20000) });
    if (res.status === 401) this.token = undefined;
    return res;
  }
  async busy(start: number, end: number): Promise<Busy[]> {
    const res = await this.request('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), items: [{ id: 'primary' }] }) });
    if (!res.ok) throw new Error('Calendar availability unavailable');
    const data = await res.json() as { calendars?: Record<string, { busy?: Busy[]; errors?: unknown[] }> };
    const cal = data.calendars?.primary;
    if (!cal || cal.errors?.length || !Array.isArray(cal.busy) || cal.busy.some(b => !Number.isFinite(Date.parse(b.start)) || !Number.isFinite(Date.parse(b.end)) || Date.parse(b.end) <= Date.parse(b.start))) throw new Error('Calendar availability unavailable');
    return cal.busy.map(({ start, end }) => ({ start, end }));
  }
  // Reconcile laptop-created events as well as cloud retries. Never interpret a
  // failed lookup as permission to insert a second event.
  async find(booking: BookingRow): Promise<string | null> {
    const qs = new URLSearchParams({ privateExtendedProperty: `jarvisBookingId=${booking.id}`, maxResults: '2' });
    const res = await this.request(`${GOOGLE_EVENTS}?${qs}`);
    if (!res.ok) throw new Error('Calendar reconciliation unavailable');
    const data = await res.json() as { items?: { id: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[] };
    const found = data.items?.find(e => e.status !== 'cancelled');
    if (found && (Date.parse(found.start?.dateTime ?? '') !== Date.parse(booking.starts_at) || Date.parse(found.end?.dateTime ?? '') !== Date.parse(booking.ends_at))) throw new Error('Existing event differs from booking');
    return found?.id ?? null;
  }
  async create(booking: BookingRow, type: Meeting): Promise<string> {
    // Google event IDs accept base32hex. UUID hex is a valid subset.
    const id = 'tru' + booking.id.replace(/-/g, '').toLowerCase();
    const res = await this.request(`${GOOGLE_EVENTS}?sendUpdates=all`, { method: 'POST', body: JSON.stringify({
      id, summary: `${type.name} — ${booking.invitee_name}`.slice(0, 300),
      description: `Booked through truhq.co/book.\nName: ${booking.invitee_name}\nEmail: ${booking.invitee_email}` + (booking.invitee_note ? `\n\nWhat it's about:\n${booking.invitee_note.slice(0, 2000)}` : ''),
      start: { dateTime: booking.starts_at }, end: { dateTime: booking.ends_at },
      attendees: [{ email: booking.invitee_email }], extendedProperties: { private: { jarvisBookingId: booking.id } },
    }) });
    if (res.status === 409) { const found = await this.find(booking); if (found) return found; }
    if (!res.ok) throw new Error('Calendar event could not be created');
    const data = await res.json() as { id?: string };
    if (!data.id) throw new Error('Calendar event receipt unavailable');
    return data.id;
  }
  async remove(id: string): Promise<void> {
    const res = await this.request(`${GOOGLE_EVENTS}/${encodeURIComponent(id)}?sendUpdates=all`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error('Calendar cancellation unavailable');
  }
}
