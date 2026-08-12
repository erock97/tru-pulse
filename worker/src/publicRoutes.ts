// The one path that must work with NO login: an agent opening their assessment or
// check-in link.
//
// These database functions are SECURITY DEFINER and were callable by anyone holding the
// anon key that ships in our JavaScript — the last public door. Behind the Worker they
// get an allowlist, a token check, and rate limiting, and the anon key can eventually
// stop being shipped at all.
//
// The token IS the capability, exactly as the database treats it. That's deliberate:
// an agent has no account, so a long unguessable link is what authorises them. What
// changes is that abuse is now bounded.
import type { Env } from './env.js';

/** Only these functions are reachable. Anything else is a 404, not a passthrough. */
const ALLOWED: Record<string, string[]> = {
  'resolve-join-token':   ['p_token'],
  'resolve-cohort-roster':['p_token'],
  'resolve-invite-token': ['p_token'],
  'get-agent-home':       ['p_token'],
  'enroll-agent':         ['p_token', 'p_name', 'p_email', 'p_phone', 'p_code', 'p_answers', 'p_tallies'],
  'submit-assessment':    ['p_token', 'p_agent_id', 'p_personal_code', 'p_personal_axes', 'p_business_code', 'p_tallies', 'p_answers'],
  'save-checkin':         ['p_token', 'p_met', 'p_leads', 'p_convos', 'p_win', 'p_focus'],
  'toggle-commitment':    ['p_token', 'p_commitment_id', 'p_done'],
};

/** URL segment → database function name. Kept explicit so a typo can't reach anything. */
const FN: Record<string, string> = {
  'resolve-join-token': 'resolve_join_token',
  'resolve-cohort-roster': 'resolve_cohort_roster',
  'resolve-invite-token': 'resolve_invite_token',
  'get-agent-home': 'get_agent_home',
  'enroll-agent': 'enroll_agent',
  'submit-assessment': 'submit_cohort_assessment',
  'save-checkin': 'agent_save_checkin',
  'toggle-commitment': 'agent_toggle_commitment',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Generous enough that a real agent working through an assessment never notices, tight
// enough that grinding tokens or spamming submissions isn't viable.
const MAX_PER_WINDOW = 60;
const WINDOW_SECONDS = 600;

const json = (obj: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

export async function handlePublicRoutes(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/public/')) return null;
  if (req.method !== 'POST') return json({ error: 'not found' }, 404, cors);

  const action = url.pathname.slice('/public/'.length);
  const fn = FN[action];
  if (!fn) return json({ error: 'not found' }, 404, cors);

  const ip = req.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const rlKey = `prl:${ip}`;
  const used = Number((await env.SESSIONS.get(rlKey)) ?? '0');
  if (used >= MAX_PER_WINDOW) {
    return json({ error: 'too many requests — give it a few minutes' }, 429, cors);
  }
  await env.SESSIONS.put(rlKey, String(used + 1), { expirationTtl: WINDOW_SECONDS });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid body' }, 422, cors);

  // Every one of these is authorised by the token, so a missing or malformed one is
  // refused before it reaches the database.
  const token = String(body.p_token ?? '');
  if (!UUID_RE.test(token)) return json({ error: 'invalid or missing token' }, 401, cors);

  // Pass ONLY the parameters that function declares. Anything extra is dropped rather
  // than forwarded, so a caller can't probe for other arguments.
  const args: Record<string, unknown> = {};
  for (const k of ALLOWED[action]) if (k in body) args[k] = body[k];

  // Called with the anon key and NO user token: these are SECURITY DEFINER functions
  // whose whole purpose is to work for someone with no account. The key stays here on
  // the server — that is the point of routing this through the Worker.
  const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + `/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    // Don't echo the database's error text: for a token-authorised endpoint that can
    // leak whether a token or row exists.
    return json({ error: 'that link is not valid, or has expired' }, 400, cors);
  }
  const text = await res.text();
  return json({ data: text ? JSON.parse(text) : null }, 200, cors);
}
