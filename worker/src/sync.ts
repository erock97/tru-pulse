// Per-tenant FUB sync. Pull people in the window, keep tracked paid sources, classify
// each with the audit's exact rule (per-person calls/texts), and upsert org-scoped
// lead rows with their flag. This is the audit's read-only pull, made persistent.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { importEncKey, decryptKey } from './crypto.js';
import { pullPeople, countOutgoingTexts, countCalls, detectSubdomain, pullUsers, pullDeals, pullPonds } from './fub.js';
import { sourceFamily, classifyLead, isStuckStage, stageClass, isOfferPlus } from '../../shared/flags.js';

// Contact counts (calls/texts) are only meaningful for RECENT active leads (the
// accountability horizon) and each costs 2 FUB subrequests — so we never fetch them
// for the full all-time pull. Older/advanced leads flag from their stage alone.
const CONTACT_HORIZON_MS = 45 * 86400_000;

// FUB deal close dates arrive as "2026-06-30 05:00:00" — normalize to ISO (UTC).
function dealDateIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T');
  const withZone = /[zZ]$/.test(s) || /[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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

  // Stage-progression log — the reliable forward history (FUB exposes no stage
  // history via API; see fub.ts). We accrue a dated "hit" the FIRST time a lead
  // reaches an achievement stage (offer / under contract / closed), stamped with
  // the owning agent. On a team's very first sync we can't know WHEN older leads
  // reached their stage, so those seed as date_source='seed' (dateless, excluded
  // from windowed counts) — except closings, which take the real dealCloseDate
  // when present. Every sync after that, a newly-seen hit is a live transition we
  // caught, dated now. Runs for EVERY team via the cron, so it's automatic on the
  // first sync of any new team the moment its key is added — no per-team setup.
  const priorHits = (await database
    .select('person_stage_log', `team_id=eq.${team.id}&select=fub_person_id,stage`)
    .catch(() => [] as any[])) as Array<{ fub_person_id: number; stage: string }>;
  const hitSeen = new Set(priorHits.map((r) => `${r.fub_person_id}|${r.stage}`));
  const isInitialSeed = priorHits.length === 0;
  const stageLogRows: any[] = [];

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

    // Accrue the stage-progression hit (offer / UC / closed) if we haven't logged
    // this lead at this stage before. One dated hit per (lead, stage) — a lead that
    // climbs offer → UC → closed produces three hits, each credited to its agent.
    const sc = stageClass(stage);
    const hitKey = `${p.id}|${p.stage}`;
    if (p.stage && (sc === 'offer' || sc === 'uc' || sc === 'closed') && !hitSeen.has(hitKey)) {
      hitSeen.add(hitKey);
      let changedAt: string | null;
      let dateSource: string;
      if (sc === 'closed' && dealDateIso(p.dealCloseDate)) {
        changedAt = dealDateIso(p.dealCloseDate); dateSource = 'deal_close_date';
      } else if (isInitialSeed) {
        changedAt = null; dateSource = 'seed';
      } else {
        changedAt = nowIso; dateSource = 'live';
      }
      stageLogRows.push({
        org_id: team.org_id,
        team_id: team.id,
        fub_person_id: p.id,
        stage: p.stage,
        stage_class: sc,
        agent_name: p.assignedTo ?? null,
        agent_user_id: p.assignedUserId ?? null,
        changed_at: changedAt,
        detected_at: nowIso,
        date_source: dateSource,
      });
    }
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

  // Stage-progression log — additive; ignore-duplicates so a lead's first-seen date
  // at a stage is never overwritten by a later sync. Never fails the lead sync.
  try {
    await database.upsert('person_stage_log', stageLogRows, 'team_id,fub_person_id,stage', { ignoreDuplicates: true });
  } catch {
    // the log is a metrics enrichment layer; a schema not-yet-migrated must not break sync
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
  // Sync the STALEST teams first so no team is starved if a run is cut short by the
  // Worker limit (the all-people pull is heavy). Over repeated cron runs every active
  // team stays fresh; the FUB webhook keeps each live between runs regardless. A team
  // that times out mid-sync doesn't upsert (upsert is last), so it stays stalest and
  // is retried first next run — self-healing coverage for ALL teams.
  const state = (await database.select('sync_state', 'select=team_id,last_sync_at')) as Array<{ team_id: string; last_sync_at: string | null }>;
  const lastByTeam = new Map(state.map((s) => [s.team_id, s.last_sync_at ? Date.parse(s.last_sync_at) : 0]));
  teams.sort((a, b) => (lastByTeam.get(a.id) ?? 0) - (lastByTeam.get(b.id) ?? 0));
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
