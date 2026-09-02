// The Calendar admin surface — every route the Calendar tab acts through.
//
// Mounted INSIDE index.ts's /admin/ gate (valid session + a row in `admins`),
// same pattern as money and contracts: returns null for anything it does not
// own. The caller has already refused impersonated sessions — publishing a
// booking link while acting as a team would advertise a calendar under
// someone else's login, which is the exact 2026-08-09 incident this port's
// owner-scoping exists to prevent.
//
// Every route acts on the SIGNED-IN admin's own calendar (booking_admins),
// so Eric and Adam each see and change only their own.

import type { Env } from './env.js';
import type { Db } from './db.js';
import * as booking from './booking.js';
import { startLink } from './calendarLink.js';

type Json = (body: unknown, status?: number) => Response;

export async function handleBookingRoutes(
  req: Request,
  env: Env,
  url: URL,
  { userId, database, json }: { userId: string; database: Db; json: Json },
): Promise<Response | null> {
  if (!url.pathname.startsWith('/admin/calendar/')) return null;
  const path = url.pathname.slice('/admin/calendar'.length);
  const body =
    req.method === 'POST' ? ((await req.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (req.method === 'POST' && !body) return json({ error: 'invalid body' }, 422);

  try {
    if (path === '/overview' && req.method === 'GET') {
      return json(await booking.bookingOverview(database, userId));
    }

    if (path === '/setup' && req.method === 'POST') {
      return json(await booking.setupCalendar(database, userId, { name: body!.name, timezone: body!.timezone }));
    }

    if (path === '/rules' && req.method === 'POST') {
      return json(await booking.saveRules(database, userId, body!));
    }

    if (path === '/type' && req.method === 'POST') {
      return json(await booking.createType(database, userId, body!));
    }

    if (path === '/type/update' && req.method === 'POST') {
      return json(await booking.updateType(database, userId, body!));
    }

    if (path === '/type/delete' && req.method === 'POST') {
      return json(await booking.deleteType(database, userId, String(body!.id || '')));
    }

    // Mint the Google consent URL for THIS admin's calendar. The browser
    // travels there itself; the callback is public and trusts only the
    // one-time nonce this call minted (see calendarLink.ts).
    if (path === '/google/start' && req.method === 'POST') {
      const owner = await booking.ownerForAdmin(database, userId);
      if (!owner) return json({ error: 'This login has no calendar yet — set one up first.' }, 422);
      return json(await startLink(env, owner));
    }

    return null;
  } catch (e) {
    // A refusal carries its reason; anything else is still OUR json (with
    // CORS) rather than a naked exception page the browser reports as
    // "could not reach the server".
    const message = e instanceof Error ? e.message : 'something went wrong';
    return json({ error: message }, e instanceof booking.BookingRefusal ? 422 : 500);
  }
}
