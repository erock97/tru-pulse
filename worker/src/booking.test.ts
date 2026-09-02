// The booking-panel rules, ported from TRU OS with their incidents intact:
// the owner filter (2026-08-09 — a client's meeting types advertised as
// Eric's), the narrow-only bound, publish-off-on-create, the refusal to
// delete a type that live bookings still point at — plus the two-calendar
// rules: the admin→owner mapping is stored fact, and publishing is gated on
// a live Google link so a second calendar can never book onto Eric's.
import { describe, it, expect, vi } from 'vitest';
import {
  checkTypeFields, checkRules, ownerForAdmin, createType, deleteType,
  bookingOverview, setupCalendar, updateType, BookingRefusal,
} from './booking.js';
import { db } from './db.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
const env = {
  SUPABASE_URL: SUPA,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
} as unknown as Env;

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const ADMIN = '39e87329-2df5-429a-b59c-5ed2a37aaee8';
const OWNER = 'd6b9504c-f35e-49c9-af99-6a2de2069db8';

/** Standard mapping answer: ADMIN runs OWNER's calendar. */
const mappingRow = [{ owner_id: OWNER }];

describe('checkTypeFields', () => {
  it('refuses a slug that would die at the check constraint', () => {
    expect(checkTypeFields({ slug: 'Strategy Session', name: 'X', duration_minutes: 30 }, false)).toMatch(/slug/i);
    expect(checkTypeFields({ slug: '-lead', name: 'X', duration_minutes: 30 }, false)).toMatch(/slug/i);
  });
  it('bounds the duration', () => {
    expect(checkTypeFields({ slug: 'ok', name: 'X', duration_minutes: 3 }, false)).toMatch(/5 and 480/);
    expect(checkTypeFields({ slug: 'ok', name: 'X', duration_minutes: 481 }, false)).toMatch(/5 and 480/);
  });
  it('passes a partial update that only flips published', () => {
    expect(checkTypeFields({ published: true }, true)).toBeNull();
  });
});

describe('checkRules', () => {
  it('refuses an empty week — otherwise nobody can ever book', () => {
    expect(checkRules({ hours: [] })).toMatch(/bookable window/);
  });
  it('refuses a window that ends before it starts', () => {
    expect(checkRules({ hours: [{ weekday: 0, start: '16:00', end: '09:00' }] })).toMatch(/cannot end/);
  });
  it('accepts the live shape', () => {
    expect(checkRules({
      hours: [{ weekday: 0, start: '09:00', end: '16:00' }],
      blocks: [{ start: '12:00', end: '12:30', label: 'lunch' }],
      slot_minutes: 30, buffer_minutes: 30, lead_minutes: 1440, horizon_days: 30,
    })).toBeNull();
  });
});

describe('ownerForAdmin', () => {
  it('answers only from the stored mapping — never a guess', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      expect(url).toContain(`admin_id=eq.${ADMIN}`);
      return ok(mappingRow);
    }));
    expect(await ownerForAdmin(db(env), ADMIN)).toBe(OWNER);
  });
  it('null when there is no mapping (the setup state), including a junk id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([])));
    expect(await ownerForAdmin(db(env), ADMIN)).toBeNull();
    expect(await ownerForAdmin(db(env), 'DROP TABLE')).toBeNull();
  });
});

describe('setupCalendar', () => {
  it('creates the calendar dark: booking off, every starter type a draft', async () => {
    const inserts: Array<{ table: string; row: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url: string = typeof input === 'string' ? input : input.url;
      if (init?.method === 'POST') {
        inserts.push({ table: url.split('/rest/v1/')[1].split('?')[0], row: JSON.parse(String(init.body)) });
        return ok([{ id: 'x' }]);
      }
      if (url.includes('/rest/v1/booking_admins')) return ok([]);
      if (url.includes('/rest/v1/scheduling_availability')) return ok([]);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await setupCalendar(db(env), ADMIN, { name: 'Adam Terrason', timezone: 'America/New_York' });
    expect(r.message).toMatch(/Adam's calendar is set up/);
    const avail = inserts.find((i) => i.table === 'scheduling_availability')!.row;
    expect(avail.bookable).toBe(false);
    expect(avail.user_id).toBe(ADMIN);
    expect(avail.timezone).toBe('America/New_York');
    const types = inserts.filter((i) => i.table === 'meeting_types').map((i) => i.row);
    expect(types).toHaveLength(3);
    for (const t of types) { expect(t.published).toBe(false); expect(t.user_id).toBe(ADMIN); }
    expect(types[0].name).toBe('1:1 with Adam');
    expect(inserts.find((i) => i.table === 'booking_admins')!.row).toMatchObject({ admin_id: ADMIN, owner_id: ADMIN });
  });

  it('refuses when the login already runs a calendar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(mappingRow)));
    await expect(setupCalendar(db(env), ADMIN, { name: 'Adam' })).rejects.toThrow(/already runs a calendar/);
  });
});

describe('updateType publish gate', () => {
  function stubs(linkRow: unknown[]) {
    const patches: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url: string = typeof input === 'string' ? input : input.url;
      if (init?.method === 'PATCH') { patches.push(url); return ok([]); }
      if (url.includes('/rest/v1/booking_admins')) return ok(mappingRow);
      if (url.includes('/rest/v1/booking_calendar_links')) return ok(linkRow);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    return patches;
  }
  const TYPE = 'aaaaaaaa-1111-2222-3333-444444444444';

  it('refuses to publish a calendar with no live Google link — nothing is written', async () => {
    const patches = stubs([]);
    await expect(updateType(db(env), ADMIN, { id: TYPE, published: true }))
      .rejects.toThrow(/Link a Google calendar first/);
    expect(patches).toHaveLength(0);
  });

  it('a revoked link is no better than none', async () => {
    const patches = stubs([{ provider: 'google', status: 'revoked', google_email: 'a@b.c' }]);
    await expect(updateType(db(env), ADMIN, { id: TYPE, published: true }))
      .rejects.toThrow(/Link a Google calendar first/);
    expect(patches).toHaveLength(0);
  });

  it('publishes with a live link, and scopes the write to the mapped owner', async () => {
    const patches = stubs([{ provider: 'infisical', status: 'live', google_email: null }]);
    await updateType(db(env), ADMIN, { id: TYPE, published: true });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toContain(`user_id=eq.${OWNER}`);
  });

  it('a live worker-captured Google link is still refused — the desk engine cannot serve it yet', async () => {
    const patches = stubs([{ provider: 'google', status: 'live', google_email: 'adamt@terrasonconsulting.com' }]);
    await expect(updateType(db(env), ADMIN, { id: TYPE, published: true }))
      .rejects.toThrow(/engine cannot serve it yet/);
    expect(patches).toHaveLength(0);
  });

  it('UNpublishing needs no link — turning things off is always allowed', async () => {
    const patches = stubs([]);
    await updateType(db(env), ADMIN, { id: TYPE, published: false });
    expect(patches).toHaveLength(1);
  });
});

describe('createType', () => {
  it('always creates unpublished, under the mapped owner, whatever the caller sends', async () => {
    let inserted: any = null;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url: string = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/booking_admins')) return ok(mappingRow);
      if (url.includes('/rest/v1/meeting_types') && init?.method === 'POST') {
        inserted = JSON.parse(String(init.body));
        return ok([{ id: 'aaaaaaaa-1111-2222-3333-444444444444', slug: inserted.slug }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await createType(db(env), ADMIN, { slug: 'intro', name: 'Intro', duration_minutes: 30, published: true });
    expect(inserted.published).toBe(false);
    expect(inserted.user_id).toBe(OWNER);
    expect(r.published).toBe(false);
  });

  it('turns a unique violation into the readable refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url: string = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/booking_admins')) return ok(mappingRow);
      if (url.includes('/rest/v1/meeting_types') && init?.method === 'POST') {
        return new Response('duplicate key value violates unique constraint', { status: 409 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await expect(createType(db(env), ADMIN, { slug: 'intro', name: 'Intro', duration_minutes: 30 }))
      .rejects.toThrow(/already have a meeting type using "intro"/);
  });
});

describe('deleteType', () => {
  it('refuses while live bookings still point at it', async () => {
    const deletes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url: string = typeof input === 'string' ? input : input.url;
      if (init?.method === 'DELETE') { deletes.push(url); return ok([]); }
      if (url.includes('/rest/v1/bookings')) return ok([{ id: 'b1' }, { id: 'b2' }]);
      if (url.includes('/rest/v1/booking_admins')) return ok(mappingRow);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await expect(deleteType(db(env), ADMIN, 'aaaaaaaa-1111-2222-3333-444444444444'))
      .rejects.toThrow(/2 live bookings.*Unpublish/);
    expect(deletes).toHaveLength(0);
  });

  it('refuses a non-uuid id outright', async () => {
    await expect(deleteType(db(env), ADMIN, 'DROP TABLE')).rejects.toThrow(BookingRefusal);
  });
});

describe('bookingOverview', () => {
  it('answers the setup state for an unmapped admin without touching booking tables', async () => {
    const reads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url: string = typeof input === 'string' ? input : input.url;
      reads.push(url);
      if (url.includes('/rest/v1/booking_admins')) return ok([]);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await bookingOverview(db(env), ADMIN);
    expect(r.needsSetup).toBe(true);
    expect(reads).toHaveLength(1);
  });

  it('scopes every read to the mapped owner and names types on upcoming bookings', async () => {
    const reads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url: string = typeof input === 'string' ? input : input.url;
      reads.push(url);
      if (url.includes('/rest/v1/booking_admins')) return ok(mappingRow);
      if (url.includes('/rest/v1/booking_calendar_links')) {
        return ok([{ provider: 'infisical', status: 'live', google_email: null }]);
      }
      if (url.includes('/rest/v1/scheduling_availability')) {
        return ok([{ rules: { hours: [] }, bookable: true, timezone: 'America/Los_Angeles', updated_at: 'now' }]);
      }
      if (url.includes('/rest/v1/meeting_types')) {
        return ok([{ id: 't1', slug: 'intro', name: 'Intro call', duration_minutes: 30, published: true }]);
      }
      if (url.includes('/rest/v1/bookings')) {
        return ok([{ id: 'b1', starts_at: '2026-09-03T17:00:00Z', ends_at: '2026-09-03T17:30:00Z', invitee_name: 'Jo', invitee_email: 'jo@x.com', meeting_type_id: 't1' }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await bookingOverview(db(env), ADMIN);
    expect(r.needsSetup).toBe(false);
    if (r.needsSetup === false) {
      expect(r.bookable).toBe(true);
      expect(r.linked).toBe(true);
      expect(r.upcoming[0].typeName).toBe('Intro call');
    }
    const ownerReads = reads.filter((u) => !u.includes('booking_admins') && !u.includes('booking_calendar_links'));
    for (const u of ownerReads) expect(u).toContain(`user_id=eq.${OWNER}`);
  });
});
