// Whether a message may actually leave the building, and by which road.
//
// decideSendMode is the single gate. It is pure, it is called FRESH at send time
// rather than read from whatever was decided when the message was queued, and
// its ordering is deliberate: **dry-run is the fall-through, and 'live' is
// reachable only after every lock has passed.** Any new condition added here
// should be another reason to fall short of live, never a shortcut to it.
//
// The distinction that matters most is between "sending is impossible" and
// "sending was attempted and failed". A missing secret is the first. If those
// two ever collapse into one, an outage looks like a quiet day.

import type { Env } from '../env.js';
import type { Mode } from './types.js';

export type Channel = 'email' | 'relay' | 'twilio';

export interface Message {
  channel: Channel;
  /** e164 or an email address. Never rendered to a browser un-redacted. */
  to: string;
  body: string;
  subject?: string;
  /**
   * The second idempotency layer, independent of the run claim: a hash of
   * (automation, slot, channel, target, body). Written before any network call,
   * so a duplicate throws instead of sending.
   */
  dedupeKey: string;
}

export type SendDecision =
  | { mode: 'live' }
  | { mode: 'dry_run'; reason: string }
  | { mode: 'blocked'; reason: string };

export interface SendLocks {
  /** platform_flags.automation_enabled */
  globalEnabled: boolean;
  /** platform_flags.automation_live_sends */
  globalLiveSends: boolean;
  /** env.AUTOMATION_KILL === '1' — the backstop for when Postgres is the problem */
  envKill: boolean;
  /** Secrets for THIS adapter are actually present. */
  channelConfigured: boolean;
  /** An unexpired automation_capabilities row for this team. */
  capabilityGranted: boolean;
  /** The compile-time allow-list agrees. Two locks, not one. */
  teamAllowListed: boolean;
  /** The per-automation live-send switch. */
  automationLive: boolean;
  automationMode: Mode;
  target: string | null;
}

export function decideSendMode(o: SendLocks): SendDecision {
  // No recipient is blocked rather than dry-run: there is nothing to preview.
  if (!o.target) return { mode: 'blocked', reason: 'nobody is set to receive this' };

  // Read at SEND time, so flipping the switch mid-run stops the very next
  // message rather than the next run.
  if (o.envKill) return { mode: 'blocked', reason: 'stopped by the kill switch' };
  if (!o.globalEnabled) return { mode: 'blocked', reason: 'automations are stopped platform-wide' };

  if (o.automationMode === 'off') return { mode: 'blocked', reason: 'this agent is off' };
  if (o.automationMode === 'notify_only') return { mode: 'dry_run', reason: 'watch only' };

  // Below here the automation WANTS to send. Everything remaining is a reason it
  // may not, and each one lands in dry-run so the run log still records exactly
  // what would have gone out.
  if (!o.channelConfigured) return { mode: 'dry_run', reason: 'this delivery route is not set up yet' };
  if (!o.capabilityGranted || !o.teamAllowListed) {
    return { mode: 'dry_run', reason: 'this team has not been cleared for it' };
  }
  if (!o.globalLiveSends) return { mode: 'dry_run', reason: 'live sending is off platform-wide' };
  if (!o.automationLive) return { mode: 'dry_run', reason: 'this agent is not live yet' };

  return { mode: 'live' };
}

// ── Email ────────────────────────────────────────────────────────────────────
// The one route that works today. Same Resend call shape as the weekly brief.

export function emailConfigured(env: Env): boolean {
  return !!env.RESEND_API_KEY && !!env.BRIEF_FROM;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

export async function sendEmail(env: Env, msg: Message): Promise<SendResult> {
  const from = env.BRIEF_FROM ?? '';
  // Resend has exactly one verified domain on this account and rejects any other
  // sender SILENTLY — the call succeeds and the mail never arrives, which is the
  // failure mode that hides for weeks. Refusing here turns it into an error
  // somebody can see.
  if (!/@truhq\.co>?\s*$/.test(from.trim())) {
    return { ok: false, error: `sender must be @truhq.co, got "${from}"` };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject ?? 'TRU Pulse',
      // The brief is written as a text message, so the email shows it as one
      // rather than dressing it up into something that reads differently from
      // what the phone gets.
      html:
        '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'white-space:pre-wrap;font-size:15px;line-height:1.55;color:#12211a">' +
        esc(msg.body) +
        '</div>',
      text: msg.body,
    }),
  });

  if (!res.ok) return { ok: false, error: `resend ${res.status}: ${await res.text()}` };
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, providerId: body.id };
}

/**
 * A stable key for one intended send. Same automation, same slot, same target
 * and same words means the same key, so a retry collapses rather than repeats.
 */
export async function dedupeKey(parts: {
  automationId: string; slot: string; channel: Channel; target: string; body: string;
}): Promise<string> {
  const input = [parts.automationId, parts.slot, parts.channel, parts.target, parts.body].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
