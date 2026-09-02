// "Link your calendar" — Google OAuth for a booking calendar's own account.
//
// Why this exists: the desk engine needs TWO things from a calendar owner's
// Google account — free/busy (so a link never offers a taken hour) and event
// creation (so a booking becomes a real meeting). Eric's account has been
// wired through the vault since the scheduler shipped; Adam's has no wiring,
// and this flow captures it. The refresh token lands in
// `booking_calendar_links` AES-GCM encrypted with FUB_ENC_KEY — the same key
// discipline as the per-tenant FUB keys, and the worker never logs it.
//
// The flow is deliberately split so no route needs both a session and a
// redirect: the app POSTs /admin/calendar/google/start (authed, inside the
// admin gate) and receives the consent URL; the browser travels there; Google
// returns to GET /calendar-link/callback (public, no session), which trusts
// only the one-time state nonce minted at start — the nonce IS the identity,
// stored server-side in KV with a 10-minute TTL and burned on first use.
//
// NOTE the engine half: capturing the token is necessary but not sufficient.
// The desk engine (slot_queue_worker / booking_settlement in jarvis-brain)
// still reads one credential from the vault; teaching it to pick the
// credential by the meeting type's owner is the follow-up that makes a second
// calendar actually answer. Until then the publish gate in booking.ts keeps
// unlinked calendars unpublished, and this flow just gets the wiring ready.

import type { Env } from './env.js';
import type { Db } from './db.js';
import { importEncKey, encryptKey } from './crypto.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
// readonly covers freeBusy; events covers create/cancel; email names the
// linked account on the card so "linked to the wrong Google" is visible.
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events openid email';

const STATE_TTL_SECONDS = 600;
const stateKey = (nonce: string) => `callink:${nonce}`;

export function redirectUri(env: Env): string {
  // The worker's own hostname — must be registered verbatim on the Google
  // OAuth client or Google refuses with redirect_uri_mismatch.
  return 'https://api.truhq.co/calendar-link/callback';
}

function appOrigin(env: Env): string {
  return (env.APP_ORIGIN ?? 'https://app.truhq.co').split(',')[0].trim().replace(/\/$/, '');
}

export function linkConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CAL_CLIENT_ID && env.GOOGLE_CAL_CLIENT_SECRET);
}

/** Mint the consent URL for this admin's calendar. Caller is already behind
 *  the admin gate and owner resolution — the nonce binds the callback to
 *  exactly that owner. */
export async function startLink(env: Env, ownerId: string): Promise<{ url: string }> {
  if (!linkConfigured(env)) {
    throw new Error(
      'Google linking is not switched on yet — the worker needs its Google client credentials ' +
      '(GOOGLE_CAL_CLIENT_ID / GOOGLE_CAL_CLIENT_SECRET) and the callback URL registered on that client.',
    );
  }
  const nonce = crypto.randomUUID();
  await env.SESSIONS.put(stateKey(nonce), JSON.stringify({ ownerId }), { expirationTtl: STATE_TTL_SECONDS });

  const qs = new URLSearchParams({
    client_id: env.GOOGLE_CAL_CLIENT_ID!,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: SCOPES,
    // offline + consent is what actually yields a refresh token; without
    // prompt=consent a re-link silently returns NO refresh token and the row
    // would hold a null credential that looks linked.
    access_type: 'offline',
    prompt: 'consent',
    state: nonce,
  });
  return { url: `${GOOGLE_AUTH}?${qs}` };
}

/** The browser lands here from Google. Never throws to the visitor: every
 *  failure becomes a readable ?cal_link_error= on the app, because a naked
 *  500 on a redirect is indistinguishable from the button doing nothing. */
export async function handleLinkCallback(req: Request, env: Env, database: Db, url: URL): Promise<Response> {
  const back = (params: string) => Response.redirect(`${appOrigin(env)}/?${params}#/admin/calendar`, 302);

  const nonce = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const stored = nonce && /^[0-9a-f-]{36}$/.test(nonce) ? await env.SESSIONS.get(stateKey(nonce)) : null;
  if (!stored) return back('cal_link_error=' + encodeURIComponent('That link attempt expired — press the button again.'));
  // Burn the nonce before doing anything with it: a replayed callback must
  // find nothing, not a second chance to write a credential.
  await env.SESSIONS.delete(stateKey(nonce));
  const { ownerId } = JSON.parse(stored) as { ownerId: string };

  if (!code) {
    // The person said no on Google's screen. Their calendar, their call.
    return back('cal_link_error=' + encodeURIComponent('Google sign-in was cancelled — nothing was linked.'));
  }

  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CAL_CLIENT_ID!,
        client_secret: env.GOOGLE_CAL_CLIENT_SECRET!,
        redirect_uri: redirectUri(env),
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error('Google would not exchange the sign-in code.');
    const tokens = (await res.json()) as { refresh_token?: string; id_token?: string };
    if (!tokens.refresh_token) throw new Error('Google sent no long-lived credential — try the button again.');

    // The id_token's email claim — decoded, not verified, because it arrived
    // over TLS from Google's own token endpoint in direct exchange for our
    // client secret. Display-only either way.
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const claims = JSON.parse(atob(tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof claims.email === 'string') email = claims.email;
      } catch { /* display-only */ }
    }

    const enc = await encryptKey(await importEncKey(env.FUB_ENC_KEY), tokens.refresh_token);
    await database.upsert('booking_calendar_links', [{
      owner_id: ownerId,
      provider: 'google',
      status: 'live',
      refresh_token_enc: enc,
      google_email: email,
      linked_at: new Date().toISOString(),
    }], 'owner_id');

    return back('cal_linked=1');
  } catch (e) {
    const why = e instanceof Error ? e.message : 'Something went wrong linking the calendar.';
    return back('cal_link_error=' + encodeURIComponent(why));
  }
}
