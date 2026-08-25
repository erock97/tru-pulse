import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { decideSendMode, type SendLocks } from './notify.js';
import { isBriefDue, localClock, localDateLabel, runOne, shortName } from './runner.js';

const TEAM = {
  id: 'team-1', org_id: 'org-1', name: 'Costigan', timezone: 'America/New_York',
};

const AUTO = {
  id: 'auto-1', type_key: 'morning_brief', mode: 'notify_only', max_per_day: 2,
  config: { send_at: '07:30' }, secure_config: { recipient_email: 'eric@truhq.co' },
  sms_live: false, capability: null,
};

function stub(over: {
  claimThrows?: boolean;
  runsToday?: number;
  deliveriesHour?: number;
  flags?: Array<{ key: string; bool_value: boolean }>;
  lastSync?: string | null;
  fresh?: any[]; untouched?: any[]; stalled?: any[];
  deliveryThrows?: boolean;
} = {}) {
  const inserts: Array<{ table: string; row: any }> = [];
  const updates: Array<{ table: string; patch: any }> = [];
  const db = {
    select: vi.fn(async (table: string, query: string) => {
      if (table === 'platform_flags') {
        return over.flags ?? [
          { key: 'automation_enabled', bool_value: true },
          { key: 'automation_live_sends', bool_value: false },
        ];
      }
      if (table === 'automation_runs') return Array(over.runsToday ?? 0).fill({ id: 'r' });
      if (table === 'automation_deliveries') return Array(over.deliveriesHour ?? 0).fill({ id: 'd' });
      if (table === 'automation_capabilities') return [];
      if (table === 'sync_state') {
        return over.lastSync === undefined
          ? [{ last_sync_at: new Date().toISOString() }]
          : over.lastSync === null ? [] : [{ last_sync_at: over.lastSync }];
      }
      if (table === 'leads') {
        if (query.includes('zero_contact')) return over.untouched ?? [];
        if (query.includes('stuck')) return over.stalled ?? [];
        return over.fresh ?? [];
      }
      return [];
    }),
    insert: vi.fn(async (table: string, row: any) => {
      if (table === 'automation_runs' && over.claimThrows) throw new Error('duplicate key');
      if (table === 'automation_deliveries' && over.deliveryThrows) throw new Error('duplicate key');
      inserts.push({ table, row });
      return { id: `${table}-id`, ...row };
    }),
    update: vi.fn(async (table: string, _q: string, patch: any) => { updates.push({ table, patch }); }),
    upsert: vi.fn(async () => undefined),
  } as unknown as Db;
  return { db, inserts, updates };
}

const env = { RESEND_API_KEY: 'k', BRIEF_FROM: 'TRU <brief@truhq.co>' } as Env;
const NOW = new Date('2026-08-25T11:35:00Z'); // 07:35 New York

describe('the claim comes before anything else', () => {
  it('does nothing at all when another run already owns the slot', async () => {
    // The single most important property in this file. A retried cron, an
    // overlapping tick and a double-clicked "Run now" all land here.
    const s = stub({ claimThrows: true });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('already_claimed');
    expect(s.inserts).toHaveLength(0);
    expect(s.updates).toHaveLength(0);
    // And critically: it never even looked at the lead data.
    expect(s.db.select).not.toHaveBeenCalled();
  });

  it('claims with a key built from the automation and its local slot', async () => {
    const s = stub();
    await runOne(env, s.db, AUTO, TEAM, NOW);
    const claim = s.inserts.find((i) => i.table === 'automation_runs')!.row;
    expect(claim.idempotency_key).toBe('auto-1:2026-08-25:07:30');
    expect(claim.status).toBe('claimed');
    // The mode AT RUN TIME, so a later config change cannot rewrite history.
    expect(claim.mode).toBe('notify_only');
  });
});

describe('every rail ends the run visibly', () => {
  it('stops on the kill switch, and says so', async () => {
    const s = stub({ flags: [{ key: 'automation_enabled', bool_value: false }] });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('skipped_killed');
  });

  it('stops on the env kill switch even when the database says go', async () => {
    // The backstop for when Postgres itself is the problem.
    const s = stub();
    const r = await runOne({ ...env, AUTOMATION_KILL: '1' } as Env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('skipped_killed');
  });

  it('stops when this agent has already run its daily allowance', async () => {
    const s = stub({ runsToday: 2 });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('skipped_capped');
    expect(r.detail).toMatchObject({ perAutomation: 2 });
  });

  it('stops when the org has sent too much in an hour', async () => {
    const s = stub({ deliveriesHour: 20 });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('skipped_capped');
  });

  it('holds the brief back rather than sending stale numbers', async () => {
    // Sending yesterday's numbers as today's is the one failure that costs the
    // brief its credibility permanently.
    const s = stub({ lastSync: new Date(NOW.getTime() - 14 * 3600_000).toISOString() });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('skipped_stale');
    expect(s.inserts.some((i) => i.table === 'automation_deliveries')).toBe(false);
  });

  it('treats a team that has never synced as stale, not as a quiet day', async () => {
    const s = stub({ lastSync: null });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('skipped_stale');
  });
});

describe('watch-only records what it would have sent, and sends nothing', () => {
  it('writes a delivery row marked dry run, with no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const s = stub({ fresh: [{ assigned_to: 'Stuart Gray' }, { assigned_to: null }] });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);

    expect(r.status).toBe('ok');
    const d = s.inserts.find((i) => i.table === 'automation_deliveries')!.row;
    expect(d.mode).toBe('dry_run');
    expect(d.status).toBe('not_sent');
    expect(d.blocked_reason).toBe('watch only');
    expect(d.body).toContain('New leads (24h): 2');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('writes the delivery row BEFORE it would send, so a duplicate cannot go twice', async () => {
    const s = stub({ deliveryThrows: true });
    const r = await runOne(env, s.db, AUTO, TEAM, NOW);
    expect(r.status).toBe('ok');
    expect(s.updates.some((u) => u.patch.summary?.includes('already delivered'))).toBe(true);
  });

  it('keeps a lead’s name out of the run summary', async () => {
    const s = stub({ fresh: [{ assigned_to: 'Stuart Gray' }] });
    await runOne(env, s.db, AUTO, TEAM, NOW);
    const summary = s.updates.find((u) => u.patch.summary)?.patch.summary ?? '';
    expect(summary).not.toContain('Stuart');
    expect(summary).toMatch(/\d+ new/);
  });
});

describe('the send decision falls short of live by default', () => {
  const locks: SendLocks = {
    globalEnabled: true, globalLiveSends: true, envKill: false,
    channelConfigured: true, capabilityGranted: true, teamAllowListed: true,
    automationLive: true, automationMode: 'full_auto', target: 'eric@truhq.co',
  };

  it('is live only when every single lock passes', () => {
    expect(decideSendMode(locks).mode).toBe('live');
  });

  it('falls to dry run, never to live, when any one lock fails', () => {
    // Ordering here is the design: each condition is a reason to fall SHORT of
    // live. Nothing in this list is a shortcut to it.
    const each: Array<[keyof SendLocks, unknown]> = [
      ['globalLiveSends', false], ['channelConfigured', false],
      ['capabilityGranted', false], ['teamAllowListed', false], ['automationLive', false],
    ];
    for (const [k, v] of each) {
      const d = decideSendMode({ ...locks, [k]: v } as SendLocks);
      expect(d.mode, String(k)).toBe('dry_run');
    }
  });

  it('blocks outright with nothing to preview', () => {
    for (const over of [
      { target: null }, { envKill: true }, { globalEnabled: false },
      { automationMode: 'off' as const },
    ]) {
      expect(decideSendMode({ ...locks, ...over }).mode).toBe('blocked');
    }
  });

  it('treats a missing secret as "impossible", not as "attempted and failed"', () => {
    const d = decideSendMode({ ...locks, channelConfigured: false });
    expect(d.mode).toBe('dry_run');
    if (d.mode === 'dry_run') expect(d.reason).toContain('not set up');
  });
});

describe('local time, because a brief is a wall-clock idea', () => {
  it('reads the team’s own clock, not the server’s', () => {
    // 11:35 UTC is 07:35 in New York and 04:35 in Los Angeles. Four of the five
    // teams are Eastern while the existing relay runs on a Pacific boundary, so
    // this cannot be fudged with a fixed offset.
    expect(localClock(NOW, 'America/New_York')).toEqual({ date: '2026-08-25', hhmm: '07:35' });
    expect(localClock(NOW, 'America/Los_Angeles')).toEqual({ date: '2026-08-25', hhmm: '04:35' });
  });

  it('gets the date boundary right, not just the hour', () => {
    const lateUtc = new Date('2026-08-25T03:30:00Z'); // still Aug 24 in the US
    expect(localClock(lateUtc, 'America/New_York').date).toBe('2026-08-24');
    expect(localDateLabel(lateUtc, 'America/New_York')).toBe('Mon, Aug 24');
  });

  it('survives a daylight-saving change without a hand-rolled offset', () => {
    // 2026-11-01 is the US fall-back. A fixed offset is wrong twice a year, in
    // the dark, on a schedule.
    const before = new Date('2026-10-25T11:30:00Z');
    const after = new Date('2026-11-08T12:30:00Z');
    expect(localClock(before, 'America/New_York').hhmm).toBe('07:30');
    expect(localClock(after, 'America/New_York').hhmm).toBe('07:30');
  });
});

describe('due is a window, not an instant', () => {
  it('is due from the send time for twenty minutes', () => {
    expect(isBriefDue({ hhmm: '07:29' }, '07:30')).toBe(false);
    expect(isBriefDue({ hhmm: '07:30' }, '07:30')).toBe(true);
    expect(isBriefDue({ hhmm: '07:49' }, '07:30')).toBe(true);
    expect(isBriefDue({ hhmm: '07:50' }, '07:30')).toBe(false);
  });

  it('means a missed tick costs nothing, because the claim absorbs the overlap', () => {
    // The window and the claim are a pair. The window makes a stalled cron
    // harmless; the claim stops the overlap becoming five briefs.
    let dueTicks = 0;
    for (const m of ['07:36', '07:48']) if (isBriefDue({ hhmm: m }, '07:30')) dueTicks++;
    expect(dueTicks).toBe(2);
  });
});

describe('names are cut down before they go anywhere', () => {
  it('reduces a full name to first name and last initial', () => {
    expect(shortName('Angelica Flores-Corujo')).toBe('Angelica F.');
    expect(shortName('Scott Moore')).toBe('Scott M.');
    expect(shortName('Cher')).toBe('Cher');
    expect(shortName('  ')).toBe('Unknown');
  });

  it('scrubs an accent rather than paying to send it', () => {
    expect(shortName('Renée Ötzi')).toBe('Renee O.');
  });
});
