// Per-tenant FUB sync. Pull people in the window, keep tracked paid sources, classify
// each with the audit's exact rule (per-person calls/texts), and upsert org-scoped
// lead rows with their flag. This is the audit's read-only pull, made persistent.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { importEncKey, decryptKey } from './crypto.js';
import { pullPeople, countOutgoingTexts, countCalls, detectSubdomain, pullUsers, pullDeals, pullPonds, getPeopleByIds } from './fub.js';
import { sourceFamily, classifyLead, isStuckStage, stageClass, isOfferPlus } from '../../shared/flags.js';

// Contact counts (calls/texts) are only meaningful for RECENT active leads (the
// accountability horizon) and each costs 2 FUB subrequests — so we never fetch them
// for the full all-time pull. Older/advanced leads flag from their stage alone.
const CONTACT_HORIZON_MS = 90 * 86400_000;

export interface TeamRow {
  id: string;
  org_id: string;
  fub_subdomain: string | null;
}

// 180-day default window so the dashboard's 6-month view has real coverage.
// windowDays is retained for call-site compatibility but no longer bounds the people
// pull — we sync ALL tracked people now (a created-date window hid closed deals).
export async function syncTeam(env: Env, database: Db, team: TeamRow, _windowDays = 180) {
  // 1. Decrypt this tenant's FUB key (only the Worker can read team_secrets).
  const secret = await database.select('team_secrets', `team_id=eq.${team.id}&select=fub_key_enc`);
  if (!secret.length) throw new Error(`no FUB key for team ${team.id}`);
  const encKey = await importEncKey(env.FUB_ENC_KEY);
  const fubKey = await decryptKey(encKey, secret[0].fub_key_enc);

  // 2. Backfill the subdomain if we don't have it (for per-record FUB links).
  if (!team.fub_subdomain) {
    const sub = await detectSubdomain(fubKey);
    if (sub) await database.update('teams', `id=eq.${team.id}`, { fub_subdomain: sub });
  }

  // 3. Pull ALL people (no created-date window — that hid every closed deal); keep
  //    only tracked paid sources.
  const people = await pullPeople(fubKey);
  const inScope = people.filter((p) => sourceFamily(p.source) !== null);
  const ponds = await pullPonds(fubKey);

  // 4. Classify each and upsert. Contact API calls (2 subrequests each) are spent
  //    ONLY on recent, active, non-advanced leads — never the whole all-time pull:
  //    stuck → stuck; offer/UC/closed → clearly worked; old active → assume worked.
  const rows: any[] = [];
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  for (const p of inScope) {
    const stage = String(p.stage ?? '');
    const tags: string[] = Array.isArray(p.tags) ? p.tags.map((t: any) => String(t)) : [];
    const createdMs = p.created ? Date.parse(p.created) : NaN;
    const recent = Number.isNaN(createdMs) || (nowMs - createdMs) <= CONTACT_HORIZON_MS;
    let outgoingTexts = 0;
    let calls = 0;
    let flag: string;
    if (isStuckStage(stage)) {
      flag = 'stuck';
    } else if (isOfferPlus(stageClass(stage))) {
      flag = 'worked';
    } else if (recent) {
      outgoingTexts = await countOutgoingTexts(fubKey, p.id);
      calls = await countCalls(fubKey, p.id);
      flag = classifyLead({ stage, tags, outgoingTexts, calls });
    } else {
      flag = 'worked';
    }
    rows.push({
      org_id: team.org_id,
      team_id: team.id,
      fub_person_id: p.id,
      name: p.name || `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unknown',
      source: p.source ?? null,
      source_family: sourceFamily(p.source),
      stage: p.stage ?? null,
      assigned_to: p.assignedTo ?? null,
      pond: p.assignedPondId ? (ponds.get(Number(p.assignedPondId)) ?? 'Pond') : null,
      tags,
      fub_created: p.created ?? null,
      fub_updated: p.updated ?? null,
      flag,
      outgoing_texts: outgoingTexts,
      calls,
      synced_at: nowIso,
    });
  }
  // Upsert; if the pond column hasn't been added yet, retry without it so the
  // lead sync never breaks on a schema that's one migration behind.
  try {
    await database.upsert('leads', rows, 'team_id,fub_person_id');
  } catch (e) {
    if (String(e).toLowerCase().includes('pond')) {
      await database.upsert('leads', rows.map(({ pond: _p, ...r }) => r), 'team_id,fub_person_id');
    } else {
      throw e;
    }
  }

  // Keep the shared agents rows stocked with FUB's contact info (email/phone) so
  // the dashboard's email/text actions always have someone to reach. Existing rows
  // (e.g. migrated from Coach) are matched by fub_user_id, then by name — never duplicated.
  try {
    await syncAgents(database, team, fubKey);
  } catch (e) {
    // contacts are enrichment — never fail the lead sync over them
  }

  // Deals → closings metrics (Offer Rate, leads-per-closing). Degrades silently
  // until the deals table exists; never fails the lead sync.
  try {
    await syncDeals(database, team, fubKey);
  } catch (e) {
    // metrics enrichment only
  }

  await database.upsert('sync_state', [{ team_id: team.id, org_id: team.org_id, last_sync_at: nowIso }], 'team_id');

  return {
    pulled: people.length,
    inScope: inScope.length,
    zeroContact: rows.filter((r) => r.flag === 'zero_contact').length,
    stuck: rows.filter((r) => r.flag === 'stuck').length,
    worked: rows.filter((r) => r.flag === 'worked').length,
  };
}

/** Log the moment specific people changed stage → person_stage_log. The reliable,
 *  dated closings/UC signal (never the FUB Deals tab, which agents rarely fill in).
 *  FUB exposes no historical stage date, so this accrues accurately from go-live;
 *  fed by the peopleStageUpdated webhook. Fetches the changed people by id so an
 *  under-contract on an OLD lead (outside the sync window) is still stamped. */
export async function logStageChanges(env: Env, database: Db, team: TeamRow, ids: number[]): Promise<number> {
  const clean = ids.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!clean.length) return 0;
  const secret = await database.select('team_secrets', `team_id=eq.${team.id}&select=fub_key_enc`);
  if (!secret.length) return 0;
  const encKey = await importEncKey(env.FUB_ENC_KEY);
  const fubKey = await decryptKey(encKey, secret[0].fub_key_enc);
  const people = await getPeopleByIds(fubKey, clean.join(','));
  const now = new Date().toISOString();
  const rows = people
    .filter((p) => p.stage)
    .map((p) => ({ org_id: team.org_id, team_id: team.id, fub_person_id: p.id, stage: String(p.stage), changed_at: now }));
  if (rows.length) await database.upsert('person_stage_log', rows);
  return rows.length;
}

const normName = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

async function syncAgents(database: Db, team: TeamRow, fubKey: string) {
  const users = await pullUsers(fubKey);
  if (!users.length) return;
  const existing = (await database.select(
    'agents',
    `team_id=eq.${team.id}&select=id,name,email,phone,fub_user_id`,
  )) as Array<{ id: string; name: string; email: string | null; phone: string | null; fub_user_id: number | null }>;
  const byFub = new Map(existing.filter((a) => a.fub_user_id != null).map((a) => [String(a.fub_user_id), a]));
  const byName = new Map(existing.map((a) => [normName(a.name), a]));
  for (const u of users) {
    const name = String(u.name ?? '').trim();
    if (!name) continue;
    const email = u.email ?? null;
    const phone = u.phone ?? u.phoneNumber ?? null;
    const hit = byFub.get(String(u.id)) ?? byName.get(normName(name));
    if (hit) {
      const patch: Record<string, unknown> = {};
      if (hit.fub_user_id == null) patch.fub_user_id = u.id;
      if (!hit.email && email) patch.email = email;
      if (!hit.phone && phone) patch.phone = phone;
      if (Object.keys(patch).length) await database.update('agents', `id=eq.${hit.id}`, patch);
    } else {
      await database.insert('agents', { org_id: team.org_id, team_id: team.id, fub_user_id: u.id, name, email, phone });
    }
  }
}

async function syncDeals(database: Db, team: TeamRow, fubKey: string) {
  const deals = await pullDeals(fubKey);
  if (!deals.length) return;
  const nowIso = new Date().toISOString();
  const rows = deals.map((d) => ({
    org_id: team.org_id,
    team_id: team.id,
    fub_deal_id: d.id,
    name: d.name ?? null,
    stage: d.stageName ?? null,
    stage_class: stageClass(d.stageName),
    status: d.status ?? null,
    price: d.price ?? null,
    commission: d.commissionValue ?? null,
    agent_name: d.users?.[0]?.name ?? null,
    fub_person_id: d.people?.[0]?.id ?? null,
    projected_close: d.projectedCloseDate ?? null,
    fub_created: d.createdAt ?? null,
    synced_at: nowIso,
  }));
  await database.upsert('deals', rows, 'team_id,fub_deal_id');
}

export async function syncAllActiveTeams(env: Env, database: Db, windowDays = 180) {
  const teams: TeamRow[] = await database.select('teams', 'is_active=eq.true&select=id,org_id,fub_subdomain');
  const results: Record<string, unknown> = {};
  for (const t of teams) {
    try {
      results[t.id] = await syncTeam(env, database, t, windowDays);
    } catch (e) {
      results[t.id] = { error: String(e) };
    }
  }
  return results;
}
