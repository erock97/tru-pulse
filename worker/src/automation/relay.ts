// The phone relay: how the daily brief actually reaches a handset.
//
// There is no Twilio number yet, so the phone that sends the text is Eric's
// own. Tasker polls a URL on a schedule and texts whatever comes back. The
// agent-nudge relay in fub-kpi-puller already works this way and has for
// months, so this speaks the identical wire format — cloning that Tasker
// profile and changing the URL is the entire setup.
//
// What it does not copy is that relay's one real flaw. Its queue hands the same
// blob to every caller, so a retry, a second phone, or Tasker firing twice on a
// flaky network re-sends everything. Here, asking for the queue CLAIMS it.
//
// ── Built when asked for, not on a schedule ─────────────────────────────────
// The obvious design is a cron that builds the brief and a poll that collects
// it. That needs the two to be ordered correctly against a THIRD clock — the
// Hermes laptop, which posts the analysis at 5am Pacific. Get the order wrong
// and the brief is silently built from yesterday's thinking, which is the exact
// failure mode nobody notices.
//
// So there is no build cron. The poll builds it, from whatever the store holds
// at that moment, and claims it in the same breath. One clock, no ordering.
//
// ── Claiming and telling are separate ───────────────────────────────────────
// The claim stops a second send today. Marking the underlying habits as told is
// a different decision and waits for the phone to confirm the text left. If
// Tasker claims a brief and then fails to send it, the claim stands — nothing
// goes out twice — but the habits stay unmarked and tomorrow offers them again.
// A lost text is retried rather than dropped in a way nobody could spot.

import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { previewCoachBriefs, markBriefed, type TeamBrief } from './coachBrief.js';

/** The format Eric's existing Tasker profile already parses. */
const REC_SEP = '@@@NEXT@@@';
const FIELD_SEP = '~~~';
export const NOTHING = 'EMPTY';

/**
 * An analysis older than this is not today's news, and a brief that presents it
 * as today's news is worse than no brief. Hermes runs daily, so a day and a half
 * of silence means the laptop did not run — which the health check reports, and
 * which this must not paper over by texting stale coaching.
 */
const STALE_AFTER_HOURS = 36;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fail closed. An unset RELAY_TOKEN must never make the queue public. */
export function relayAuthorised(token: string | null, env: Env): boolean {
  if (!env.RELAY_TOKEN) return false;
  return timingSafeEqual(token ?? '', env.RELAY_TOKEN);
}

/** Phone last four only. Full numbers live in the database and nowhere else. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `...${digits.slice(-4)}` : '...';
}

/** E.164-ish: eleven digits starting with 1, or ten we can prefix. */
export function normalisePhone(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return null;
}

/** The date the recipient is living in, which is the one the claim is keyed on. */
export function localDate(now: Date, timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function dateLabel(now: Date, timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric',
  }).format(now).replace(',', '');
}

function hoursSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Infinity;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? Infinity : (now.getTime() - then) / 3_600_000;
}

export interface QueuedBrief {
  teamId: string;
  team: string;
  recipient: string;
  body: string;
  segments: number;
  patternIds: string[];
  sendId: string;
}

export interface BuildResult {
  queued: QueuedBrief[];
  /** Teams that produced nothing, and why. Visible so quiet is explainable. */
  skipped: Array<{ team: string; reason: string }>;
}

/**
 * Build today's briefs and claim them.
 *
 * A team drops out at the first honest reason to: nobody to text, nothing new
 * since yesterday, an analysis too old to present as today's, or a brief
 * already claimed this morning. Each is recorded rather than silently skipped —
 * a quiet morning and a broken relay look identical from the outside otherwise.
 */
export async function buildAndClaim(
  database: Db,
  now: Date,
  opts: { peek?: boolean } = {},
): Promise<BuildResult> {
  const day = localDate(now);
  const [briefs, recipients] = await Promise.all([
    previewCoachBriefs(database, dateLabel(now)),
    database.select('brief_recipients', 'active=eq.true&select=team_id,kind,phone') as Promise<any[]>,
  ]);

  const phoneFor = new Map<string, string>();
  for (const r of recipients) {
    if (r.kind === 'coach_daily' && !phoneFor.has(r.team_id)) phoneFor.set(r.team_id, r.phone);
  }

  const queued: QueuedBrief[] = [];
  const skipped: Array<{ team: string; reason: string }> = [];

  for (const b of briefs as TeamBrief[]) {
    const phone = phoneFor.get(b.teamId);
    if (!phone) { skipped.push({ team: b.team, reason: 'no recipient set' }); continue; }
    if (b.needing === 0) { skipped.push({ team: b.team, reason: 'nothing new since yesterday' }); continue; }

    const age = hoursSince(b.lastUpdate, now);
    if (age > STALE_AFTER_HOURS) {
      skipped.push({ team: b.team, reason: `analysis is ${Math.round(age)}h old` });
      continue;
    }

    const row = {
      team_id: b.teamId,
      kind: 'coach_daily',
      local_date: day,
      idempotency_key: `${b.teamId}:coach_daily:${day}`,
      recipient: phone,
      body: b.body,
      segments: b.segments,
      pattern_ids: b.patternIds,
      status: opts.peek ? 'queued' : 'claimed',
      claimed_at: opts.peek ? null : now.toISOString(),
    };

    if (opts.peek) {
      // Show what would go out without taking the key. A look must never
      // consume the send, the same rule the brief preview follows.
      queued.push({
        teamId: b.teamId, team: b.team, recipient: phone, body: b.body,
        segments: b.segments, patternIds: b.patternIds, sendId: 'peek',
      });
      continue;
    }

    try {
      // The claim IS this insert. Two polls racing both reach here; the unique
      // key means exactly one of them wins, with no read-then-write window in
      // between for the other to slip through.
      const saved = await database.insert('brief_sends', row);
      queued.push({
        teamId: b.teamId, team: b.team, recipient: phone, body: b.body,
        segments: b.segments, patternIds: b.patternIds, sendId: saved.id,
      });
    } catch (e) {
      const msg = String(e);
      if (/duplicate key|23505/i.test(msg)) {
        skipped.push({ team: b.team, reason: 'already sent today' });
      } else {
        throw e;
      }
    }
  }

  return { queued, skipped };
}

/** `<digits>~~~<message>` joined by `@@@NEXT@@@`, or EMPTY. */
export function toTaskerText(queued: QueuedBrief[]): string {
  if (!queued.length) return NOTHING;
  return queued.map((q) => q.recipient + FIELD_SEP + q.body).join(REC_SEP);
}

/**
 * The phone confirming the text left. This is where the habits are finally
 * marked as told — never at claim time, so a claim that never reached anybody
 * gets another chance tomorrow.
 */
export async function acknowledge(
  database: Db,
  sendIds: string[],
  now: Date,
): Promise<{ acked: number; patternsMarked: number }> {
  if (!sendIds.length) return { acked: 0, patternsMarked: 0 };

  const rows = (await database.select(
    'brief_sends',
    `id=in.(${sendIds.join(',')})&status=eq.claimed&select=id,pattern_ids`,
  )) as any[];

  let patternsMarked = 0;
  for (const row of rows) {
    await database.update('brief_sends', `id=eq.${row.id}`, {
      status: 'sent',
      sent_at: now.toISOString(),
    });
    const ids = Array.isArray(row.pattern_ids) ? (row.pattern_ids as string[]) : [];
    patternsMarked += await markBriefed(database, ids);
  }
  return { acked: rows.length, patternsMarked };
}

/**
 * Routes that live OUTSIDE /admin/, because Tasker carries no login session.
 * Returns null for anything it does not own, so the caller falls through.
 */
export async function handleRelayRoutes(
  req: Request,
  env: Env,
  database: Db,
  url: URL,
  now: Date = new Date(),
): Promise<Response | null> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });

  if (!url.pathname.startsWith('/relay/')) return null;

  if (!relayAuthorised(url.searchParams.get('token'), env)) {
    return json({ error: 'unauthorized' }, 401);
  }

  // GET /relay/queue?token=...&format=text[&peek=1]
  if (url.pathname === '/relay/queue' && req.method === 'GET') {
    const peek = url.searchParams.get('peek') === '1';
    const { queued, skipped } = await buildAndClaim(database, now, { peek });

    if (url.searchParams.get('format') === 'text') {
      return new Response(toTaskerText(queued), {
        status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return json({
      date: localDate(now),
      peek,
      // Everything a person needs to see without the message bodies or the
      // full number: what would go where, and why a team is quiet.
      queued: queued.map((q) => ({
        sendId: q.sendId, team: q.team, to: maskPhone(q.recipient),
        segments: q.segments, chars: q.body.length,
      })),
      skipped,
    });
  }

  // POST /relay/ack?token=...   body: { sendIds: [...] }
  if (url.pathname === '/relay/ack' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray((body as any)?.sendIds)
      ? ((body as any).sendIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    return json(await acknowledge(database, ids, now));
  }

  return json({ error: 'not found' }, 404);
}
