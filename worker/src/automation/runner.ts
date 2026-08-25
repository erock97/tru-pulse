// The scheduled side of TRU Agents.
//
// One rule shapes this file: **claim first, work second.** The very first thing
// a run does is insert its own row with a unique idempotency key. If a second
// caller is already inside that slot — a retried cron, an overlapping tick, a
// double-clicked "Run now" — the insert loses the race and this one stops
// without having fetched or sent anything.
//
// Everything else is a rail, and every rail writes a visible status. A cap or a
// staleness guard that silently no-ops is indistinguishable from a runner that
// is simply broken, and the second one is the thing you find out about when a
// client asks why they stopped hearing from you.

import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { renderMorningBrief, toGsm7, type BriefAgent } from './morningBrief.js';
import {
  dedupeKey, decideSendMode, emailConfigured, sendEmail, type Channel, type Message,
} from './notify.js';
import type { Mode } from './types.js';

/** Per-org rails. A rule that suddenly matches everything is the real hazard. */
const ORG_HOURLY_CAP = 20;
const ORG_DAILY_CAP = 60;

export interface RunOutcome {
  status: string;
  automationId: string;
  teamName?: string;
  detail?: Record<string, unknown>;
}

const iso = (d: Date) => d.toISOString();

/** First name + last initial. A brief never carries more of anyone's name. */
export function shortName(full: string): string {
  const parts = toGsm7(full).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Unknown';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * The team's local wall clock, as {date, hhmm}.
 *
 * "Morning brief" is a local-time idea and four of the five teams are Eastern
 * while the existing text relay runs on a Pacific date boundary — so this cannot
 * be fudged with an offset. Intl carries the DST rules; a hand-rolled offset
 * would be wrong twice a year, in the dark, on a schedule.
 */
export function localClock(now: Date, timeZone: string): { date: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${get('hour')}:${get('minute')}`,
  };
}

/** e.g. 'Mon Aug 25', in the team's own timezone. */
export function localDateLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric',
  }).format(now);
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * Due if the team's local clock is inside [sendAt, sendAt + toleranceMin).
 *
 * A window rather than an instant, because a cron tick can be missed and a brief
 * that silently skips a day is worse than one that arrives twenty minutes late.
 * The overlap is safe only because the run claim collapses it to one send — the
 * two mechanisms are a pair and neither works alone.
 */
export function isBriefDue(local: { hhmm: string }, sendAt: string, toleranceMin = 20): boolean {
  const now = toMinutes(local.hhmm);
  const start = toMinutes(sendAt);
  return now >= start && now < start + toleranceMin;
}

interface TeamRow {
  id: string; org_id: string; name: string; timezone: string | null;
}

/** Everything the brief needs for one team, in three narrow queries. */
export async function gatherBrief(
  database: Db,
  team: TeamRow,
  now: Date,
): Promise<{ agents: BriefAgent[]; pondLeads: number; syncAgeHours: number | null }> {
  const dayAgo = iso(new Date(now.getTime() - 24 * 3600_000));
  const graceAgo = iso(new Date(now.getTime() - 36 * 3600_000));
  const windowAgo = iso(new Date(now.getTime() - 48 * 3600_000));
  // Bounded on purpose. "Sitting in Lead stage" over all time is a backlog, not
  // a morning signal — one agent has 1,970 of them. A week is the horizon in
  // which a lead going quiet is still something you can do anything about.
  const recentAgo = iso(new Date(now.getTime() - 7 * 86400_000));

  // Filters pushed into PostgREST rather than pulling the team's whole lead
  // history and filtering in JS. Each of these returns tens of rows; the
  // unfiltered version returns ten thousand for the largest team.
  const [fresh, untouched, stalled, syncRows] = await Promise.all([
    database.select('leads', `team_id=eq.${team.id}&fub_created=gte.${dayAgo}&select=assigned_to`),
    database.select('leads',
      `team_id=eq.${team.id}&flag=eq.zero_contact&fub_created=lt.${graceAgo}` +
      `&fub_created=gte.${recentAgo}&assigned_to=not.is.null&select=assigned_to`),
    database.select('leads',
      `team_id=eq.${team.id}&flag=eq.stuck&fub_created=lt.${windowAgo}` +
      `&fub_created=gte.${recentAgo}&assigned_to=not.is.null&select=assigned_to`),
    database.select('sync_state', `team_id=eq.${team.id}&select=last_sync_at`),
  ]);

  const byAgent = new Map<string, BriefAgent>();
  const bump = (name: string, k: 'newLeads' | 'untouched' | 'stalled') => {
    const key = shortName(name);
    const cur = byAgent.get(key) ?? { name: key, newLeads: 0, untouched: 0, stalled: 0 };
    cur[k] += 1;
    byAgent.set(key, cur);
  };

  let pondLeads = 0;
  for (const l of fresh as any[]) {
    if (l.assigned_to) bump(l.assigned_to, 'newLeads');
    else pondLeads += 1; // Real arrivals, but nobody's fault yet.
  }
  for (const l of untouched as any[]) bump(l.assigned_to, 'untouched');
  for (const l of stalled as any[]) bump(l.assigned_to, 'stalled');

  const lastSync = (syncRows as any[])[0]?.last_sync_at ?? null;
  const syncAgeHours = lastSync
    ? (now.getTime() - Date.parse(lastSync)) / 3600_000
    : null;

  return { agents: [...byAgent.values()], pondLeads, syncAgeHours };
}

/**
 * Run one scheduled automation, having already decided it is due.
 *
 * Returns without side effects of any kind when the claim is lost.
 */
export async function runOne(
  env: Env,
  database: Db,
  auto: any,
  team: TeamRow,
  now: Date,
): Promise<RunOutcome> {
  const tz = team.timezone ?? 'America/Los_Angeles';
  const local = localClock(now, tz);
  const sendAt = String(auto.config?.send_at ?? '07:30');
  const slot = `${local.date}:${sendAt}`;
  const mode = auto.mode as Mode;

  // ── The claim. First statement, before any read of lead data and before any
  // fetch. A unique violation here means somebody else already owns this slot.
  let run: any;
  try {
    run = await database.insert('automation_runs', {
      org_id: team.org_id,
      team_id: team.id,
      automation_id: auto.id,
      type_key: auto.type_key,
      idempotency_key: `${auto.id}:${slot}`,
      trigger: 'cron',
      // The mode AT RUN TIME. A later config change must not rewrite what this
      // run was permitted to do.
      mode,
      status: 'claimed',
    });
  } catch {
    return { status: 'already_claimed', automationId: auto.id, teamName: team.name };
  }

  const finish = async (status: string, patch: Record<string, unknown> = {}) => {
    await database.update('automation_runs', `id=eq.${run.id}`, {
      status, finished_at: iso(new Date()), ...patch,
    });
    return { status, automationId: auto.id, teamName: team.name, detail: patch.detail as any };
  };

  try {
    // ── Rails, each ending the run with a status somebody can read.
    const flags = await database.select('platform_flags', 'select=key,bool_value');
    const flag = (k: string, dflt: boolean) => {
      const r = (flags as any[]).find((f) => f.key === k);
      return r ? !!r.bool_value : dflt;
    };
    if (env.AUTOMATION_KILL === '1' || !flag('automation_enabled', true)) {
      return finish('skipped_killed');
    }

    const todayFrom = iso(new Date(now.getTime() - 24 * 3600_000));
    const [mine, orgHour, orgDay] = await Promise.all([
      database.select('automation_runs',
        `automation_id=eq.${auto.id}&status=eq.ok&started_at=gte.${todayFrom}&select=id`),
      database.select('automation_deliveries',
        `org_id=eq.${team.org_id}&created_at=gte.${iso(new Date(now.getTime() - 3600_000))}&select=id`),
      database.select('automation_deliveries',
        `org_id=eq.${team.org_id}&created_at=gte.${todayFrom}&select=id`),
    ]);
    const caps = {
      perAutomation: (mine as any[]).length,
      orgHour: (orgHour as any[]).length,
      orgDay: (orgDay as any[]).length,
    };
    if (caps.perAutomation >= Number(auto.max_per_day ?? 2)
      || caps.orgHour >= ORG_HOURLY_CAP || caps.orgDay >= ORG_DAILY_CAP) {
      return finish('skipped_capped', { detail: caps });
    }

    // ── Build. Pure from here to the message.
    const data = await gatherBrief(database, team, now);
    const recipientName = auto.secure_config?.recipient_name
      ? shortName(String(auto.secure_config.recipient_name))
      : undefined;
    const rendered = renderMorningBrief({
      teamName: team.name,
      dateLabel: localDateLabel(now, tz),
      agents: data.agents,
      pondLeads: data.pondLeads,
      syncAgeHours: data.syncAgeHours,
      recipientName,
    });

    if (rendered.skipReason === 'stale_sync') {
      // The lead gets nothing. Sending yesterday's numbers as today's is the one
      // failure that costs the brief its credibility permanently.
      return finish('skipped_stale', {
        summary: 'held back: no fresh data from Follow Up Boss',
        detail: { syncAgeHours: data.syncAgeHours },
      });
    }

    const channel: Channel = (auto.secure_config?.channel as Channel) ?? 'email';
    const target = String(
      auto.secure_config?.recipient_email ?? auto.secure_config?.recipient_phone ?? '',
    ) || null;

    const caps2 = await database.select('automation_capabilities',
      `team_id=eq.${team.id}&select=capability,expires_at`);
    const capability = auto.capability ?? null;
    const capabilityGranted = !capability || (caps2 as any[]).some(
      (c) => c.capability === capability
        && (!c.expires_at || Date.parse(c.expires_at) > now.getTime()),
    );

    const decision = decideSendMode({
      globalEnabled: flag('automation_enabled', true),
      globalLiveSends: flag('automation_live_sends', false),
      envKill: env.AUTOMATION_KILL === '1',
      channelConfigured: channel === 'email' ? emailConfigured(env) : false,
      capabilityGranted,
      // Email to a platform owner is not a customer-facing send, so the
      // compile-time team allow-list does not gate it. Every other channel does
      // gate on it, and that list is empty today.
      teamAllowListed: channel === 'email',
      automationLive: !!auto.sms_live || channel === 'email',
      automationMode: mode,
      target,
    });

    // Redacted. First-name-last-initial and counts only — never a lead's name,
    // and never the recipient's actual address.
    const summary =
      `${data.agents.reduce((n, a) => n + a.newLeads, 0) + data.pondLeads} new, `
      + `${data.agents.filter((a) => a.untouched || a.stalled).length} needing outreach, `
      + `${rendered.segments} segment(s), ${decision.mode}`;

    if (decision.mode === 'blocked') {
      return finish('no_content', { summary: `${summary} — ${decision.reason}` });
    }

    const key = await dedupeKey({
      automationId: auto.id, slot, channel, target: target ?? '', body: rendered.body,
    });
    const msg: Message = {
      channel, to: target ?? '', body: rendered.body, dedupeKey: key,
      subject: `${team.name} — morning brief`,
    };

    // The delivery row is written BEFORE any network call, so a duplicate key
    // throws here rather than after the message has already gone out.
    let delivery: any;
    try {
      delivery = await database.insert('automation_deliveries', {
        org_id: team.org_id, team_id: team.id, run_id: run.id,
        channel, dedupe_key: key, target: msg.to, body: msg.body,
        segments: rendered.segments,
        mode: decision.mode,
        blocked_reason: decision.mode === 'dry_run' ? decision.reason : null,
        status: decision.mode === 'live' ? 'queued' : 'not_sent',
      });
    } catch {
      return finish('ok', { summary: `${summary} — already delivered`, actions_proposed: 1 });
    }

    if (decision.mode === 'dry_run') {
      return finish('ok', { summary: `${summary} — ${decision.reason}`, actions_proposed: 1 });
    }

    const sent = await sendEmail(env, msg);
    await database.update('automation_deliveries', `id=eq.${delivery.id}`, {
      status: sent.ok ? 'sent' : 'failed',
      provider_id: sent.providerId ?? null,
      sent_at: sent.ok ? iso(new Date()) : null,
    });
    return finish(sent.ok ? 'ok' : 'error', {
      summary, actions_proposed: 1, actions_executed: sent.ok ? 1 : 0,
      error: sent.error ?? null,
    });
  } catch (e) {
    return finish('error', { error: String(e) });
  }
}

/**
 * The scheduled tick. Deliberately light: one indexed select, and on almost
 * every minute of the day it finds nothing due and returns.
 */
export async function runDueAutomations(
  env: Env, database: Db, now: Date,
): Promise<RunOutcome[]> {
  const autos = await database.select('automations', 'enabled=eq.true&select=*');
  if (!autos.length) return [];

  const [types, teams] = await Promise.all([
    database.select('automation_types', 'trigger_kind=eq.schedule&select=key,capability,max_mode'),
    database.select('teams', 'is_active=eq.true&select=id,org_id,name,timezone'),
  ]);
  const typeByKey = new Map((types as any[]).map((t) => [t.key, t]));
  const teamById = new Map((teams as any[]).map((t) => [t.id, t as TeamRow]));

  const out: RunOutcome[] = [];
  for (const auto of autos as any[]) {
    const type = typeByKey.get(auto.type_key);
    if (!type) continue;                       // event-driven, or not on the shelf
    if (auto.type_key !== 'morning_brief') continue; // the only one wired so far
    const team = teamById.get(auto.team_id);
    if (!team) continue;

    const tz = team.timezone ?? 'America/Los_Angeles';
    if (!isBriefDue(localClock(now, tz), String(auto.config?.send_at ?? '07:30'))) continue;

    out.push(await runOne(env, database, { ...auto, capability: type.capability }, team, now));
  }
  return out;
}
