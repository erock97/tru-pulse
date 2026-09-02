/**
 * Admin — the Calendar tab. Only a platform owner ever sees this (gated the
 * same way as Revenue and Contracts).
 *
 * This is TRU OS's booking panel rebuilt on TRU HQ's own worker
 * (/admin/calendar/*), restyled into this app's register. It administers
 * Eric's OWN scheduling system — the public page at truhq.co/book — not any
 * third-party calendar. The rules it inherits:
 *
 *   - Everything here is live the moment it saves. The panel says so where it
 *     matters (publish, the master switch) instead of burying it in a footer.
 *   - A new meeting type is created as a DRAFT, always — a slug becomes a
 *     public URL the moment it publishes, so publishing is its own step.
 *   - The weekly hours are the outer bound; a type can narrow them but never
 *     widen them. This page shows the bound, it does not blur it.
 *   - Typing a name fills the slug until the slug is edited by hand — nobody
 *     should need to know the word "slug" to make a link.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import {
  calendarOverview, createMeetingType, deleteMeetingType, saveBookingRules,
  signOutClean, updateMeetingType,
  type CalendarOverview, type MeetingType,
} from '../lib/api';

// rules.hours uses 0=Monday, matching the Python settlement engine.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const BLANK = { name: '', slug: '', description: '', minutes: '30' };

/* The slug is the tail of the public link, and it has to satisfy the same
 * regex the worker (and two check constraints under it) enforce. Derived from
 * the name so nobody has to know that; still editable, still checked on write. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

function minutesLabel(m: number | null | undefined): string {
  if (m == null) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** A booking's moment, in the calendar's own timezone — never the browser's.
 *  He reads this from hotel wifi too, and a meeting shown three hours off is
 *  a missed meeting. */
function whenLabel(iso: string, endIso: string, tz: string | null): string {
  const zone = tz || 'America/Los_Angeles';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone });
  const t1 = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone });
  const t2 = new Date(endIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone });
  return `${day} · ${t1}–${t2}`;
}

export default function AdminCalendar({
  onOpenPulse, onOpenCoach, onOpenRep,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [data, setData] = useState<CalendarOverview | undefined>(undefined);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState('');
  const [draft, setDraft] = useState(BLANK);
  /* Once the slug has been typed by hand it stops tracking the name.
   * Resets with the draft, so the next new type auto-fills again. */
  const [slugTouched, setSlugTouched] = useState(false);

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) { setData(undefined); setLoadErr(''); }
    const r = await calendarOverview();
    if (r.ok) { setData(r); setLoadErr(''); }
    else setLoadErr(r.error);
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const linkFor = useCallback(
    (t: MeetingType) => `${data?.bookingBase ?? 'https://truhq.co/book/'}?t=${t.slug}`,
    [data?.bookingBase],
  );

  async function copy(t: MeetingType) {
    try {
      await navigator.clipboard.writeText(linkFor(t));
      setCopied(t.id);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setNote("Couldn't reach the clipboard — the link is shown in full next to the button.");
    }
  }

  /* One runner: the write inside the try, `busy` released in finally, and a
   * quiet re-read either way — a failure may still mean the server's view
   * moved, and stale buttons invite a second failure. */
  async function run(write: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMessage: string) {
    setBusy(true);
    setNote('');
    try {
      const r = await write();
      if (!r.ok) { setNote(String((r as { error?: string }).error ?? "That didn't save.")); return false; }
      setNote(okMessage);
      await load(true);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function toggleBookable() {
    if (!data) return;
    const next = !data.bookable;
    await run(() => saveBookingRules({ bookable: next }),
      next ? 'Booking is on.' : 'Booking is off — the page stays up but offers no times.');
  }

  async function togglePublished(t: MeetingType) {
    await run(() => updateMeetingType({ id: t.id, published: !t.published }),
      t.published ? `"${t.name}" is no longer public.` : `"${t.name}" is live.`);
  }

  async function create() {
    const ok = await run(() => createMeetingType({
      slug: draft.slug.trim(),
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      duration_minutes: Number(draft.minutes),
    }), 'Created as a draft — nothing is public until you publish it.');
    /* Only cleared on success. Wiping the draft after a rejection would delete
     * what he typed at the exact moment he needs to correct one field of it. */
    if (ok) { setDraft(BLANK); setSlugTouched(false); }
  }

  async function remove(t: MeetingType) {
    if (!window.confirm(`Delete "${t.name}"? Its link stops working immediately. This cannot be undone.`)) return;
    await run(() => deleteMeetingType(t.id), `"${t.name}" deleted.`);
  }

  const days = useMemo(() => {
    const hours = data?.rules?.hours ?? [];
    return WEEKDAYS.map((label, d) => ({
      label,
      windows: hours.filter((h) => Number(h.weekday) === d),
    }));
  }, [data?.rules]);

  const rules = data?.rules;

  return (
    <div className="tru-dark">
      <HqShell
        orgName="TRU HQ"
        role="Platform owner"
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep }}
        isAdmin
        onOpenAdmin={() => { window.location.hash = '/admin'; }}
        onOpenTeamData={() => { window.location.hash = '/admin/targets'; }}
        onOpenRevenue={() => { window.location.hash = '/admin/revenue'; }}
        onOpenContracts={() => { window.location.hash = '/admin/contracts'; }}
        onOpenCalendar={() => { window.location.hash = '/admin/calendar'; }}
        hideTopbar
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Platform owner</span>
              <h1>Your <em>calendar</em>.</h1>
              <p className="dk-sub">
                Your own booking system — the links, the hours behind them, and what people have booked.
                Changes here are live on truhq.co/book the moment they save.
              </p>
            </div>
          </header>

          {data === undefined && !loadErr ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : loadErr ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>Couldn&apos;t load the calendar: {loadErr}</p>
            </div>
          ) : data && (
            <>
              <div className="rs-plate dk-table cal-master">
                <div>
                  <div className="cal-k">Accepting bookings</div>
                  <div className="mny-sub">
                    {data.bookable
                      ? 'Your page is offering times right now.'
                      : 'Your page is up but offers no times.'}
                  </div>
                </div>
                <button type="button" className={`mny-btn ${data.bookable ? 'yes' : ''}`} disabled={busy}
                  onClick={() => void toggleBookable()}>
                  {data.bookable ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="cal-grid">
                <div className="rs-plate dk-table cal-card">
                  <div className="cal-k">Your links</div>
                  <p className="mny-sub" style={{ marginTop: 4 }}>
                    Copy one and send it to anyone — they pick a time inside your hours.
                  </p>
                  <div className="cal-types">
                    {data.types.map((t) => (
                      <div key={t.id} className={`cal-type ${t.published ? 'live' : ''}`}>
                        <div className="cal-type-h">
                          <span className="cal-type-name">{t.name}</span>
                          <span className="cal-type-dur">{minutesLabel(t.duration_minutes)}</span>
                          <span className={`mny-chip ${t.published ? 'ok' : 'wait'}`}>{t.published ? 'live' : 'draft'}</span>
                        </div>
                        {t.description && <div className="mny-sub">{t.description}</div>}
                        <div className="cal-link">
                          <code>{linkFor(t)}</code>
                          <button type="button" className="mny-btn" onClick={() => void copy(t)}>
                            {copied === t.id ? 'Copied ✓' : 'Copy'}
                          </button>
                        </div>
                        <div className="cal-type-acts">
                          <button type="button" className="mny-link" disabled={busy} onClick={() => void togglePublished(t)}>
                            {t.published ? 'unpublish' : 'publish'}
                          </button>
                          <button type="button" className="mny-link" disabled={busy} onClick={() => void remove(t)}>
                            delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {data.types.length === 0 && <div className="mny-note">No meeting types yet.</div>}
                  </div>

                  <div className="cal-k" style={{ marginTop: 18 }}>New meeting type</div>
                  <div className="cal-new">
                    <input type="text" value={draft.name} placeholder="Name — e.g. Strategy session"
                      aria-label="Meeting name"
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        name: e.target.value,
                        slug: slugTouched ? d.slug : slugify(e.target.value),
                      }))} />
                    <input type="text" value={draft.slug} placeholder="link ending"
                      aria-label="Link ending"
                      onChange={(e) => { setSlugTouched(true); setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() })); }} />
                    <input type="number" min={5} max={480} step={5} value={draft.minutes}
                      aria-label="Minutes"
                      onChange={(e) => setDraft((d) => ({ ...d, minutes: e.target.value }))} />
                    <input type="text" value={draft.description} placeholder="Description (optional — shown on the page)"
                      aria-label="Description" className="cal-new-desc"
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
                    <button type="button" className="mny-btn yes" disabled={busy || !draft.name.trim() || !draft.slug.trim()}
                      onClick={() => void create()}>
                      Create
                    </button>
                  </div>
                  <div className="mny-note" style={{ marginTop: 6 }}>
                    The link will be {data.bookingBase}?t={draft.slug || 'strategy-session'} — created as a
                    draft, public only once you publish it.
                  </div>
                </div>

                <div className="cal-side">
                  <div className="rs-plate dk-table cal-card">
                    <div className="cal-k">Your hours</div>
                    <p className="mny-sub" style={{ marginTop: 4 }}>
                      The outer bound — no link can ever offer a time outside these.
                    </p>
                    <div className="cal-days">
                      {days.map(({ label, windows }) => (
                        <div key={label} className={`cal-day ${windows.length ? '' : 'off'}`}>
                          <span className="cal-day-n">{label}</span>
                          <span>{windows.length ? windows.map((w) => `${w.start}–${w.end}`).join(', ') : 'not bookable'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="cal-nums">
                      <span><b>{minutesLabel(rules?.slot_minutes)}</b> slots</span>
                      <span><b>{minutesLabel(rules?.buffer_minutes)}</b> buffer</span>
                      <span><b>{minutesLabel(rules?.lead_minutes)}</b> notice</span>
                      <span><b>{rules?.horizon_days ?? '—'}</b> days ahead</span>
                    </div>
                    {(rules?.blocks ?? []).map((b, i) => (
                      <div key={i} className="mny-note">blocked daily: {b.label || 'block'} {b.start}–{b.end}</div>
                    ))}
                    {data.timezone && <div className="mny-note" style={{ marginTop: 6 }}>All times {data.timezone}</div>}
                  </div>

                  <div className="rs-plate dk-table cal-card">
                    <div className="cal-k">Booked</div>
                    <p className="mny-sub" style={{ marginTop: 4 }}>What people have taken, from today forward.</p>
                    {data.upcoming.length === 0 ? (
                      <div className="mny-note">Nothing on the books.</div>
                    ) : (
                      <div className="cal-upcoming">
                        {data.upcoming.map((b) => (
                          <div key={b.id} className="cal-booking">
                            <div className="cal-booking-when">{whenLabel(b.startsAt, b.endsAt, data.timezone)}</div>
                            <div>
                              <span className="cal-type-name">{b.inviteeName || b.inviteeEmail || 'someone'}</span>
                              {b.typeName && <span className="mny-sub"> · {b.typeName}</span>}
                            </div>
                            {b.inviteeNote && <div className="mny-sub">“{b.inviteeNote}”</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {note && <div className="mny-err" style={{ marginTop: 12 }}>{note}</div>}
            </>
          )}
        </div>
      </HqShell>
    </div>
  );
}
