// Per-tenant FUB sync. Pull people in the window, keep tracked paid sources, classify
// each with the audit's exact rule (per-person calls/texts), and upsert org-scoped
// lead rows with their flag. This is the audit's read-only pull, made persistent.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { importEncKey, decryptKey } from './crypto.js';
import { pullPeople, getPeopleByIds, countOutgoingTexts, countCalls, detectSubdomain, pullUsers, pullDeals, pullPonds } from './fub.js';
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

// Decrypt this tenant's FUB key (only the Worker can read team_secrets). Shared by
// syncTeam (full pull) and syncPeopleByIds (targeted webhook pull) so the two paths
// can never drift on how the key is fetched/decrypted.
async function decryptTeamKey(env: Env, database: Db, teamId: string): Promise<string> {
  const secret = await database.select('team_secrets', `team_id=eq.${teamId}&select=fub_key_enc`);
  if (!secret.length) throw new Error(`no FUB key for team ${teamId}`);
  const encKey = await importEncKey(env.FUB_ENC_KEY);
  return decryptKey(encKey, secret[0].fub_key_enc);
}

// The classify-and-upsert core, shared by a full team sync (syncTeam) and the
// targeted webhook path (syncPeopleByIds) — whichever set of `people` FUB gives us,
// this is the ONE place that turns them into 'leads' rows + stage-log hits, so the
// two paths can never classify the same lead differently.
export async function syncPeople(_env: Env, database: Db, team: TeamRow, fubKey: string, people: any[]) {
  // Keep only tracked paid sources.
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

  // ── Which recent leads get their contact history read this run ──
  //
  // Each lookup costs 2 FUB subrequests, so a big team cannot have all of its
  // in-horizon leads read in one sync — Signature has ~840 inside the 45-day
  // horizon against a budget of 250. The budget itself was never the bug;
  // spending it in arrival order was.
  //
  // What that cost, in production: roughly the same leads got read every run,
  // and the rest were written as 'worked' on the reasoning that a skipped lead
  // should never produce a false strike. But writing 'worked' does not merely
  // decline to accuse — it ERASES a zero_contact flag an earlier run had
  // correctly established. So a lead flickered between 'worked' and
  // 'zero_contact' from one sync to the next, and the nightly 07:05 reconcile
  // only ever sees one frame of that. A lead was struck only if it happened to
  // read zero_contact at exactly that moment. Fifteen of Signature's leads
  // slipped through that way, and the only two teams over this budget were the
  // only two teams missing strikes at all.
  //
  // Two changes, and they only work together:
  //   1. Spend the budget OLDEST-CHECKED-FIRST, so every in-horizon lead comes
  //      round on a fixed rotation (~4 syncs, about two hours, for the largest
  //      team) instead of some never coming round at all.
  //   2. A skipped lead KEEPS what we already knew about it rather than being
  //      overwritten with 'worked'. Only a lead we have genuinely never read
  //      defaults to 'worked', which preserves the original "never a false
  //      strike" guarantee for the one case it was actually protecting.
  const CONTACT_BUDGET = 250;

  // Prior state for the in-horizon leads only — filtered server-side, so this is
  // one page for every real team rather than a 10,000-row all-time pull.
  const horizonIso = new Date(nowMs - CONTACT_HORIZON_MS).toISOString();
  const priorRows = (await database
    .select(
      'leads',
      `team_id=eq.${team.id}&fub_created=gte.${horizonIso}` +
        '&select=fub_person_id,flag,outgoing_texts,calls,contact_checked_at',
    )
    .catch(() => [] as any[])) as Array<{
    fub_person_id: number;
    flag: string | null;
    outgoing_texts: number | null;
    calls: number | null;
    contact_checked_at: string | null;
  }>;
  const prior = new Map(priorRows.map((r) => [Number(r.fub_person_id), r]));

  // Every lead whose flag depends on reading its calls/texts. Stuck and
  // offer-or-better classify from stage alone and never spend a lookup.
  const needsLookup = inScope.filter((p) => {
    const st = String(p.stage ?? '');
    if (isStuckStage(st)) return false;
    if (isOfferPlus(stageClass(st))) return false;
    const createdMs = p.created ? Date.parse(p.created) : NaN;
    return Number.isNaN(createdMs) || nowMs - createdMs <= CONTACT_HORIZON_MS;
  });

  // Never-read first, then longest-unread. The id tie-break keeps the order
  // deterministic, so a retried sync spends its budget on the same leads rather
  // than reshuffling and starving a different slice each time.
  needsLookup.sort((a, b) => {
    const ta = prior.get(Number(a.id))?.contact_checked_at;
    const tb = prior.get(Number(b.id))?.contact_checked_at;
    if (!ta && !tb) return Number(a.id) - Number(b.id);
    if (!ta) return -1;
    if (!tb) return 1;
    const d = Date.parse(ta) - Date.parse(tb);
    return d !== 0 ? d : Number(a.id) - Number(b.id);
  });

  const lookupIds = new Set(needsLookup.slice(0, CONTACT_BUDGET).map((p) => Number(p.id)));
  for (const p of inScope) {
    const stage = String(p.stage ?? '');
    const tags: string[] = Array.isArray(p.tags) ? p.tags.map((t: any) => String(t)) : [];
    const createdMs = p.created ? Date.parse(p.created) : NaN;
    const recent = Number.isNaN(createdMs) || (nowMs - createdMs) <= CONTACT_HORIZON_MS;
    const before = prior.get(Number(p.id));
    let outgoingTexts = 0;
    let calls = 0;
    let flag: string;
    // Null means "we have never read this lead's contact history", which is a
    // different thing from "we read it and it was clean". Only a lead we actually
    // read gets its timestamp advanced, and that timestamp is what drives the
    // rotation on the next run.
    let contactCheckedAt: string | null = before?.contact_checked_at ?? null;
    if (isStuckStage(stage)) {
      flag = 'stuck';
    } else if (isOfferPlus(stageClass(stage))) {
      flag = 'worked';
    } else if (recent && lookupIds.has(Number(p.id))) {
      outgoingTexts = await countOutgoingTexts(fubKey, p.id);
      calls = await countCalls(fubKey, p.id);
      flag = classifyLead({ stage, tags, outgoingTexts, calls });
      contactCheckedAt = nowIso;
    } else if (recent && before?.contact_checked_at) {
      // In horizon, waiting its turn in the rotation, and we have read it before.
      // Keep what we already know. Overwriting this with 'worked' is precisely what
      // used to erase a real zero_contact flag before the nightly reconcile could
      // act on it.
      outgoingTexts = before.outgoing_texts ?? 0;
      calls = before.calls ?? 0;
      flag = before.flag ?? 'worked';
    } else {
      // Either past the horizon, or in horizon but never yet read. Assume worked —
      // this is the case the original guarantee was for, and it still holds: a lead
      // we have never looked at cannot produce a strike.
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
      contact_checked_at: contactCheckedAt,
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
      // A closing is dated by the deal's close date, which is the real achievement
      // date rather than whenever we happened to notice. But FUB's dealCloseDate is
      // the PROJECTED close while a deal is still open, so it can sit in the future —
      // and a forecast is not an achievement. Dating a hit forward parks it outside
      // every current window until that day arrives, at which point the lead resurfaces
      // as a fresh closing even if the deal fell through or already moved backwards.
      // Seen once for real: a lead read as "Closed" and then "Under Contract" ten
      // seconds later in the same pass, stamped three weeks out.
      const dealIso = sc === 'closed' ? dealDateIso(p.dealCloseDate) : null;
      if (dealIso && Date.parse(dealIso) <= Date.parse(nowIso)) {
        changedAt = dealIso; dateSource = 'deal_close_date';
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

  // Stage-progression log — additive; ignore-duplicates so a lead's first-seen date
  // at a stage is never overwritten by a later sync. Never fails the lead sync.
  try {
    await database.upsert('person_stage_log', stageLogRows, 'team_id,fub_person_id,stage', { ignoreDuplicates: true });
  } catch (e) {
    // Still never fails the lead sync — the log is a metrics enrichment layer and a
    // schema one migration behind must not cost us the leads. But it MUST be visible
    // in `wrangler tail`: this catch silently swallowed a NOT NULL violation on
    // changed_at for months, so every new team started with no offer/closing history
    // at all and nothing ever surfaced. Silence is what made that survivable.
    console.error(
      `person_stage_log upsert failed for team ${team.id} (${stageLogRows.length} rows, ` +
      `${stageLogRows.filter((r) => !r.changed_at).length} undated):`,
      e,
    );
  }

  return {
    upserted: rows.length,
    stageHits: stageLogRows.length,
    inScope: inScope.length,
    zeroContact: rows.filter((r) => r.flag === 'zero_contact').length,
    stuck: rows.filter((r) => r.flag === 'stuck').length,
    worked: rows.filter((r) => r.flag === 'worked').length,
  };
}

// 180-day default window so the dashboard's 6-month view has real coverage.
// windowDays is retained for call-site compatibility but no longer bounds the people
// pull — we sync ALL tracked people now (a created-date window hid closed deals).
export async function syncTeam(env: Env, database: Db, team: TeamRow, _windowDays = 180) {
  // 1. Decrypt this tenant's FUB key (only the Worker can read team_secrets).
  const fubKey = await decryptTeamKey(env, database, team.id);

  // 2. Backfill the subdomain if we don't have it (for per-record FUB links).
  if (!team.fub_subdomain) {
    const sub = await detectSubdomain(fubKey);
    if (sub) await database.update('teams', `id=eq.${team.id}`, { fub_subdomain: sub });
  }

  // 3. Pull ALL people (no created-date window — that hid every closed deal) and run
  //    them through the shared classify-and-upsert core (syncPeople above) — the
  //    same core the targeted webhook path uses, so a full sync and a targeted
  //    webhook sync can never classify a lead differently.
  const people = await pullPeople(fubKey);
  const result = await syncPeople(env, database, team, fubKey, people);

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

  await database.upsert(
    'sync_state',
    [{ team_id: team.id, org_id: team.org_id, last_sync_at: new Date().toISOString() }],
    'team_id',
  );

  return {
    pulled: people.length,
    inScope: result.inScope,
    zeroContact: result.zeroContact,
    stuck: result.stuck,
    worked: result.worked,
  };
}

// Targeted webhook path: FUB tells us exactly which person id(s) changed, so we
// fetch ONLY those (getPeopleByIds) and run them through the same classify-and-
// upsert core a full sync uses — a near-instant update instead of a full-team pull.
export async function syncPeopleByIds(env: Env, database: Db, team: TeamRow, ids: string) {
  const fubKey = await decryptTeamKey(env, database, team.id);
  const people = await getPeopleByIds(fubKey, ids);
  return syncPeople(env, database, team, fubKey, people);
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
