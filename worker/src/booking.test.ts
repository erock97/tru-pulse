// The booking-panel rules, ported from TRU OS with their incidents intact:
// the owner filter (2026-08-09 — a client's meeting types advertised as
// Eric's), the narrow-only bound, publish-off-on-create, and the refusal to
// delete a type that live bookings still point at.
import { describe, it, expect, vi } from 'vitest';
import { checkTypeFields, checkRules, ownerId, createType, deleteType, bookingOverview, BookingRefusal } from './booking.js';
import { db } from './db.js';
import type { Env } from './env.js';

const SUPA = 'https://proj.supabase.co';
const env = {
  SUPABASE_URL: SUPA,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
} as unknown as Env;

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const OWNER = 'd6b9504c-f35e-49c9-af99-6a2de2069db8';

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

describe('ownerId', () => {
  it('refuses to guess between two calendars', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ user_id: OWNER }, { user_id: 'other' }])));
    await expect(ownerId(db(env))).rejects.toThrow(/refusing to guess/);
  });
  it('refuses when no calendar exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([])));
    await expect(ownerId(db(env))).rejects.toThrow(/No booking calendar/);
  });
});

describe('createType', () => {
  it('always creates unpublished, whatever the caller sends', async () => {
    let inserted: any = null;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/scheduling_availability')) return ok([{ user_id: OWNER }]);
      if (url.includes('/rest/v1/meeting_types') && init?.method === 'POST') {
        inserted = JSON.parse(String(init.body));
        return ok([{ id: 'aaaaaaaa-1111-2222-3333-444444444444', slug: inserted.slug }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await createType(db(env), { slug: 'intro', name: 'Intro', duration_minutes: 30, published: true });
    expect(inserted.published).toBe(false);
    expect(inserted.user_id).toBe(OWNER);
    expect(r.published).toBe(false);
  });

  it('turns a unique violation into the readable refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/rest/v1/scheduling_availability')) return ok([{ user_id: OWNER }]);
      if (url.includes('/rest/v1/meeting_types') && init?.method === 'POST') {
        return new Response('duplicate key value violates unique constraint', { status: 409 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await expect(createType(db(env), { slug: 'intro', name: 'Intro', duration_minutes: 30 }))
      .rejects.toThrow(/already have a meeting type using "intro"/);
  });
});

describe('deleteType', () => {
  it('refuses while live bookings still point at it', async () => {
    const deletes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'DELETE') { deletes.push(url); return ok([]); }
      if (url.includes('/rest/v1/bookings')) return ok([{ id: 'b1' }, { id: 'b2' }]);
      if (url.includes('/rest/v1/scheduling_availability')) return ok([{ user_id: OWNER }]);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await expect(deleteType(db(env), 'aaaaaaaa-1111-2222-3333-444444444444'))
      .rejects.toThrow(/2 live bookings.*Unpublish/);
    expect(deletes).toHaveLength(0);
  });

  it('refuses a non-uuid id outright', async () => {
    await expect(deleteType(db(env), 'DROP TABLE')).rejects.toThrow(BookingRefusal);
  });
});

describe('bookingOverview', () => {
  it('scopes every read to the one owner and names types on upcoming bookings', async () => {
    const reads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url: string = typeof input === 'string' ? input : input.url;
      reads.push(url);
      if (url.includes('/rest/v1/scheduling_availability')) {
        if (url.includes('user_id=eq.')) {
          return ok([{ rules: { hours: [] }, bookable: true, timezone: 'America/Los_Angeles', updated_at: 'now' }]);
        }
        return ok([{ user_id: OWNER }]);
      }
      if (url.includes('/rest/v1/meeting_types')) {
        return ok([{ id: 't1', slug: 'intro', name: 'Intro call', duration_minutes: 30, published: true }]);
      }
      if (url.includes('/rest/v1/bookings')) {
        return ok([{ id: 'b1', starts_at: '2026-09-03T17:00:00Z', ends_at: '2026-09-03T17:30:00Z', invitee_name: 'Jo', invitee_email: 'jo@x.com', meeting_type_id: 't1' }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await bookingOverview(db(env));
    expect(r.bookable).toBe(true);
    expect(r.upcoming[0].typeName).toBe('Intro call');
    const dataReads = reads.filter((u) => !u.includes('select=user_id'));
    for (const u of dataReads) expect(u).toContain(`user_id=eq.${OWNER}`);
  });
});
