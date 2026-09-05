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
import { CalendarAgenda } from '../components/CalendarAgenda';
import {
  calendarOverview, createMeetingType, deleteMeetingType, saveBookingRules,
  setupCalendar, signOutClean, startGoogleCalendarLink, updateMeetingType,
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

/** The hours card's edit mode. Local state is a per-day copy of the windows,
 *  so a half-typed change never touches what is live; nothing saves until
 *  Save, and Save sends the WHOLE rules object — the worker refuses partial
 *  merges by design (a half-understood merge is how a lunch break silently
 *  disappears), so this editor always speaks in complete sentences. */
function HoursEditor({
  rules, busy, onSave, onCancel,
}: {
  rules: NonNullable<CalendarOverview['rules']>;
  busy: boolean;
  onSave: (rules: NonNullable<CalendarOverview['rules']>) => void;
  onCancel: () => void;
}) {
  const [byDay, setByDay] = useState<Array<Array<{ start: string; end: string }>>>(() =>
    WEEKDAYS.map((_, d) =>
      (rules.hours ?? [])
        .filter((h) => Number(h.weekday) === d)
        .map((h) => ({ start: h.start, end: h.end }))),
  );
  const [blocks, setBlocks] = useState(() => (rules.blocks ?? []).map((b) => ({ ...b })));
  const [nums, setNums] = useState(() => ({
    slot: String(rules.slot_minutes ?? 30),
    buffer: String(rules.buffer_minutes ?? 0),
    // Notice reads in hours out here — nobody thinks in 1440 minutes.
    noticeHours: String(Math.round((rules.lead_minutes ?? 0) / 60)),
    horizon: String(rules.horizon_days ?? 30),
  }));

  function setWindow(d: number, i: number, field: 'start' | 'end', value: string) {
    setByDay((prev) => prev.map((wins, day) =>
      day === d ? wins.map((w, j) => (j === i ? { ...w, [field]: value } : w)) : wins));
  }
  function addWindow(d: number) {
    setByDay((prev) => prev.map((wins, day) => (day === d ? [...wins, { start: '09:00', end: '16:00' }] : wins)));
  }
  function dropWindow(d: number, i: number) {
    setByDay((prev) => prev.map((wins, day) => (day === d ? wins.filter((_, j) => j !== i) : wins)));
  }

  function save() {
    onSave({
      // Spread first: anything in the stored rules this editor does not know
      // about (timezone, a future field) survives the round trip untouched.
      ...rules,
      hours: byDay.flatMap((wins, weekday) => wins.map((w) => ({ weekday, start: w.start, end: w.end }))),
      blocks,
      slot_minutes: Number(nums.slot),
      buffer_minutes: Number(nums.buffer),
      lead_minutes: Math.round(Number(nums.noticeHours) * 60),
      horizon_days: Number(nums.horizon),
    });
  }

  return (
    <div className="cal-edit">
      <div className="cal-days" style={{ marginTop: 12 }}>
        {WEEKDAYS.map((label, d) => (
          <div key={label} className={`cal-day ${byDay[d].length ? '' : 'off'}`}>
            <span className="cal-day-n" style={{ paddingTop: 6 }}>{label}</span>
            <span className="cal-edit-wins">
              {byDay[d].map((w, i) => (
                <span key={i} className="cal-edit-win">
                  <input type="time" value={w.start} aria-label={`${label} window ${i + 1} start`}
                    onChange={(e) => setWindow(d, i, 'start', e.target.value)} />
                  –
                  <input type="time" value={w.end} aria-label={`${label} window ${i + 1} end`}
                    onChange={(e) => setWindow(d, i, 'end', e.target.value)} />
                  <button type="button" className="mny-link" aria-label={`Remove ${label} window ${i + 1}`}
                    onClick={() => dropWindow(d, i)}>×</button>
                </span>
              ))}
              <button type="button" className="mny-link" onClick={() => addWindow(d)}>
                {byDay[d].length ? '+ add' : '+ make bookable'}
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="cal-edit-nums">
        <label>Slot length (min)
          <input type="number" min={5} max={480} step={5} value={nums.slot}
            onChange={(e) => setNums((n) => ({ ...n, slot: e.target.value }))} />
        </label>
        <label>Buffer between (min)
          <input type="number" min={0} max={240} step={5} value={nums.buffer}
            onChange={(e) => setNums((n) => ({ ...n, buffer: e.target.value }))} />
        </label>
        <label>Notice required (hrs)
          <input type="number" min={0} max={720} value={nums.noticeHours}
            onChange={(e) => setNums((n) => ({ ...n, noticeHours: e.target.value }))} />
        </label>
        <label>Bookable ahead (days)
          <input type="number" min={1} max={365} value={nums.horizon}
            onChange={(e) => setNums((n) => ({ ...n, horizon: e.target.value }))} />
        </label>
      </div>

      <div className="cal-k" style={{ marginTop: 14 }}>Daily blocks</div>
      <div className="cal-edit-blocks">
        {blocks.map((b, i) => (
          <span key={i} className="cal-edit-win">
            <input type="text" value={b.label ?? ''} placeholder="lunch" aria-label={`Block ${i + 1} label`}
              style={{ width: 90 }}
              onChange={(e) => setBlocks((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input type="time" value={b.start} aria-label={`Block ${i + 1} start`}
              onChange={(e) => setBlocks((prev) => prev.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
            –
            <input type="time" value={b.end} aria-label={`Block ${i + 1} end`}
              onChange={(e) => setBlocks((prev) => prev.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            <button type="button" className="mny-link" aria-label={`Remove block ${i + 1}`}
              onClick={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
        <button type="button" className="mny-link"
          onClick={() => setBlocks((prev) => [...prev, { label: '', start: '12:00', end: '12:30' }])}>
          + add a block
        </button>
      </div>

      <div className="cal-type-acts" style={{ marginTop: 14 }}>
        <button type="button" className="mny-btn yes" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save hours'}
        </button>
        <button type="button" className="mny-link" onClick={onCancel}>cancel</button>
      </div>
    </div>
  );
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
  const [editingHours, setEditingHours] = useState(false);
  /* Once the slug has been typed by hand it stops tracking the name.
   * Resets with the draft, so the next new type auto-fills again. */
  const [slugTouched, setSlugTouched] = useState(false);
  const [setupName, setSetupName] = useState('');

  /* The Google link flow returns by full-page redirect, carrying its outcome
   * in the query string — read it once, say it, and clean the URL so a reload
   * doesn't repeat a stale message. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('cal_linked');
    const failed = params.get('cal_link_error');
    if (!linked && !failed) return;
    setNote(linked ? 'Google Calendar linked ✓' : failed || '');
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);

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

  async function createOwnCalendar() {
    await run(() => setupCalendar({
      name: setupName.trim(),
      // The person setting up is sitting in their own timezone right now —
      // better than defaulting everyone to Pacific.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }), 'Calendar created — booking is off and all three links are drafts until you say otherwise.');
  }

  async function linkGoogle() {
    setBusy(true);
    setNote('');
    const r = await startGoogleCalendarLink();
    if (!r.ok) { setNote(r.error); setBusy(false); return; }
    // Full-page hop to Google's consent screen; it returns to this tab.
    window.location.href = r.url;
  }

  const days = useMemo(() => {
    const hours = data?.rules?.hours ?? [];
    return WEEKDAYS.map((label, d) => ({
      label,
      windows: hours.filter((h) => Number(h.weekday) === d),
    }));
  }, [data?.rules]);

  const rules = data?.rules;
  const types = data?.types ?? [];
  const upcoming = data?.upcoming ?? [];
  const linked = data?.linked === true;
  /* Publishing needs more than a link: the desk engine that answers "what
   * times are open" and writes the meeting can only serve the vault-wired
   * calendar today. The worker refuses anyway; this keeps the button honest. */
  const canPublish = linked && data?.link?.provider === 'infisical';

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
              <h1>Your calendar.</h1>
              <p className="dk-sub">
                Make room for the conversations that move your teams forward.
                Manage your bookings, meeting links, and availability here.
              </p>
            </div>
          </header>

          {data === undefined && !loadErr ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : loadErr ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>Couldn&apos;t load the calendar: {loadErr}</p>
            </div>
          ) : data && data.needsSetup ? (
            // A fresh admin login has no calendar. Nothing is inherited and
            // nothing of anyone else's shows — this creates their OWN, dark:
            // booking off and three draft links until they choose otherwise.
            <div className="rs-plate dk-table cal-card" style={{ maxWidth: 560 }}>
              <div className="cal-k">Set up your calendar</div>
              <p className="mny-sub" style={{ marginTop: 6 }}>
                This login doesn&apos;t have a calendar yet. Setting one up creates your own booking
                links and availability — separate from anyone else&apos;s. It starts switched off,
                with three draft links ready to rename or publish.
              </p>
              <div className="cal-new" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}>
                <input type="text" value={setupName} placeholder="Your first name — e.g. Adam"
                  aria-label="First name"
                  onChange={(e) => setSetupName(e.target.value)} />
                <button type="button" className="mny-btn yes" style={{ gridColumn: 'auto' }}
                  disabled={busy || !setupName.trim()}
                  onClick={() => void createOwnCalendar()}>
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </div>
              <div className="mny-note" style={{ marginTop: 8 }}>
                You&apos;ll get “1:1 with {setupName.trim().split(/\s+/)[0] || 'you'}”, “New Client
                Consultation”, and “Strategy Session” as drafts, Mon–Fri 9:00–16:00 in your timezone.
              </div>
              {note && <div className="mny-err" style={{ marginTop: 10 }}>{note}</div>}
            </div>
          ) : data && (
            <>
              <CalendarAgenda bookings={upcoming} timezone={data.timezone || 'America/Los_Angeles'} />
              <div className="dk-sec"><h2>Booking settings</h2><p>Saved changes apply to your public booking page immediately.</p></div>
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
                  aria-pressed={!!data.bookable} aria-label="Accepting new bookings"
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
                    {types.map((t) => (
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
                          <button type="button" className="mny-link" disabled={busy || (!t.published && !canPublish)}
                            title={!t.published && !canPublish
                              ? (linked
                                ? 'Linked — publishing unlocks once the booking engine can serve this calendar.'
                                : 'Link your Google calendar first — a published link books real meetings.')
                              : undefined}
                            onClick={() => void togglePublished(t)}>
                            {t.published ? 'unpublish' : 'publish'}
                          </button>
                          <button type="button" className="mny-link" disabled={busy} onClick={() => void remove(t)}>
                            delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {types.length === 0 && <div className="mny-note">No meeting types yet.</div>}
                    {!canPublish && types.length > 0 && (
                      <div className="mny-note">
                        {linked
                          ? 'Linked ✓ — these stay drafts until the booking engine can serve this calendar, so nothing ever books onto the wrong one.'
                          : "Drafts can't publish until a Google calendar is linked — that's where booked meetings land."}
                      </div>
                    )}
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
                    <div className="cal-k">Google Calendar</div>
                    {linked ? (
                      <p className="mny-sub" style={{ marginTop: 6, marginBottom: 0 }}>
                        Linked ✓ — {data.link?.provider === 'google'
                          ? <>bookings check and land on <b>{data.link?.googleEmail ?? 'your Google account'}</b>.</>
                          : 'wired through the vault; bookings check and land on your Google account.'}
                      </p>
                    ) : (
                      <>
                        <p className="mny-sub" style={{ marginTop: 6 }}>
                          Not linked. Your links can&apos;t go live yet — linking lets bookings avoid
                          your busy times and land on your real calendar.
                        </p>
                        <button type="button" className="mny-btn yes" disabled={busy} onClick={() => void linkGoogle()}>
                          Link your calendar
                        </button>
                      </>
                    )}
                  </div>

                  <div className="rs-plate dk-table cal-card">
                    <div className="cal-card-h">
                      <div className="cal-k">Your hours</div>
                      {rules && !editingHours && (
                        <button type="button" className="mny-link" onClick={() => setEditingHours(true)}>edit</button>
                      )}
                    </div>
                    <p className="mny-sub" style={{ marginTop: 4 }}>
                      The outer bound — no link can ever offer a time outside these.
                      {editingHours && ' Live on the page the moment you save.'}
                    </p>
                    {editingHours && rules ? (
                      <HoursEditor
                        rules={rules}
                        busy={busy}
                        onCancel={() => setEditingHours(false)}
                        onSave={(next) => {
                          void run(() => saveBookingRules({ rules: next }), 'Hours saved — live now.')
                            .then((ok) => { if (ok) setEditingHours(false); });
                        }}
                      />
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>

                  <details className="rs-plate dk-table cal-card">
                    <summary className="cal-k">All upcoming bookings ({upcoming.length})</summary>
                    {upcoming.length === 0 ? (
                      <div className="mny-note">Nothing on the books.</div>
                    ) : (
                      <div className="cal-upcoming">
                        {upcoming.map((b) => (
                          <div key={b.id} className="cal-booking">
                            <div className="cal-booking-when">{whenLabel(b.startsAt, b.endsAt, data.timezone ?? null)}</div>
                            <div>
                              <span className="cal-type-name">{b.inviteeName || b.inviteeEmail || 'someone'}</span>
                              {b.typeName && <span className="mny-sub"> · {b.typeName}</span>}
                            </div>
                            {b.inviteeNote && <div className="mny-sub">“{b.inviteeNote}”</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </details>
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
