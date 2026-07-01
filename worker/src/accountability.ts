// 3-strike accountability reconcile (runs daily). Turns zero-contact flags into a
// documented strike ledger: open a case (1 strike) for a paid lead that stays
// un-worked past grace; close it when the agent finally works it; recommend a pause
// when an agent hits the strike limit in the rolling window. Recommend-only — a human
// confirms and flips FUB. Spec: the accountability-three-strike memory.
import type { Db } from './db.js';

interface LeadRow {
  id: string;
  assigned_to: string | null;
  fub_created: string | null;
  flag: string | null;
}
interface CaseRow {
  id: string;
  lead_id: string | null;
  status: string;
  assigned_to: string | null;
  opened_at: string;
}

export interface ReconcileOpts {
  graceHours?: number;      // grace before strike 1 (~end of next business day)
  strikeWindowDays?: number;
  strikeLimit?: number;
}

export async function reconcileTeam(
  database: Db,
  team: { id: string; org_id: string },
  opts: ReconcileOpts = {},
) {
  const graceHours = opts.graceHours ?? 36;
  const windowDays = opts.strikeWindowDays ?? 30;
  const strikeLimit = opts.strikeLimit ?? 3;
  const graceCutoff = Date.now() - graceHours * 3600_000;
  const since = Date.now() - windowDays * 86400_000;
  const nowIso = new Date().toISOString();

  const leads = (await database.select(
    'leads',
    `team_id=eq.${team.id}&select=id,assigned_to,fub_created,flag`,
  )) as LeadRow[];
  const allCases = (await database.select(
    'accountability_cases',
    `team_id=eq.${team.id}&select=id,lead_id,status,assigned_to,opened_at`,
  )) as CaseRow[];

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const everStruck = new Set(allCases.map((c) => c.lead_id).filter((x): x is string => !!x));
  const openCases = allCases.filter((c) => c.status === 'open');

  // Current strike counts per agent (cases opened within the rolling window).
  const strikes = new Map<string, number>();
  for (const c of allCases) {
    if (Date.parse(c.opened_at) >= since) {
      const a = c.assigned_to ?? 'Unassigned';
      strikes.set(a, (strikes.get(a) ?? 0) + 1);
    }
  }

  let complied = 0;
  let opened = 0;
  let pauseRecs = 0;

  // 1. Comply — the agent finally worked the lead → close the case.
  for (const c of openCases) {
    const l = c.lead_id ? leadById.get(c.lead_id) : undefined;
    if (!l || l.flag !== 'zero_contact') {
      await database.update('accountability_cases', `id=eq.${c.id}`, {
        status: 'complied',
        resolution: 'worked',
        resolved_at: nowIso,
      });
      await database.insert('accountability_events', {
        org_id: team.org_id,
        case_id: c.id,
        kind: 'complied',
        actor: 'system',
      });
      complied++;
    }
  }

  // 2. Open new strikes — zero-contact, past grace, never struck before (one per lead).
  for (const l of leads) {
    if (l.flag !== 'zero_contact' || !l.assigned_to) continue;
    if (everStruck.has(l.id)) continue;
    const created = Date.parse(l.fub_created ?? '');
    if (Number.isNaN(created) || created > graceCutoff) continue; // still in grace

    const agent = l.assigned_to;
    const next = (strikes.get(agent) ?? 0) + 1;
    strikes.set(agent, next);
    const kase = await database.insert('accountability_cases', {
      org_id: team.org_id,
      team_id: team.id,
      lead_id: l.id,
      assigned_to: agent,
      status: 'open',
    });
    await database.insert('accountability_events', {
      org_id: team.org_id,
      case_id: kase.id,
      kind: 'strike',
      strike_no: next,
      actor: 'system',
    });
    everStruck.add(l.id);
    opened++;

    // Recommend a pause the moment they cross the limit (once).
    if (next === strikeLimit) {
      await database.insert('accountability_events', {
        org_id: team.org_id,
        case_id: kase.id,
        kind: 'pause_rec',
        strike_no: next,
        actor: 'system',
      });
      pauseRecs++;
    }
  }

  return { complied, opened, pauseRecs };
}

export async function reconcileAllTeams(database: Db, opts: ReconcileOpts = {}) {
  const teams = (await database.select('teams', 'is_active=eq.true&select=id,org_id')) as Array<{
    id: string;
    org_id: string;
  }>;
  const out: Record<string, unknown> = {};
  for (const t of teams) {
    try {
      out[t.id] = await reconcileTeam(database, t, opts);
    } catch (e) {
      out[t.id] = { error: String(e) };
    }
  }
  return out;
}
