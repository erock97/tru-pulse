// Public application intake. This is the ONLY unauthenticated write path in the
// Worker, so it validates hard, caps every field, and never trusts the client.
//
// Storing the submission is also what makes the retention and deletion promises
// in the privacy policy honourable — before this there would have been nothing
// to produce or delete if someone asked.
import type { Env } from './env.js';
import type { Db } from './db.js';

export interface ApplicationInput {
  fullName: string;
  email: string;
  role: string;
  teamSize: string;
  bottleneck: string;
  marketingOptIn: boolean;
  consentText: string;
  consentAt: string;
  sourcePath: string | null;
}

type Result =
  | { ok: true; value: ApplicationInput }
  | { ok: false; error: string };

const LIMITS: Record<string, number> = {
  fullName: 200, email: 320, role: 80, teamSize: 40, bottleneck: 5000, consentText: 2000,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function validateApplication(body: unknown): Result {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad body' };
  const b = body as Record<string, unknown>;

  // Honeypot: a human never sees this field. Reported with its own reason so the
  // route can answer with a success shape and store nothing — a bot that gets a
  // 422 learns which field gave it away.
  if (str(b.website)) return { ok: false, error: 'honeypot' };

  const fullName = str(b.fullName);
  const email = str(b.email).toLowerCase();
  const role = str(b.role);
  const teamSize = str(b.teamSize);
  const bottleneck = str(b.bottleneck);
  const consentText = str(b.consentText);
  const consentAt = str(b.consentAt);

  for (const [k, v] of Object.entries({ fullName, email, role, teamSize, bottleneck })) {
    if (!v) return { ok: false, error: `${k} is required` };
    if (v.length > LIMITS[k]) return { ok: false, error: `${k} is too long` };
  }
  if (!EMAIL.test(email)) return { ok: false, error: 'that email address looks wrong' };

  // Consent that cannot be evidenced later is not worth recording.
  if (!consentText) return { ok: false, error: 'consent text missing' };
  if (consentText.length > LIMITS.consentText) return { ok: false, error: 'consent text is too long' };
  if (!consentAt || Number.isNaN(Date.parse(consentAt))) return { ok: false, error: 'consent timestamp missing' };

  // Note the explicit shape: a `phone` posted by anything never survives into
  // the stored record, because we deliberately do not collect one.
  return {
    ok: true,
    value: {
      fullName, email, role, teamSize, bottleneck,
      marketingOptIn: Boolean(b.marketingOptIn),
      consentText, consentAt,
      sourcePath: str(b.sourcePath) || null,
    },
  };
}

// Salted hash — enough to rate-limit a repeat submitter, not enough to identify
// one. The salt is an existing Worker secret, so no new key to manage.
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recentlySubmitted(database: Db, ipHash: string, max = 5): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await database.select('applications', `ip_hash=eq.${ipHash}&created_at=gte.${since}&select=id`);
  return rows.length >= max;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// Reuses the Resend setup already in place for the weekly Leadership Brief.
// Returns false rather than throwing — a failed notification must never fail the
// request, because the lead is already safely stored by then.
export async function notify(env: Env, input: ApplicationInput): Promise<boolean> {
  const to = (env.APPLY_NOTIFY_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.BRIEF_FROM || !to.length) return false;

  const html = `
    <h2>New application &mdash; ${esc(input.fullName)}</h2>
    <p>
      <b>Email:</b> ${esc(input.email)}<br/>
      <b>Role:</b> ${esc(input.role)}<br/>
      <b>Team size:</b> ${esc(input.teamSize)}<br/>
      <b>Marketing opt-in:</b> ${input.marketingOptIn ? 'YES' : 'no'}
    </p>
    <p><b>Biggest bottleneck</b><br/>${esc(input.bottleneck).replace(/\n/g, '<br/>')}</p>
    <p style="color:#777;font-size:12px">Submitted from ${esc(input.sourcePath ?? '/apply')}</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.BRIEF_FROM,
      to,
      reply_to: input.email,
      subject: `New application — ${input.fullName}`,
      html,
    }),
  });
  return res.ok;
}
