// Text-message consent — the four endpoints behind the opt-in box.
//
// Everything here runs AS THE SIGNED-IN AGENT (their session's token), so the
// SECURITY DEFINER functions in db/hq_sms_consent.sql decide what they can see
// and change. There is no path by which anyone turns SMS on for somebody else.
//
// ── The one rule this file exists to enforce ─────────────────────────────────
//
// Three things are NEVER taken from the request body, whatever the browser
// sends: the consent sentence, its version, and the IP address. All three are
// evidence, and evidence a client can dictate is worthless — a page could claim
// agreement to wording it never displayed. The page and this file import the
// same constant from shared/smsConsent.ts, so what was on screen and what lands
// in the ledger cannot drift apart.
//
// Deliberately its own module rather than folded into dataRoutes: the consent
// ledger is the artifact a carrier and, later, a TCPA complaint ask to see, and
// it should be obvious where every write to it comes from.
import type { Env } from './env.js';
import { readCookie } from './session.js';
import { supabaseAsUser } from './asUser.js';
import { toE164US, SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } from '../../shared/smsConsent.js';

const json = (obj: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

export async function handleSmsRoutes(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  originOk = true,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/sms/')) return null;

  const db = await supabaseAsUser(env, readCookie(req));
  if (!db) return json({ error: 'not signed in' }, 401, cors);
  if (req.method !== 'GET' && !originOk) return json({ error: 'origin not allowed' }, 403, cors);

  // Where this person stands. Null when they are not an agent at all — a leader
  // or admin — which the browser reads as "hide the feature" rather than as an
  // error, because it is not one.
  if (url.pathname === '/sms/state' && req.method === 'GET') {
    const { ok, data } = await db.rpc('agent_sms_state', {});
    if (!ok) return json({ error: 'could not read that' }, 400, cors);
    return json({ sms: data ?? null }, 200, cors);
  }

  if (url.pathname === '/sms/opt-in' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { phone?: string } | null;
    // Normalised here as well as in the database. The database check is the one
    // that counts; this one exists to give a person a sentence they can act on
    // instead of a raised exception.
    const phone = toE164US(b?.phone ?? '');
    if (!phone) {
      return json({ error: 'That doesn’t look like a US mobile number.' }, 422, cors);
    }
    const { ok } = await db.rpc('agent_sms_opt_in', {
      p_phone: phone,
      p_consent_text: SMS_CONSENT_TEXT,
      p_consent_version: SMS_CONSENT_VERSION,
      // Cloudflare sets this itself and strips any client-supplied copy, so it is
      // the one value here a browser cannot lie about.
      p_ip: req.headers.get('CF-Connecting-IP'),
      p_user_agent: req.headers.get('User-Agent'),
    });
    return ok
      ? json({ ok: true }, 200, cors)
      : json({ error: 'That didn’t save — try again.' }, 400, cors);
  }

  if (url.pathname === '/sms/opt-out' && req.method === 'POST') {
    const { ok } = await db.rpc('agent_sms_opt_out', {});
    // An opt-out that fails quietly is the worst bug this file could have: the
    // person believes they have stopped and the messages keep coming. Say so, and
    // give them a human to write to.
    return ok
      ? json({ ok: true }, 200, cors)
      : json({
        error: 'We could not turn that off. Email Admin@terrasonconsulting.com and we will stop it by hand.',
      }, 400, cors);
  }

  if (url.pathname === '/sms/decline' && req.method === 'POST') {
    const { ok } = await db.rpc('agent_sms_decline', {});
    return ok ? json({ ok: true }, 200, cors) : json({ error: 'Could not save that.' }, 400, cors);
  }

  return json({ error: 'not found' }, 404, cors);
}
