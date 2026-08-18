// Leader invites — mint a Supabase auth link and email it.
//
// SENDER: this module reads INVITE_FROM and nothing else. BRIEF_FROM belongs to
// the weekly report mail (hustle score / PCVR) that leaders already rely on;
// keeping the two senders independent means an invite problem can never take
// reporting down. Resend has exactly ONE verified domain, truhq.co — any other
// domain is rejected silently, so INVITE_FROM must be @truhq.co.
import type { Env } from './env.js';

export type InviteKind = 'leader' | 'agent';

export function inviteEmailSubject(orgName: string, kind: InviteKind = 'leader'): string {
  if (kind === 'agent') return `Set your password for your ${orgName} HQ`;
  return `Set your password for ${orgName} on TRU HQ`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Warm gold on near-black, matching the TRU HQ auth screens. */
export function inviteEmailHtml(o: { name: string; orgName: string; link: string; kind?: InviteKind }): string {
  const name = escapeHtml(o.name.split(' ')[0] || o.name);
  const org = escapeHtml(o.orgName);
  const link = escapeHtml(o.link);
  const kind = o.kind ?? 'leader';
  const headline = kind === 'agent'
    ? `${name}, your training and your Coach are ready.`
    : `${name}, your ${org} account is ready.`;
  const body = kind === 'agent'
    ? `Set your login and password. You&rsquo;ll land in your own HQ &mdash; training, your Coach, and the work ahead.`
    : `Set your password and you&rsquo;re in &mdash; Pulse and Coach, your whole team in one place.`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#111014;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111014;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#17161b;border:1px solid #2a2731;border-radius:16px;padding:32px">
        <tr><td style="color:#e8c98a;font-size:13px;letter-spacing:.14em;text-transform:uppercase;padding-bottom:18px">TRU HQ</td></tr>
        <tr><td style="color:#f4ecdc;font-size:23px;line-height:1.3;font-weight:600;padding-bottom:14px">
          ${headline}
        </td></tr>
        <tr><td style="color:#a9a3b4;font-size:15px;line-height:1.6;padding-bottom:26px">
          ${body}
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${link}" style="display:inline-block;background:#e8c98a;color:#17161b;font-size:15px;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:10px">
            Set your password
          </a>
        </td></tr>
        <tr><td style="color:#6f6a7a;font-size:13px;line-height:1.6">
          This link works once and expires in 24 hours. If it&rsquo;s expired, reply and we&rsquo;ll send a fresh one.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Create-or-reuse the auth user and get a one-time link they can sign in with.
 * `invite` creates the user; `recovery` is for an email that already has one.
 */
export async function mintAuthLink(
  env: Env,
  email: string,
  kind: 'invite' | 'recovery',
): Promise<{ link: string; userId: string | null }> {
  const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: kind, email, redirect_to: 'https://app.truhq.co' }),
  });
  const gl = (await res.json().catch(() => null)) as any;
  const props = gl?.properties ?? gl;
  const link = props?.action_link;
  if (!res.ok || !link) throw new Error(`could not mint ${kind} link for ${email}`);
  return { link, userId: gl?.user?.id ?? gl?.id ?? null };
}

/** True when Resend accepted it. Never throws — the caller reports per leader. */
export async function sendInviteEmail(
  env: Env,
  o: { to: string; name: string; orgName: string; link: string; kind?: InviteKind },
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.INVITE_FROM) return false;
  const kind = o.kind ?? 'leader';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.INVITE_FROM,
        to: o.to,
        subject: inviteEmailSubject(o.orgName, kind),
        html: inviteEmailHtml({ name: o.name, orgName: o.orgName, link: o.link, kind }),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Does this email already have a login? Decides invite vs recovery. */
export async function authUserIdByEmail(env: Env, email: string): Promise<string | null> {
  const u = new URL(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/users');
  u.searchParams.set('filter', email);
  const res = await fetch(u.toString(), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as any;
  const users: any[] = body?.users ?? [];
  const hit = users.find((x) => String(x?.email ?? '').toLowerCase() === email.toLowerCase());
  return hit?.id ?? null;
}
