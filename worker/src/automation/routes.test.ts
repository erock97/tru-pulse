// These pin the rails that decide whether an agent can act, and the one that
// decides whether a client's phone number can reach a browser. They are the
// reason this module exists as a separate file from index.ts: they are testable
// without standing up the whole Worker.
import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { handleAutomationRoutes } from './routes.js';
import { enabledFor, modeExceedsCeiling, redactRecipient } from './store.js';
import type { AutomationType } from './types.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const AUTO_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

const briefType: AutomationType = {
  key: 'morning_brief', label: 'Morning brief', blurb: '…', trigger_kind: 'schedule',
  max_mode: 'full_auto', channels: ['email'], capability: 'notify.relay',
  leader_visible: true, active: true,
};
const reassignType: AutomationType = {
  ...briefType, key: 'lead_reassign', label: 'Hand off an un-worked lead',
  max_mode: 'ask_first', capability: 'fub.reassign', leader_visible: false,
};

function stub(opts: { automations?: any[]; types?: AutomationType[]; teams?: any[] } = {}) {
  const updates: Array<{ table: string; query: string; patch: any }> = [];
  const inserts: Array<{ table: string; row: any }> = [];
  const db = {
    select: vi.fn(async (table: string, query: string) => {
      if (table === 'automation_types') {
        const key = /key=eq\.([^&]+)/.exec(query)?.[1];
        const all = opts.types ?? [briefType, reassignType];
        return key ? all.filter((t) => t.key === key) : all;
      }
      if (table === 'automations') return opts.automations ?? [];
      if (table === 'teams') return opts.teams ?? [{ id: TEAM_ID, org_id: ORG_ID }];
      return [];
    }),
    update: vi.fn(async (table: string, query: string, patch: any) => {
      updates.push({ table, query, patch });
    }),
    insert: vi.fn(async (table: string, row: any) => {
      inserts.push({ table, row });
      return { id: AUTO_ID, ...row };
    }),
    upsert: vi.fn(async () => undefined),
  } as unknown as Db;
  return { db, updates, inserts };
}

const call = async (
  db: Db,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> => {
  const url = new URL(`https://api.truhq.co${path}`);
  const req = new Request(url.toString(), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
  const res = await handleAutomationRoutes(req, {} as Env, url, {
    userId: 'owner-1',
    database: db,
    json: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status }),
  });
  if (!res) return { status: 0, body: null };
  return { status: res.status, body: await res.json() };
};

describe('the mode ceiling', () => {
  it('refuses to arm reassignment beyond ask-first', async () => {
    // full_auto for lead_reassign is not expressible over HTTP at all. Raising
    // that ceiling is a migration, so going live stays a dated, reviewable act
    // rather than something clicked at 11pm.
    const s = stub({ automations: [{ id: AUTO_ID, type_key: 'lead_reassign', mode: 'off' }] });
    const r = await call(s.db, 'POST', `/admin/automations/${AUTO_ID}/mode`, { mode: 'full_auto' });
    expect(r.status).toBe(422);
    expect(s.updates).toHaveLength(0);
  });

  it('allows ask-first for reassignment, and full auto for the brief', async () => {
    const a = stub({ automations: [{ id: AUTO_ID, type_key: 'lead_reassign', mode: 'off' }] });
    expect((await call(a.db, 'POST', `/admin/automations/${AUTO_ID}/mode`, { mode: 'ask_first' })).status).toBe(200);

    const b = stub({ automations: [{ id: AUTO_ID, type_key: 'morning_brief', mode: 'off' }] });
    expect((await call(b.db, 'POST', `/admin/automations/${AUTO_ID}/mode`, { mode: 'full_auto' })).status).toBe(200);
  });

  it('is a pure comparison, so it can be reasoned about without a request', () => {
    expect(modeExceedsCeiling('full_auto', reassignType)).toBe(true);
    expect(modeExceedsCeiling('ask_first', reassignType)).toBe(false);
    expect(modeExceedsCeiling('full_auto', briefType)).toBe(false);
  });
});

describe('enabled is a strict function of mode', () => {
  it('never lets a request set enabled directly', async () => {
    // A body that names `enabled` must not reach the database. This is the whole
    // reason the handler allow-lists field by field instead of spreading.
    const s = stub({ automations: [{ id: AUTO_ID, type_key: 'morning_brief', mode: 'off' }] });
    await call(s.db, 'POST', '/admin/automations', { id: AUTO_ID, enabled: true, sms_live: true, visible_to_leader: true });
    const patch = s.updates[0].patch;
    expect(patch).not.toHaveProperty('enabled');
    expect(patch).not.toHaveProperty('sms_live');
    expect(patch).not.toHaveProperty('visible_to_leader');
  });

  it('derives enabled from mode whenever mode is written', async () => {
    const s = stub({ automations: [{ id: AUTO_ID, type_key: 'morning_brief', mode: 'off' }] });
    await call(s.db, 'POST', `/admin/automations/${AUTO_ID}/mode`, { mode: 'notify_only' });
    expect(s.updates[0].patch).toMatchObject({ mode: 'notify_only', enabled: true });

    const off = stub({ automations: [{ id: AUTO_ID, type_key: 'morning_brief', mode: 'full_auto' }] });
    await call(off.db, 'POST', `/admin/automations/${AUTO_ID}/mode`, { mode: 'off' });
    expect(off.updates[0].patch).toMatchObject({ mode: 'off', enabled: false });

    expect(enabledFor('off')).toBe(false);
    for (const m of ['notify_only', 'ask_first', 'full_auto'] as const) expect(enabledFor(m)).toBe(true);
  });

  it('creates every automation switched off, even one that asked to be live', async () => {
    const s = stub();
    await call(s.db, 'POST', '/admin/automations', {
      team_id: TEAM_ID, type_key: 'morning_brief', mode: 'full_auto',
    });
    expect(s.inserts[0].row).toMatchObject({ mode: 'off', enabled: false });
  });
});

describe('the shelf is a menu, not a builder', () => {
  it('refuses an automation type that is not on the shelf', async () => {
    const s = stub();
    const r = await call(s.db, 'POST', '/admin/automations', {
      team_id: TEAM_ID, type_key: 'delete_everything',
    });
    expect(r.status).toBe(422);
    expect(s.inserts).toHaveLength(0);
  });
});

describe('recipients never reach the browser', () => {
  it('reduces a phone number to its last four digits', () => {
    expect(redactRecipient({ recipient_phone: '+19198898195' }))
      .toEqual({ hasRecipient: true, recipientMasked: '…8195' });
  });

  it('keeps the domain of an email but not the name', () => {
    expect(redactRecipient({ recipient_email: 'jack@costigangroup.com' }))
      .toEqual({ hasRecipient: true, recipientMasked: 'j…@costigangroup.com' });
  });

  it('says plainly when nothing is set, rather than implying one is', () => {
    expect(redactRecipient({})).toEqual({ hasRecipient: false, recipientMasked: null });
    expect(redactRecipient(null)).toEqual({ hasRecipient: false, recipientMasked: null });
  });
});

describe('input handling', () => {
  it('rejects a malformed id instead of putting it in a query string', async () => {
    const s = stub();
    const r = await call(s.db, 'POST', '/admin/automations/not-a-uuid/mode', { mode: 'off' });
    expect(r.status).toBe(422);
    expect(s.db.select).not.toHaveBeenCalled();
  });

  it('refuses a cap it cannot read rather than defaulting to something permissive', async () => {
    const s = stub({ automations: [{ id: AUTO_ID, type_key: 'morning_brief', mode: 'off' }] });
    for (const bad of ['lots', -1, 999, 2.5]) {
      const r = await call(s.db, 'POST', '/admin/automations', { id: AUTO_ID, max_per_day: bad });
      expect(r.status, `max_per_day=${bad}`).toBe(422);
    }
  });

  it('answers an unknown path under its own prefix rather than letting it fall through', async () => {
    const s = stub();
    const r = await call(s.db, 'GET', '/admin/automations/nope');
    expect(r.status).toBe(404);
  });

  it('ignores paths it does not own', async () => {
    const s = stub();
    const r = await call(s.db, 'GET', '/admin/leaders');
    expect(r.status).toBe(0); // null — index.ts handles it
  });
});
