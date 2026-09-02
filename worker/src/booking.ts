// BOOKING — the TRU HQ booking system, administered from the Calendar tab.
//
// This is a port of TRU OS's routes/groupA/booking.ts onto TRU HQ's worker.
// The DATA never moved: the public page at truhq.co/book has always read its
// meeting types and availability from this very Supabase project. TRU OS was
// only the control panel over it; this file makes TRU HQ the control panel
// instead. The public page, the Python settlement engine, and the tables are
// untouched.
//
// ── Two admins, two calendars ───────────────────────────────────────────────
//
// Every admin administers exactly ONE calendar, and which one is a stored
// fact in `booking_admins` — never inferred from who is signed in. Eric's
// personal login runs the original calendar (owned by the old shared admin@
// user, which the desk engine and the public page are keyed to); Adam's login
// runs his own. An admin with no mapping yet is in the setup state, and the
// setup creates their calendar under their OWN user id.
//
// ── Why the rules and the types are not equal partners ──────────────────────
//
// `scheduling_availability.rules` is the OUTER BOUND. A meeting type may narrow
// it — a shorter horizon, a longer lead — but may never widen it. That direction
// is the whole safety property: if a type could widen the bound, publishing a
// link would be a way to route around the working hours and notice period he
// set, and there would be no single place to look to know when he can be booked.
// The Python settlement engine already composes them that way; this API does not
// get to disagree with it, so it validates the same direction on write.
//
// ── One owner per query ─────────────────────────────────────────────────────
//
// On 2026-08-09 two of the four live meeting types turned out to belong to a
// client's account — created while Eric was signed in as them — and the public
// page, which had no owner filter, was advertising them as his. One was named
// "1:1 With Eric" and would have put the meeting on the client's calendar.
// Nothing here may ever return rows without an owner filter, whether or not
// row-level security is also doing it.
//
// ── The publish gate ────────────────────────────────────────────────────────
//
// A published slug is a live URL that books REAL meetings, and the settlement
// engine puts every meeting on a real Google Calendar. A calendar with no
// live Google link (`booking_calendar_links`) may draft types but not publish
// them: until the link exists there is no calendar to put a booking on, and
// the engine would fall back to the one Google account it knows — Eric's.
// That failure mode is the 2026-08-09 incident with the direction reversed.

import type { Db } from './db.js';

const MIN_DURATION = 5;
const MAX_DURATION = 480;
const MAX_BUFFER = 240;
const MAX_LEAD = 60 * 24 * 30;
const MAX_HORIZON = 365;

/* The ONE slug rule. It is duplicated as a check constraint on both
 * `meeting_types` and `slot_requests` in the database, and those two have
 * disagreed before — a slug this layer accepts and the database refuses cannot
 * be stored, and one accepted by `meeting_types` but not `slot_requests`
 * publishes a live link whose every availability request dies. Same pattern,
 * character for character, as TRU OS's booking.ts and meeting_types.py. */
const SLUG = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

// The page each type is published to, so the panel never has to guess it.
export const BOOKING_BASE = 'https://truhq.co/book/';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BookingRefusal extends Error {}

function refuse(message: string): never {
  throw new BookingRefusal(message);
}

/* Bounds, checked before anything is written.
 *
 * Returns a message rather than throwing so the caller answers 4xx with the
 * actual reason — "duration must be 5–480 minutes" is actionable, "invalid
 * meeting type" is not. */
export function checkTypeFields(body: Record<string, unknown>, partial: boolean): string | null {
  const has = (k: string) => body[k] !== undefined && body[k] !== null;

  if (!partial || has('slug')) {
    if (typeof body.slug !== 'string' || !SLUG.test(body.slug)) {
      return 'A slug must be lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.';
    }
  }
  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || !body.name.trim()) return 'A name is required.';
    if (body.name.length > 120) return 'That name is too long (120 characters max).';
  }
  if (!partial || has('duration_minutes')) {
    const d = Number(body.duration_minutes);
    if (!Number.isInteger(d) || d < MIN_DURATION || d > MAX_DURATION) {
      return `Duration must be a whole number of minutes between ${MIN_DURATION} and ${MAX_DURATION}.`;
    }
  }
  const bounded: [string, number][] = [
    ['buffer_minutes', MAX_BUFFER],
    ['lead_minutes', MAX_LEAD],
    ['horizon_days', MAX_HORIZON],
  ];
  for (const [field, max] of bounded) {
    if (!has(field)) continue;
    const v = Number(body[field]);
    if (!Number.isInteger(v) || v < 0 || v > max) return `${field.replace(/_/g, ' ')} must be between 0 and ${max}.`;
  }
  if (has('description') && typeof body.description === 'string' && body.description.length > 2000) {
    return 'That description is too long (2000 characters max).';
  }
  return null;
}

/* Availability rules, checked as a whole.
 *
 * Deliberately conservative: this rejects a shape it does not recognise rather
 * than merging into whatever is stored. A half-understood merge is how a lunch
 * break silently disappears. */
export function checkRules(rules: unknown): string | null {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return 'Rules must be an object.';
  const r = rules as Record<string, unknown>;

  if (!Array.isArray(r.hours) || r.hours.length === 0) {
    return 'At least one bookable window is required — otherwise nobody can ever book.';
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const w of r.hours as Record<string, unknown>[]) {
    if (!w || typeof w !== 'object') return 'Each bookable window must be an object.';
    const wd = Number(w.weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return 'Weekday must be 0–6.';
    if (typeof w.start !== 'string' || !time.test(w.start)) return 'Window start must be HH:MM.';
    if (typeof w.end !== 'string' || !time.test(w.end)) return 'Window end must be HH:MM.';
    if (w.start >= w.end) return `A window that starts at ${w.start} cannot end at ${w.end}.`;
  }
  if (r.blocks !== undefined) {
    if (!Array.isArray(r.blocks)) return 'Blocks must be a list.';
    for (const b of r.blocks as Record<string, unknown>[]) {
      if (typeof b.start !== 'string' || !time.test(b.start)) return 'Block start must be HH:MM.';
      if (typeof b.end !== 'string' || !time.test(b.end)) return 'Block end must be HH:MM.';
      if (b.start >= b.end) return 'A block cannot end before it starts.';
    }
  }
  const nums: [string, number][] = [
    ['slot_minutes', MAX_DURATION],
    ['buffer_minutes', MAX_BUFFER],
    ['lead_minutes', MAX_LEAD],
    ['horizon_days', MAX_HORIZON],
  ];
  for (const [field, max] of nums) {
    if (r[field] === undefined) continue;
    const v = Number(r[field]);
    if (!Number.isInteger(v) || v < 0 || v > max) return `${field.replace(/_/g, ' ')} must be between 0 and ${max}.`;
  }
  return null;
}

/* Whose calendar this admin runs. A stored mapping, or null = the setup
 * state. Never a guess: the wrong answer here is someone else's meetings. */
export async function ownerForAdmin(database: Db, adminId: string): Promise<string | null> {
  if (!UUID_RE.test(adminId)) return null;
  const rows = await database.select('booking_admins', `select=owner_id&admin_id=eq.${adminId}`);
  return rows.length ? String(rows[0].owner_id) : null;
}

export interface CalendarLink {
  provider: 'infisical' | 'google';
  status: 'live' | 'revoked';
  googleEmail: string | null;
}

export async function linkForOwner(database: Db, ownerId: string): Promise<CalendarLink | null> {
  const rows = await database.select(
    'booking_calendar_links',
    `select=provider,status,google_email&owner_id=eq.${ownerId}`,
  );
  if (!rows.length) return null;
  return { provider: rows[0].provider, status: rows[0].status, googleEmail: rows[0].google_email ?? null };
}

export interface MeetingTypeRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number | null;
  lead_minutes: number | null;
  horizon_days: number | null;
  published: boolean;
  sort_order: number | null;
  updated_at: string | null;
}

export interface UpcomingBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  inviteeName: string | null;
  inviteeEmail: string | null;
  inviteeNote: string | null;
  typeName: string | null;
}

// ── Read everything the panel needs, in one call ────────────────────────────
export async function bookingOverview(database: Db, adminId: string) {
  const owner = await ownerForAdmin(database, adminId);
  if (!owner) {
    // Not an error: a fresh admin simply has no calendar yet. The page shows
    // the setup instead of an empty shell pretending to be one.
    return { needsSetup: true as const, bookingBase: BOOKING_BASE };
  }

  const [availRows, types, link] = await Promise.all([
    database.select(
      'scheduling_availability',
      `select=rules,bookable,timezone,updated_at&user_id=eq.${owner}`,
    ),
    database.select(
      'meeting_types',
      'select=id,slug,name,description,duration_minutes,buffer_minutes,lead_minutes,horizon_days,published,sort_order,updated_at' +
        `&user_id=eq.${owner}&order=sort_order.asc`,
    ),
    linkForOwner(database, owner),
  ]);
  const avail = availRows[0] ?? null;

  // What is actually booked, so the tab reads as a calendar and not just a
  // settings page. Confirmed only, from now forward — a cancelled booking is
  // history, not a meeting.
  const nowIso = new Date().toISOString();
  const bookings = await database.select(
    'bookings',
    'select=id,starts_at,ends_at,invitee_name,invitee_email,invitee_note,meeting_type_id' +
      `&user_id=eq.${owner}&status=eq.confirmed&starts_at=gte.${encodeURIComponent(nowIso)}` +
      '&order=starts_at.asc&limit=25',
  );
  const typeName = new Map((types as MeetingTypeRow[]).map((t) => [t.id, t.name]));

  return {
    needsSetup: false as const,
    bookable: avail?.bookable ?? false,
    timezone: avail?.timezone ?? null,
    rules: avail?.rules ?? null,
    rulesUpdatedAt: avail?.updated_at ?? null,
    types: types as MeetingTypeRow[],
    link,
    linked: link?.status === 'live',
    upcoming: bookings.map(
      (b): UpcomingBooking => ({
        id: b.id,
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        inviteeName: b.invitee_name ?? null,
        inviteeEmail: b.invitee_email ?? null,
        inviteeNote: b.invitee_note ?? null,
        typeName: typeName.get(b.meeting_type_id) ?? null,
      }),
    ),
    bookingBase: BOOKING_BASE,
  };
}

/* The mapping this resolves is load-bearing for every mutation below: resolve
 * once, refuse loudly when absent. */
async function requireOwner(database: Db, adminId: string): Promise<string> {
  const owner = await ownerForAdmin(database, adminId);
  if (!owner) refuse('This login has no calendar yet — set one up first.');
  return owner;
}

// ── Setup: a new admin's own calendar ───────────────────────────────────────
// Creates the availability row under the ADMIN'S OWN user id, maps them to
// it, and drafts three starter links. Everything starts dark: bookable=false,
// all types unpublished — nothing is public until deliberately published,
// and publishing is gated on a live Google link anyway.
export async function setupCalendar(
  database: Db,
  adminId: string,
  { name, timezone }: { name?: unknown; timezone?: unknown },
): Promise<{ message: string }> {
  if (!UUID_RE.test(adminId)) refuse('No signed-in admin.');
  const existing = await ownerForAdmin(database, adminId);
  if (existing) refuse('This login already runs a calendar.');

  const first = String(name ?? '').trim().split(/\s+/)[0] || '';
  if (!first) refuse('Whose calendar is this? A first name is required.');
  if (first.length > 40) refuse('That name is too long.');
  const tz = typeof timezone === 'string' && /^[A-Za-z_]+\/[A-Za-z_/]+$/.test(timezone)
    ? timezone
    : 'America/Los_Angeles';

  // A second calendar must not adopt the original one by accident: the admin's
  // own user id must not already own availability (would mean a mapping was
  // deleted by hand — a state to look at, not write over).
  const clash = await database.select('scheduling_availability', `select=user_id&user_id=eq.${adminId}`);
  if (clash.length) refuse('A calendar already exists for this account but is not mapped — this needs a look, not an overwrite.');

  await database.insert('scheduling_availability', {
    user_id: adminId,
    bookable: false,
    timezone: tz,
    rules: {
      hours: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, start: '09:00', end: '16:00' })),
      blocks: [],
      timezone: tz,
      slot_minutes: 30,
      buffer_minutes: 30,
      lead_minutes: 1440,
      horizon_days: 30,
    },
    updated_by: 'tru-hq',
  });
  await database.insert('booking_admins', { admin_id: adminId, owner_id: adminId });

  const slugName = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const starters = [
    { slug: `1-1-with-${slugName}`, name: `1:1 with ${first}`, duration_minutes: 30, sort_order: 0 },
    { slug: 'new-client-consultation', name: 'New Client Consultation', duration_minutes: 60, sort_order: 1 },
    { slug: 'strategy-session', name: 'Strategy Session', duration_minutes: 60, sort_order: 2 },
  ];
  for (const t of starters) {
    await database.insert('meeting_types', { user_id: adminId, published: false, description: null, ...t });
  }

  return {
    message:
      `${first}'s calendar is set up — three draft links, Mon–Fri 9:00–16:00 (${tz}), booking off. ` +
      'Link a Google calendar to publish anything.',
  };
}

// ── The outer bound ─────────────────────────────────────────────────────────
export async function saveRules(
  database: Db,
  adminId: string,
  body: { rules?: unknown; bookable?: unknown; timezone?: unknown },
): Promise<{ message: string }> {
  if (body.rules !== undefined) {
    const bad = checkRules(body.rules);
    if (bad) refuse(bad);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: 'tru-hq' };
  if (body.rules !== undefined) patch.rules = body.rules;
  if (typeof body.bookable === 'boolean') patch.bookable = body.bookable;
  if (typeof body.timezone === 'string' && body.timezone) patch.timezone = body.timezone;

  const owner = await requireOwner(database, adminId);
  await database.update('scheduling_availability', `user_id=eq.${owner}`, patch);
  if (typeof body.bookable === 'boolean') {
    return { message: body.bookable ? 'Booking is on.' : 'Booking is off — the page will offer no times.' };
  }
  return { message: 'Saved.' };
}

// ── Meeting types ───────────────────────────────────────────────────────────
export async function createType(
  database: Db,
  adminId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; slug: string; published: false }> {
  const bad = checkTypeFields(body, false);
  if (bad) refuse(bad);

  /* Publishing on create is refused on purpose. A slug becomes a public URL
   * the moment published flips true, and a type created with the wrong
   * duration would be live before it was ever looked at. Create it, check it,
   * then publish it. */
  const owner = await requireOwner(database, adminId);
  const row = {
    user_id: owner,
    slug: body.slug,
    name: String(body.name).trim(),
    description: typeof body.description === 'string' && body.description ? body.description : null,
    duration_minutes: Number(body.duration_minutes),
    buffer_minutes: body.buffer_minutes === undefined || body.buffer_minutes === null ? null : Number(body.buffer_minutes),
    lead_minutes: body.lead_minutes === undefined || body.lead_minutes === null ? null : Number(body.lead_minutes),
    horizon_days: body.horizon_days === undefined || body.horizon_days === null ? null : Number(body.horizon_days),
    published: false,
  };
  try {
    const created = await database.insert('meeting_types', row);
    return { id: created.id, slug: created.slug, published: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/duplicate|unique/i.test(message)) refuse(`You already have a meeting type using "${body.slug}".`);
    throw e;
  }
}

export async function updateType(
  database: Db,
  adminId: string,
  body: Record<string, unknown>,
): Promise<{ message: string }> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) refuse('Which meeting type? An id is required.');
  const bad = checkTypeFields(body, true);
  if (bad) refuse(bad);

  const owner = await requireOwner(database, adminId);

  /* THE PUBLISH GATE. A published slug books real meetings onto a real Google
   * Calendar. No live Google link = no calendar to put them on — and the desk
   * engine's fallback would be the one account it knows, which is Eric's.
   *
   * The second check is the harder truth: the desk engine reads exactly ONE
   * credential (the vault's), so today it can only serve the calendar wired
   * as provider 'infisical'. A worker-captured Google link is real wiring but
   * the engine does not read it yet — publishing on the strength of it would
   * check Eric's busy times and write the meeting to Eric's calendar. This
   * clause comes out when the engine learns per-owner credentials, not
   * before. */
  if (body.published === true) {
    const link = await linkForOwner(database, owner);
    if (link?.status !== 'live') {
      refuse('Link a Google calendar first — a published link books real meetings, and this calendar has nowhere to put them yet.');
    }
    if (link.provider !== 'infisical') {
      refuse('This calendar is linked, but the booking engine cannot serve it yet — publishing stays off until it can, so nothing ever books onto the wrong calendar.');
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ['slug', 'name', 'description', 'duration_minutes', 'buffer_minutes', 'lead_minutes', 'horizon_days', 'sort_order']) {
    if (body[f] !== undefined) patch[f] = body[f];
  }
  if (typeof body.published === 'boolean') patch.published = body.published;

  // eq('user_id') as well as eq('id'): with a service key nothing else stops
  // this touching another account's row.
  await database.update('meeting_types', `id=eq.${id}&user_id=eq.${owner}`, patch);
  return { message: 'Saved.' };
}

export async function deleteType(database: Db, adminId: string, id: string): Promise<{ message: string }> {
  if (!UUID_RE.test(id)) refuse('Which meeting type? An id is required.');

  /* Refuse while anything still points at it. A booked meeting whose type
   * vanished cannot be rendered, cancelled or settled — the engine loads the
   * type to know whose calendar it belongs to. Unpublish instead. */
  const live = await database.select(
    'bookings',
    `select=id&meeting_type_id=eq.${id}&status=neq.cancelled&limit=1000`,
  );
  if (live.length > 0) {
    refuse(`That type has ${live.length} live booking${live.length === 1 ? '' : 's'}. Unpublish it instead.`);
  }
  const owner = await requireOwner(database, adminId);
  const gone = await database.del('meeting_types', `id=eq.${id}&user_id=eq.${owner}`);
  if (gone.length === 0) refuse('No meeting type with that id.');
  return { message: `"${gone[0].name}" deleted.` };
}
