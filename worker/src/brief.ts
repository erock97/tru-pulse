// The weekly Leadership Brief — the retention moat. A proactive "your moves this
// week" email to each org's leader(s): pause candidates, slipping agents, and the
// GCI at risk. Push, don't make them pull. Sent by the weekly cron via Resend.
import type { Env } from './env.js';
import type { Db } from './db.js';

interface LeadLite { assigned_to: string | null; flag: string | null; }
interface CaseLite { assigned_to: string | null; opened_at: string; }

const money = (n: number) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export interface Brief { subject: string; html: string; hasContent: boolean; }

export async function buildBrief(database: Db, org: { id: string; name: string }): Promise<Brief> {
  const leads = (await database.select('leads', `org_id=eq.${org.id}&select=assigned_to,flag`)) as LeadLite[];
  const settingsRows = await database.select('org_settings', `org_id=eq.${org.id}&select=avg_gci,close_rate,strike_limit`);
  const s = (settingsRows[0] ?? {}) as { avg_gci?: number; close_rate?: number; strike_limit?: number };
  const sevenAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const cases30 = (await database.select(
    'accountability_cases',
    `org_id=eq.${org.id}&opened_at=gte.${thirtyAgo}&select=assigned_to,opened_at`,
  )) as CaseLite[];

  const total = leads.length;
  const zero = leads.filter((l) => l.flag === 'zero_contact').length;
  const stuck = leads.filter((l) => l.flag === 'stuck').length;
  const avgGci = Number(s.avg_gci ?? 10000);
  const closeRate = Number(s.close_rate ?? 2);
  const strikeLimit = Number(s.strike_limit ?? 3);
  const annualRisk = zero * (closeRate / 100) * avgGci * (365 / 30);

  const strikes = new Map<string, number>();
  for (const c of cases30) {
    const a = c.assigned_to ?? 'Unassigned';
    strikes.set(a, (strikes.get(a) ?? 0) + 1);
  }
  const newStrikes = cases30.filter((c) => c.opened_at >= sevenAgo).length;
  const pauseCandidates = [...strikes.entries()].filter(([, n]) => n >= strikeLimit).map(([a]) => a);
  const slipping = [...strikes.entries()]
    .filter(([, n]) => n > 0 && n < strikeLimit)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const moves: string[] = [];
  if (pauseCandidates.length) {
    moves.push(
      `<b>Confirm a pause</b> for ${pauseCandidates.map(esc).join(', ')} — ${strikeLimit}+ un-worked paid leads in 30 days. Review and flip lead flow if you agree.`,
    );
  }
  if (slipping.length) {
    moves.push(
      `<b>Check in</b> with ${slipping.map(([a, n]) => `${esc(a)} (${n})`).join(', ')} before they hit ${strikeLimit}.`,
    );
  }
  if (zero > 0) {
    moves.push(`<b>${zero} paid leads</b> still have zero personal contact — about ${money(annualRisk)}/yr in commission at risk.`);
  }
  const hasContent = moves.length > 0;
  const shown = hasContent ? moves : ['Nothing urgent — your team worked its paid leads this week. Nice.'];

  const subject = `TRU Pulse — your moves this week (${org.name})`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#33281a;">
    <div style="border-bottom:2px solid #a9791f;padding-bottom:10px;margin-bottom:16px;">
      <span style="font-weight:800;font-size:22px;">T<span style="color:#a9791f;">RU</span> <span style="font-weight:500;font-size:14px;color:#8a7a63;">Pulse &middot; Leadership Brief</span></span>
    </div>
    <p style="font-size:15px;">Here's what needs you this week at <b>${esc(org.name)}</b>.</p>
    <div style="background:#33281a;color:#fbf7f0;border-radius:12px;padding:16px 18px;margin:12px 0;">
      <div style="font-size:28px;font-weight:800;color:#a9791f;">${money(annualRisk)} / yr</div>
      <div style="font-size:12px;color:#cdbfa5;">GCI at risk from un-worked leads &middot; ${zero} zero-contact &middot; ${stuck} stuck &middot; ${newStrikes} new strikes this week</div>
    </div>
    <h3 style="font-size:14px;color:#a9791f;text-transform:uppercase;letter-spacing:.5px;">Your moves</h3>
    <ul style="font-size:14px;padding-left:18px;line-height:1.5;">${shown.map((t) => `<li style="margin:0 0 6px;">${t}</li>`).join('')}</ul>
    <p style="font-size:12px;color:#8a7a63;border-top:1px solid #e6dac6;padding-top:12px;margin-top:18px;">
      ${total} paid leads tracked across Zillow, Realtor.com, Homes.com, Facebook, Google &amp; referral networks. Pay-at-close counts — an un-worked one is still lost commission. Open TRU Pulse for the full worklist.
    </p>
  </div>`;
  return { subject, html, hasContent };
}

async function leaderEmails(env: Env, database: Db, orgId: string): Promise<string[]> {
  const members = (await database.select(
    'memberships',
    `org_id=eq.${orgId}&role=in.(admin,leader)&select=user_id`,
  )) as Array<{ user_id: string }>;
  const emails: string[] = [];
  for (const m of members) {
    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/users/' + m.user_id, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY },
    });
    if (res.ok) {
      const u = (await res.json()) as { email?: string };
      if (u.email) emails.push(u.email);
    }
  }
  return emails;
}

export async function sendWeeklyBriefs(env: Env, database: Db) {
  if (!env.RESEND_API_KEY || !env.BRIEF_FROM) return { skipped: 'RESEND_API_KEY / BRIEF_FROM not set' };
  const orgs = (await database.select('orgs', 'status=eq.active&select=id,name')) as Array<{ id: string; name: string }>;
  const out: Record<string, unknown> = {};
  for (const org of orgs) {
    try {
      const brief = await buildBrief(database, org);
      const to = await leaderEmails(env, database, org.id);
      if (!to.length) {
        out[org.id] = { skipped: 'no recipients' };
        continue;
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.BRIEF_FROM, to, subject: brief.subject, html: brief.html }),
      });
      out[org.id] = { sent: res.ok, recipients: to.length };
    } catch (e) {
      out[org.id] = { error: String(e) };
    }
  }
  return out;
}
