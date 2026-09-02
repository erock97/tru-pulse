// The Calendar admin surface — every route the Calendar tab acts through.
//
// Mounted INSIDE index.ts's /admin/ gate (valid session + a row in `admins`),
// same pattern as money and contracts: returns null for anything it does not
// own. The caller has already refused impersonated sessions — publishing a
// booking link while acting as a team would advertise Eric's calendar under
// someone else's login, which is the exact 2026-08-09 incident this port's
// owner-scoping exists to prevent.

import type { Env } from './env.js';
import type { Db } from './db.js';
import * as booking from './booking.js';

type Json = (body: unknown, status?: number) => Response;

export async function handleBookingRoutes(
  req: Request,
  _env: Env,
  url: URL,
  { database, json }: { database: Db; json: Json },
): Promise<Response | null> {
  if (!url.pathname.startsWith('/admin/calendar/')) return null;
  const path = url.pathname.slice('/admin/calendar'.length);
  const body =
    req.method === 'POST' ? ((await req.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (req.method === 'POST' && !body) return json({ error: 'invalid body' }, 422);

  try {
    if (path === '/overview' && req.method === 'GET') {
      return json(await booking.bookingOverview(database));
    }

    if (path === '/rules' && req.method === 'POST') {
      return json(await booking.saveRules(database, body!));
    }

    if (path === '/type' && req.method === 'POST') {
      return json(await booking.createType(database, body!));
    }

    if (path === '/type/update' && req.method === 'POST') {
      return json(await booking.updateType(database, body!));
    }

    if (path === '/type/delete' && req.method === 'POST') {
      return json(await booking.deleteType(database, String(body!.id || '')));
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
