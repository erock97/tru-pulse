import { useState } from 'react';
import type { UpcomingBooking } from '../lib/api';

export function calendarDay(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)?.value).join('-');
}
function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Only bookings returned for this authenticated account; not a full Google calendar. */
export function CalendarAgenda({ bookings, timezone }: { bookings: UpcomingBooking[]; timezone: string }) {
  const today = calendarDay(new Date().toISOString(), timezone);
  const [start, setStart] = useState(today);
  const [selected, setSelected] = useState(today);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
  const ordered = [...bookings].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const visible = ordered.filter(b => calendarDay(b.startsAt, timezone) === selected);
  const label = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const time = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const move = (amount: number) => { const next = shiftDay(start, amount); setStart(next); setSelected(next); };
  return <section className="calendar-agenda" aria-label="Scheduled bookings">
    <div className="agenda-head"><div><h2>{label(start, { month: 'long', year: 'numeric' })}</h2><p>TRU bookings · {timezone} · {bookings.length} upcoming</p></div>
      <div style={{ display: 'flex', gap: 8 }}><button className="mny-btn" aria-label="Previous seven days" onClick={() => move(-7)}>←</button><button className="mny-btn" onClick={() => { setStart(today); setSelected(today); }}>Today</button><button className="mny-btn" aria-label="Next seven days" onClick={() => move(7)}>→</button></div>
    </div>
    <div className="agenda-days">{days.map(day => {
      const count = bookings.filter(b => calendarDay(b.startsAt, timezone) === day).length;
      return <button key={day} className="agenda-day" aria-pressed={day === selected} aria-label={label(day, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={() => setSelected(day)}><span>{label(day, { weekday: 'short' })}</span><strong>{Number(day.slice(-2))}</strong><small>{count ? `${count} booked` : ''}</small></button>;
    })}</div>
    <div aria-live="polite">{visible.length ? visible.map(b => <article className="agenda-entry" key={b.id}><div>{time(b.startsAt)} – {time(b.endsAt)}</div><div><h3>{b.inviteeName || b.inviteeEmail || 'Guest'}</h3><p>{b.typeName || 'Meeting'}</p>{b.inviteeNote && <p>{b.inviteeNote}</p>}</div></article>) : <div className="agenda-empty">No TRU bookings for {label(selected, { weekday: 'long', month: 'short', day: 'numeric' })}.<br /><small>This view does not include other events on your Google calendar.</small>{ordered.some(b => calendarDay(b.startsAt, timezone) > selected) && <p><button className="mny-btn" onClick={() => { const next = ordered.find(b => calendarDay(b.startsAt, timezone) > selected); if (next) { const day = calendarDay(next.startsAt, timezone); setStart(day); setSelected(day); } }}>Go to next booking</button></p>}</div>}</div>
  </section>;
}
