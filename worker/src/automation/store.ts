// Every read and write of the automation tables goes through here, using the
// service role. Nothing in this file is reachable without having already passed
// the admins-table check in index.ts.
import type { Db } from '../db.js';
import type {
  AutomationBoard, AutomationRow, AutomationRun, AutomationType, Mode, TeamSummary,
} from './types.js';
import { MODE_RANK, isMode } from './types.js';

/**
 * Turn a recipient into something safe to put on a screen.
 *
 * secure_config holds real phone numbers and email addresses. Those exist so a
 * Worker can send to them, not so a browser can display them — a console that
 * renders a client's phone number has quietly become somewhere that number can
 * leak from. The owner needs to know a recipient is SET and roughly which one it
 * is; four digits does that and nothing more.
 */
export function redactRecipient(secure: Record<string, unknown> | null | undefined): {
  hasRecipient: boolean;
  recipientMasked: string | null;
} {
  const phone = typeof secure?.recipient_phone === 'string' ? secure.recipient_phone : '';
  const email = typeof secure?.recipient_email === 'string' ? secure.recipient_email : '';
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    return { hasRecipient: true, recipientMasked: digits ? `…${digits.slice(-4)}` : '…' };
  }
  if (email) {
    const [user, domain] = email.split('@');
    const head = (user ?? '').slice(0, 1);
    return { hasRecipient: true, recipientMasked: domain ? `${head}…@${domain}` : '…' };
  }
  return { hasRecipient: false, recipientMasked: null };
}

function toRow(r: any): AutomationRow {
  const { hasRecipient, recipientMasked } = redactRecipient(r.secure_config);
  return {
    id: r.id,
    org_id: r.org_id,
    team_id: r.team_id,
    type_key: r.type_key,
    name: r.name ?? null,
    mode: (isMode(r.mode) ? r.mode : 'off') as Mode,
    enabled: !!r.enabled,
    config: (r.config ?? {}) as Record<string, unknown>,
    max_per_day: Number(r.max_per_day ?? 2),
    sms_live: !!r.sms_live,
    visible_to_leader: !!r.visible_to_leader,
    leader_editable: !!r.leader_editable,
    updated_at: r.updated_at,
    hasRecipient,
    recipientMasked,
  };
}

export async function loadBoard(database: Db): Promise<AutomationBoard> {
  const [typeRows, teamRows, orgRows, autoRows, capRows, syncRows, flagRows] = await Promise.all([
    database.select('automation_types', 'active=eq.true&select=*&order=key'),
    database.select('teams', 'is_active=eq.true&select=id,name,org_id,timezone'),
    database.select('orgs', 'select=id,name'),
    // secure_config IS selected here and then immediately reduced to a mask by
    // toRow. It must never reach the response object un-redacted.
    database.select('automations', 'select=*'),
    database.select('automation_capabilities', 'select=team_id,capability,expires_at'),
    database.select('sync_state', 'select=team_id,last_sync_at'),
    database.select('platform_flags', 'select=key,bool_value'),
  ]);

  const orgById = new Map((orgRows as any[]).map((o) => [o.id, o.name]));
  const syncByTeam = new Map((syncRows as any[]).map((s) => [s.team_id, s.last_sync_at]));
  const now = Date.now();
  const capsByTeam = new Map<string, string[]>();
  for (const c of capRows as any[]) {
    // An expired grant is not a grant. Filtering here as well as at send time is
    // deliberate: the console must not show a capability that would refuse.
    if (c.expires_at && Date.parse(c.expires_at) <= now) continue;
    capsByTeam.set(c.team_id, [...(capsByTeam.get(c.team_id) ?? []), c.capability]);
  }

  const teams: TeamSummary[] = (teamRows as any[])
    .map((t) => ({
      id: t.id,
      name: t.name,
      org_id: t.org_id,
      org_name: orgById.get(t.org_id) ?? '—',
      timezone: t.timezone ?? 'America/Los_Angeles',
      capabilities: capsByTeam.get(t.id) ?? [],
      last_sync_at: syncByTeam.get(t.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const flagOf = (k: string, dflt: boolean) => {
    const row = (flagRows as any[]).find((f) => f.key === k);
    return row ? !!row.bool_value : dflt;
  };

  return {
    types: typeRows as AutomationType[],
    teams,
    automations: (autoRows as any[]).map(toRow),
    flags: {
      automation_enabled: flagOf('automation_enabled', true),
      // Defaults FALSE if the row is missing. A flag we cannot read is not
      // permission to send.
      automation_live_sends: flagOf('automation_live_sends', false),
    },
  };
}

export async function typeByKey(database: Db, key: string): Promise<AutomationType | null> {
  const rows = await database.select('automation_types', `key=eq.${encodeURIComponent(key)}&select=*`);
  return rows.length ? (rows[0] as AutomationType) : null;
}

export async function automationById(database: Db, id: string): Promise<any | null> {
  const rows = await database.select('automations', `id=eq.${id}&select=*`);
  return rows.length ? rows[0] : null;
}

export async function runsFor(
  database: Db,
  opts: { teamId?: string; automationId?: string; limit?: number },
): Promise<AutomationRun[]> {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const filters = [
    opts.teamId ? `team_id=eq.${opts.teamId}` : null,
    opts.automationId ? `automation_id=eq.${opts.automationId}` : null,
    // The run log is redacted by construction, so `summary` is safe to select.
    // `detail` is not selected: it is for a human reading one run, not a list.
    'select=id,team_id,automation_id,type_key,trigger,mode,status,actions_proposed,' +
      'actions_executed,summary,started_at,finished_at',
    'order=started_at.desc',
    `limit=${limit}`,
  ].filter(Boolean);
  return (await database.select('automation_runs', filters.join('&'))) as AutomationRun[];
}

/**
 * The one place `enabled` is ever written, and it is always a strict function of
 * `mode` — the same shape as rep_modules' active = (status === 'published').
 * An automation cannot be born live, and cannot be made live by any request that
 * does not go through here.
 */
export function enabledFor(mode: Mode): boolean {
  return mode !== 'off';
}

/** Reject a mode above what this agent is ever permitted to reach. */
export function modeExceedsCeiling(mode: Mode, type: AutomationType): boolean {
  return MODE_RANK[mode] > MODE_RANK[type.max_mode];
}
