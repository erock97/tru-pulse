// The agent's own surface. Everything here runs AS the signed-in agent (their
// session's token), so row-level security and the SECURITY DEFINER functions in
// db/hq_agent_experience.sql decide what they can see and change.
//
// The predecessor of this file was a set of anon RPCs keyed on a `token` UUID in a
// URL. There is no token here and no unauthenticated path — an agent reaches this
// by having accepted an invite and signed in, and by no other route.
import type { Env } from './env.js';
import { readCookie } from './session.js';
import { supabaseAsUser } from './asUser.js';
import { shapeAgentHome, type AgentHomeRow } from './agentHome.js';
import { toE164US, SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } from '../../shared/smsConsent.js';

const json = (obj: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

export async function handleAgentRoutes(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  originOk = true,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/agent/')) return null;

  const db = await supabaseAsUser(env, readCookie(req));
  if (!db) return json({ error: 'not signed in' }, 401, cors);
  if (req.method !== 'GET' && !originOk) return json({ error: 'origin not allowed' }, 403, cors);

  if (url.pathname === '/agent/home' && req.method === 'GET') {
    const { ok, data } = await db.rpc<AgentHomeRow>('agent_home', {});
    // A signed-in user who is not an agent (a leader, an admin) gets 403 rather
    // than an empty home — the caller should route them somewhere else entirely.
    if (!ok || !data?.agent) return json({ error: 'not an agent' }, 403, cors);
    return json(shapeAgentHome(data), 200, cors);
  }

  if (url.pathname === '/agent/commitment' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { id?: string; done?: boolean } | null;
    if (!b?.id) return json({ error: 'id required' }, 422, cors);
    const { ok } = await db.rpc('agent_set_commitment_done', { p_item_id: b.id, p_done: !!b.done });
    // The RPC raises when the commitment isn't theirs, so a failure here is either
    // that or a transient one; either way the browser should roll its tick back.
    return ok ? json({ ok: true }, 200, cors) : json({ error: 'Could not save that.' }, 400, cors);
  }

  if (url.pathname === '/agent/welcome-seen' && req.method === 'POST') {
    const { ok } = await db.rpc('agent_mark_welcome_seen', {});
    return ok ? json({ ok: true }, 200, cors) : json({ error: 'Could not save that.' }, 400, cors);
  }

  // ── Text messages ──────────────────────────────────────────────────────────
  // Three things are deliberately NOT taken from the request body, no matter what
  // the browser sends: the consent sentence, its version, and the IP. All three
  // are evidence, and evidence a client can dictate is not evidence. The page and
  // this route import the same constant from shared/smsConsent.ts, so what was on
  // screen and what lands in the ledger cannot drift.

  if (url.pathname === '/agent/sms/opt-in' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as { phone?: string } | null;
    const phone = toE164US(b?.phone ?? '');
    if (!phone) {
      return json({ error: 'That doesn’t look like a US mobile number.' }, 422, cors);
    }
    const { ok } = await db.rpc('agent_sms_opt_in', {
      p_phone: phone,
      p_consent_text: SMS_CONSENT_TEXT,
      p_consent_version: SMS_CONSENT_VERSION,
      // Cloudflare sets this itself and strips any client-supplied copy, so it is
      // the one address here that a browser cannot lie about.
      p_ip: req.headers.get('CF-Connecting-IP'),
      p_user_agent: req.headers.get('User-Agent'),
    });
    return ok
      ? json({ ok: true }, 200, cors)
      : json({ error: 'Could not save that — try again.' }, 400, cors);
  }

  if (url.pathname === '/agent/sms/opt-out' && req.method === 'POST') {
    const { ok } = await db.rpc('agent_sms_opt_out', {});
    // An opt-out that silently fails is the worst bug in this file: the person
    // believes they have stopped and keeps receiving messages. Surface it.
    return ok
      ? json({ ok: true }, 200, cors)
      : json({ error: 'We could not turn that off. Email support@truhq.co and we will stop it by hand.' }, 400, cors);
  }

  if (url.pathname === '/agent/sms/decline' && req.method === 'POST') {
    const { ok } = await db.rpc('agent_sms_decline', {});
    return ok ? json({ ok: true }, 200, cors) : json({ error: 'Could not save that.' }, 400, cors);
  }

  if (url.pathname === '/agent/assessment' && req.method === 'POST') {
    const b = (await req.json().catch(() => null)) as {
      personalCode?: string; personalAxes?: unknown;
      businessCode?: string; tallies?: unknown; answers?: unknown;
    } | null;
    if (!b?.personalCode || !b?.businessCode) {
      return json({ error: 'incomplete assessment' }, 422, cors);
    }
    const { ok } = await db.rpc('submit_my_assessment', {
      p_personal_code: b.personalCode,
      p_personal_axes: b.personalAxes ?? null,
      p_business_code: b.businessCode,
      p_tallies: b.tallies ?? {},
      p_answers: b.answers ?? {},
    });
    return ok
      ? json({ ok: true }, 200, cors)
      : json({ error: 'Your result didn’t save — try again.' }, 400, cors);
  }

  return json({ error: 'not found' }, 404, cors);
}
