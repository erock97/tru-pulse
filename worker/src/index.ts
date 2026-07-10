// TRU Pulse — sync Worker. Health / provision / manual sync, plus the cron that
// keeps every tenant's flags fresh. Provision + sync accept EITHER an ops admin token
// (Eric) OR a signed-in user's Supabase token (self-serve onboarding).
import type { Env } from './env.js';
import { db } from './db.js';
import { verifySupabaseUser, userOrgIds } from './auth.js';
import { provision, type ProvisionInput } from './provision.js';
import { syncTeam, syncPeopleByIds, syncAllActiveTeams, type TeamRow } from './sync.js';
import { reconcileAllTeams } from './accountability.js';
import { sendWeeklyBriefs } from './brief.js';
import { importEncKey, decryptKey, encryptKey } from './crypto.js';
import { registerWebhooks, validateKey, fubGet } from './fub.js';
import { PERSONAS, personaByKey, createWebCall, getCall, gradeTranscript, simConfigured, agentFromAuth, setupPersonaAgents, agentIdForPersona } from './practice.js';

// CORS — the browser (app.truhq.co / Pages) calls /provision + /sync cross-origin.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token',
  'Access-Control-Max-Age': '86400',
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function isAdmin(req: Request, env: Env): boolean {
  return req.headers.get('x-admin-token') === env.ADMIN_TOKEN;
}

// TRU Rep authoring — caller must be a leader OR admin of the target org.
// Same `role=in.(admin,leader)` membership filter brief.ts already uses for
// leaderEmails(); service-role read, so it's RLS-independent by design.
async function isOrgLeaderOrAdmin(database: ReturnType<typeof db>, userId: string, orgId: string): Promise<boolean> {
  const rows = await database.select('memberships', `org_id=eq.${orgId}&user_id=eq.${userId}&role=in.(admin,leader)&select=user_id`);
  return rows.length > 0;
}

// Defense-in-depth for the Rep authoring routes below: every org/module id
// arriving from the client is interpolated straight into a PostgREST filter
// string (e.g. `org_id=eq.${orgId}`) — validating uuid shape first means a
// malformed id 400s cleanly instead of being sent through as a filter value.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

// db.ts has no delete() (every other write path is insert/upsert/update) —
// authoring's replace-all question semantics need one, so this does a plain
// service-role DELETE against PostgREST directly, matching db.ts's own header
// shape rather than growing its surface for a single call site.
async function deleteRepQuestions(env: Env, moduleId: string): Promise<void> {
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const res = await fetch(`${base}/rep_questions?module_id=eq.${moduleId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
  });
  if (!res.ok) throw new Error(`delete rep_questions ${res.status}: ${await res.text()}`);
}

// Basic allow-list for authored media uploads (rep-media bucket). Extension is
// the source of truth for the object key's suffix; contentType (when the
// browser sends one) is cross-checked so a mislabeled file can't sneak past.
const REP_UPLOAD_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'pdf', 'ppt', 'pptx', 'key', 'odp']);
const REP_UPLOAD_CT_RE = [
  /^video\//,
  /^application\/pdf$/,
  /^application\/vnd\.openxmlformats-officedocument\.presentationml/,
  /^application\/vnd\.ms-powerpoint$/,
  /^application\/vnd\.apple\.keynote$/,
  /^application\/vnd\.oasis\.opendocument\.presentation$/,
];

// Store a validated FUB key for a team and bring its data online: encrypt → upsert
// team_secrets (the ONE key every TRU product reads) → register live webhooks →
// background full sync. Shared by the team-lead self-serve path AND the admin
// on-behalf path so the two can never drift.
async function connectTeamKey(
  env: Env,
  database: ReturnType<typeof db>,
  ctx: ExecutionContext,
  origin: string,
  team: { id: string; org_id: string },
  fubKey: string,
  subdomain: string | null,
): Promise<void> {
  const enc = await encryptKey(await importEncKey(env.FUB_ENC_KEY), fubKey);
  await database.upsert('team_secrets', [{ team_id: team.id, org_id: team.org_id, fub_key_enc: enc }], 'team_id');
  if (subdomain) await database.update('teams', `id=eq.${team.id}`, { fub_subdomain: subdomain });
  if (env.FUB_SYSTEM_KEY) {
    const cb = `${origin}/webhook/fub?team=${team.id}` + (env.WEBHOOK_SECRET ? `&key=${env.WEBHOOK_SECRET}` : '');
    try {
      await registerWebhooks(fubKey, cb, env.FUB_SYSTEM_KEY, env.FUB_SYSTEM_NAME);
    } catch (e) {
      // Live updates are best-effort — never block the connect flow on FUB's webhook
      // API — but a failed registration must be VISIBLE (in `wrangler tail`), not
      // silently swallowed, or the team quietly falls back to cron-only freshness.
      console.error(`registerWebhooks failed for team ${team.id}:`, e);
    }
  }
  // Heavy full pull → background so the UI returns immediately.
  ctx.waitUntil(syncTeam(env, database, { id: team.id, org_id: team.org_id, fub_subdomain: subdomain }, 180).catch(() => {}));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const database = db(env);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') return json({ ok: true });

    // Provision a tenant. Admin token → userId from body; else the signed-in user.
    if (url.pathname === '/provision' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as any;
      if (!body?.orgName || !Array.isArray(body?.teams)) {
        return json({ error: 'orgName and teams[] required' }, 422);
      }
      const userId = isAdmin(req, env)
        ? (body.userId ?? null)
        : await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      try {
        const input: ProvisionInput = { orgName: body.orgName, userId, role: body.role, teams: body.teams };
        return json(await provision(env, database, input));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Admin: list active teams + their last sync (to drive per-team syncs).
    if (url.pathname === '/teams' && req.method === 'GET') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      const teams = await database.select('teams', 'is_active=eq.true&select=id,name,org_id');
      const state = await database.select('sync_state', 'select=team_id,last_sync_at');
      const lastByTeam = new Map((state as Array<{ team_id: string; last_sync_at: string }>).map((s) => [s.team_id, s.last_sync_at]));
      return json((teams as Array<{ id: string; name: string }>).map((t) => ({ id: t.id, name: t.name, last_sync_at: lastByTeam.get(t.id) ?? null })));
    }

    // Admin diagnostic: probe FUB for a dated stage-change history through the PEOPLE
    // side (no Deals tab). Reports the person-object field names, any date-ish fields,
    // and what /events returns for currently under-contract/closed people — so we can
    // tell whether we can reconstruct "closed in last N months" cookie-free. Read-only.
    if (url.pathname === '/admin/probe-events' && req.method === 'GET') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      const teamId = url.searchParams.get('teamId');
      if (!teamId) return json({ error: 'teamId required' }, 422);
      const secret = await database.select('team_secrets', `team_id=eq.${teamId}&select=fub_key_enc`);
      if (!secret.length) return json({ error: 'no FUB key for team' }, 404);
      const fubKey = await decryptKey(await importEncKey(env.FUB_ENC_KEY), secret[0].fub_key_enc);

      const people: any[] = [];
      for (let off = 0; off < 8000; off += 100) {
        const r = await fubGet(fubKey, '/people', { limit: 100, offset: off, sort: '-created' });
        const batch: any[] = r.body?.people ?? [];
        people.push(...batch);
        if (batch.length < 100) break;
      }

      const stageHist: Record<string, number> = {};
      for (const p of people) { const s = String(p.stage ?? '(none)'); stageHist[s] = (stageHist[s] ?? 0) + 1; }

      const isClosingStr = (s: string) => { const x = s.toLowerCase(); return x.includes('close') || x.includes('contract') || x.includes('pending') || x.includes('escrow'); };
      const deadRe = /lost|nurture|trash|archive|no longer|dead|inactive|junk|spam|not interested/i;
      const greedy = people.filter((p) => isClosingStr(String(p.stage ?? '')));
      const strict = greedy.filter((p) => !deadRe.test(String(p.stage ?? '')));
      const withDate = strict.filter((p) => p.dealCloseDate);
      const monthHist: Record<string, number> = {};
      for (const p of withDate) { const d = String(p.dealCloseDate).slice(0, 7); monthHist[d] = (monthHist[d] ?? 0) + 1; }

      // Hunt for stage history across FUB's surface + confirm webhook capture.
      const sysHdr: Record<string, string> = env.FUB_SYSTEM_KEY
        ? { 'X-System': 'TerrasonFUBDashboard', 'X-System-Key': env.FUB_SYSTEM_KEY } : {};
      const wh = await fubGet(fubKey, '/webhooks', { limit: 100 }, sysHdr);
      const webhooks = (wh.body?.webhooks ?? []).map((w: any) => ({ ...w }));
      const recentEv = await fubGet(fubKey, '/events', { limit: 100 });
      const recentEventTypes = [...new Set((recentEv.body?.events ?? []).map((e: any) => String(e.type ?? e.eventType)))];
      const stagesRes = await fubGet(fubKey, '/stages', { limit: 100 });
      const stagesList = (stagesRes.body?.stages ?? []).map((s: any) => ({ id: s.id, name: s.name, count: s.count ?? null }));
      const oneCloser: any = strict[0] ? { ...strict[0] } : null;
      if (oneCloser) for (const k of ['name', 'firstName', 'lastName', 'emails', 'phones', 'addresses', 'picture', 'socialData']) delete oneCloser[k];

      const logSample = await database.select('person_stage_log', `team_id=eq.${teamId}&select=*&order=changed_at.desc&limit=4`).catch(() => [] as any[]);
      const logRows = await database.select('person_stage_log', `team_id=eq.${teamId}&select=fub_person_id,stage,changed_at&limit=6000`).catch(() => [] as any[]);
      const logPersons = new Set(logRows.map((r: any) => r.fub_person_id));
      const logStages = new Set(logRows.map((r: any) => String(r.stage)));

      return json({
        team: teamId,
        peoplePulled: people.length,
        stageHistogram: Object.fromEntries(Object.entries(stageHist).sort((a, b) => b[1] - a[1])),
        stageLog_columns: logSample[0] ? Object.keys(logSample[0]) : [],
        stageLog_totalRows: logRows.length,
        stageLog_distinctPeople: logPersons.size,
        stageLog_rowsPerPerson: logPersons.size ? Math.round((logRows.length / logPersons.size) * 100) / 100 : 0,
        stageLog_distinctStages: [...logStages],
        stageLog_sample: logSample,
        fub_webhooksRegistered: webhooks,
        fub_recentEventTypes: recentEventTypes,
        fub_stagesList: stagesList,
        fub_fullPersonRedacted: oneCloser,
        closers_greedyMatch: greedy.length,
        closers_strict_excludingDeadStages: strict.length,
        closers_withDealCloseDate: withDate.length,
        dealCloseDateCoveragePct: strict.length ? Math.round((withDate.length / strict.length) * 100) : 0,
        closedByMonth_desc: Object.fromEntries(Object.entries(monthHist).sort((a, b) => (a[0] < b[0] ? 1 : -1))),
        personKeys: people[0] ? Object.keys(people[0]) : [],
      });
    }

    // Sync. Admin → one team (?teamId=) or all. Else → the caller's own org(s).
    if (url.pathname === '/sync' && req.method === 'POST') {
      const windowDays = Number(url.searchParams.get('window') ?? 180);
      try {
        if (isAdmin(req, env)) {
          const teamId = url.searchParams.get('teamId');
          if (teamId) {
            const rows = await database.select('teams', `id=eq.${teamId}&select=id,org_id,fub_subdomain`);
            if (!rows.length) return json({ error: 'team not found' }, 404);
            return json(await syncTeam(env, database, rows[0] as TeamRow, windowDays));
          }
          return json(await syncAllActiveTeams(env, database, windowDays));
        }
        const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
        if (!userId) return json({ error: 'unauthorized' }, 401);
        const orgIds = await userOrgIds(database, userId);
        if (!orgIds.length) return json({});
        const teams = (await database.select(
          'teams',
          `is_active=eq.true&org_id=in.(${orgIds.join(',')})&select=id,org_id,fub_subdomain`,
        )) as TeamRow[];
        const results: Record<string, unknown> = {};
        for (const t of teams) {
          try {
            results[t.id] = await syncTeam(env, database, t, windowDays);
          } catch (e) {
            results[t.id] = { error: String(e) };
          }
        }
        return json(results);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Update org thresholds / audit math. Signed-in user → patches their own org's
    // settings (browser is RLS-read-only, so writes come through the Worker).
    if (url.pathname === '/settings' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json({ error: 'no org' }, 403);
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return json({ error: 'bad body' }, 422);
      const patch: Record<string, unknown> = {};
      for (const k of ['avg_gci', 'close_rate', 'window_hours', 'strike_limit', 'strike_window_days', 'per_agent_capacity', 'pause_volume_leads', 'pause_no_close_leads']) {
        const v = Number(body[k]);
        if (body[k] != null && Number.isFinite(v)) patch[k] = v;
      }
      // Pause-watch toggles (booleans, so they skip the numeric coercion above).
      for (const k of ['pause_volume_on', 'pause_no_close_on']) {
        if (typeof body[k] === 'boolean') patch[k] = body[k];
      }
      // Clean-slate date for the no-closings rule: nullable ISO timestamp. An explicit
      // null/'' clears the slate (count all history again); a valid date sets it.
      if ('pause_no_close_since' in body) {
        const raw = body.pause_no_close_since;
        if (raw == null || raw === '') patch.pause_no_close_since = null;
        else {
          const t = Date.parse(String(raw));
          if (Number.isFinite(t)) patch.pause_no_close_since = new Date(t).toISOString();
        }
      }
      // Which paid-source families this org actually uses (drives every board filter).
      if (Array.isArray(body.sources)) {
        const KNOWN = ['Zillow', 'Realtor.com MVIP', 'Realtor.com', 'Homes.com', 'Facebook', 'Google', 'Referrals'];
        const picked = (body.sources as unknown[]).map(String).filter((s) => KNOWN.includes(s));
        if (picked.length) patch.sources = picked;
      }
      if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, 422);
      patch.updated_at = new Date().toISOString();
      try {
        await database.update('org_settings', `org_id=eq.${orgIds[0]}`, patch);
        return json({ ok: true });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Live FUB webhook: FUB POSTs here on person/call/text changes; we re-sync that
    // one team so its flags update without waiting on the cron. Guarded by ?key=.
    if (url.pathname === '/webhook/fub' && req.method === 'POST') {
      const teamId = url.searchParams.get('team');
      if (!teamId) return json({ error: 'team required' }, 400);
      if (env.WEBHOOK_SECRET && url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
        return json({ error: 'forbidden' }, 403);
      }
      const rows = await database.select('teams', `id=eq.${teamId}&is_active=eq.true&select=id,org_id,fub_subdomain`);
      if (!rows.length) return json({ error: 'team not found' }, 404);
      const team = rows[0] as TeamRow;
      // FUB posts { event, resourceIds }. A people event with a small, explicit id
      // list is the fast path: fetch just those lead(s) by id and upsert them
      // (syncPeopleByIds) — near-instant, and it accrues the stage-progression log
      // itself (same core syncTeam uses). Anything else — a call/text event (whose
      // resourceIds aren't person ids) or a missing/empty/oversized id list — falls
      // back to the existing full team re-sync. The 30-min cron does a full sync for
      // every team regardless, so capture never depends on a single webhook landing.
      const body = (await req.json().catch(() => null)) as { event?: string; resourceIds?: unknown } | null;
      const event = String(body?.event ?? '');
      const resourceIds = Array.isArray(body?.resourceIds) ? (body!.resourceIds as unknown[]) : null;
      // FUB disables a webhook that doesn't respond quickly, and on large teams the
      // sync itself can take longer than FUB's timeout — so ack immediately and let
      // the actual sync run in the background via ctx.waitUntil. Errors are only
      // visible in `wrangler tail` now (the caller already got a 200), so log both
      // the outcome and any failure loudly.
      ctx.waitUntil(
        (async () => {
          try {
            if (event.startsWith('people') && resourceIds && resourceIds.length > 0 && resourceIds.length <= 100) {
              const ids = resourceIds.map(String).join(',');
              const synced = await syncPeopleByIds(env, database, team, ids);
              console.log(`webhook/fub team=${teamId} mode=targeted synced=${JSON.stringify(synced)}`);
            } else {
              const synced = await syncTeam(env, database, team);
              console.log(`webhook/fub team=${teamId} mode=full synced=${JSON.stringify(synced)}`);
            }
          } catch (e) {
            console.error(`webhook/fub team=${teamId} sync failed:`, e);
          }
        })(),
      );
      return json({ ok: true, accepted: true });
    }

    // Admin: point a team's FUB account at our webhook so updates arrive live.
    if (url.pathname === '/webhook/register' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      const teamId = url.searchParams.get('teamId');
      if (!teamId) return json({ error: 'teamId required' }, 400);
      const secret = await database.select('team_secrets', `team_id=eq.${teamId}&select=fub_key_enc`);
      if (!secret.length) return json({ error: 'no FUB key for team' }, 404);
      try {
        const fubKey = await decryptKey(await importEncKey(env.FUB_ENC_KEY), secret[0].fub_key_enc);
        const cb = `${url.origin}/webhook/fub?team=${teamId}` + (env.WEBHOOK_SECRET ? `&key=${env.WEBHOOK_SECRET}` : '');
        return json({ team: teamId, callback: cb, results: await registerWebhooks(fubKey, cb, env.FUB_SYSTEM_KEY, env.FUB_SYSTEM_NAME) });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Add a team (a FUB account) to an EXISTING org: encrypt its key, store the
    // secret, and sync it now. Admin token OR a member of that org.
    if (url.pathname === '/add-team' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as any;
      const existingId = body?.teamId as string | undefined;
      const orgId = body?.orgId as string | undefined;
      const name = body?.name as string | undefined;
      const fubKey = body?.fubKey as string | undefined;
      if (!fubKey || (!existingId && (!orgId || !name))) {
        return json({ error: 'fubKey and (teamId OR orgId+name) required' }, 422);
      }
      let teamId = existingId;
      let teamOrg = orgId;
      if (existingId) {
        const rows = await database.select('teams', `id=eq.${existingId}&select=id,org_id`);
        if (!rows.length) return json({ error: 'team not found' }, 404);
        teamOrg = rows[0].org_id as string;
      }
      let ok = isAdmin(req, env);
      if (!ok && teamOrg) {
        const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
        if (userId) ok = (await userOrgIds(database, userId)).includes(teamOrg);
      }
      if (!ok) return json({ error: 'unauthorized' }, 401);
      try {
        if (!teamId) {
          const team = await database.insert('teams', { org_id: teamOrg, name });
          teamId = team.id as string;
        }
        const enc = await encryptKey(await importEncKey(env.FUB_ENC_KEY), fubKey);
        await database.upsert('team_secrets', [{ team_id: teamId, org_id: teamOrg, fub_key_enc: enc }], 'team_id');
        const sync = await syncTeam(env, database, { id: teamId, org_id: teamOrg as string, fub_subdomain: null }, 30);
        return json({ teamId, sync });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // A team lead connects / re-keys their Follow Up Boss account. Validates the key
    // against FUB, stores it encrypted (team_secrets — the ONE key every TRU product
    // reads), registers live webhooks, and kicks a background sync. Self-serve, so a
    // corrupted/rotated key can be fixed without ops.
    if (url.pathname === '/connect-fub' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json({ error: 'no org' }, 403);
      const body = (await req.json().catch(() => null)) as { fubKey?: string; teamId?: string } | null;
      const fubKey = body?.fubKey?.trim();
      if (!fubKey) return json({ error: 'fubKey required' }, 422);
      const teams = await database.select('teams', `org_id=in.(${orgIds.join(',')})&is_active=eq.true&select=id,org_id`);
      const team = body?.teamId ? teams.find((t) => t.id === body.teamId) : (teams.length === 1 ? teams[0] : null);
      if (!team) return json({ error: teams.length > 1 ? 'teamId required (multiple teams)' : 'no team for this account' }, 422);
      const check = await validateKey(fubKey);
      if (!check.valid) return json({ error: 'That API key was rejected by Follow Up Boss. Copy it fresh from FUB → Admin → API.' }, 400);
      try {
        await connectTeamKey(env, database, ctx, url.origin, team, fubKey, check.subdomain);
        return json({ ok: true, subdomain: check.subdomain, syncing: true });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Connection status for the caller's team(s): is a key stored, subdomain, last sync.
    if (url.pathname === '/connection' && req.method === 'GET') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json([]);
      const teams = await database.select('teams', `org_id=in.(${orgIds.join(',')})&is_active=eq.true&select=id,name,fub_subdomain`);
      const secrets = await database.select('team_secrets', `org_id=in.(${orgIds.join(',')})&select=team_id`);
      const hasKey = new Set((secrets as Array<{ team_id: string }>).map((s) => s.team_id));
      const state = await database.select('sync_state', 'select=team_id,last_sync_at');
      const lastByTeam = new Map((state as Array<{ team_id: string; last_sync_at: string }>).map((s) => [s.team_id, s.last_sync_at]));
      return json((teams as Array<{ id: string; name: string; fub_subdomain: string | null }>).map((t) => ({
        teamId: t.id, name: t.name, connected: hasKey.has(t.id), subdomain: t.fub_subdomain, lastSync: lastByTeam.get(t.id) ?? null,
      })));
    }

    // Admin: run the 3-strike reconcile now (ops / testing).
    if (url.pathname === '/reconcile' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      try {
        return json(await reconcileAllTeams(database));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Admin: send the weekly Leadership Brief now (ops / testing).
    if (url.pathname === '/brief' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      try {
        return json(await sendWeeklyBriefs(env, database));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Platform-owner console (drives the HQ "act as a team" tile). Caller must be
    // a signed-in user listed in the admins table — verified server-side.
    if (url.pathname.startsWith('/admin/')) {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const adminRows = await database.select('admins', `id=eq.${userId}&select=id`);
      if (!adminRows.length) return json({ error: 'forbidden' }, 403);

      if (url.pathname === '/admin/leaders' && req.method === 'GET') {
        const [leaders, teams, orgs] = await Promise.all([
          database.select('leaders', 'select=id,name,email,team_id'),
          database.select('teams', 'select=id,name,org_id'),
          database.select('orgs', 'select=id,name'),
        ]);
        const teamById = new Map(teams.map((t: any) => [t.id, t]));
        const orgById = new Map(orgs.map((o: any) => [o.id, o]));
        const out = (leaders as any[])
          .filter((l) => l.id !== userId) // don't list the admin themself
          .map((l) => {
            const t = teamById.get(l.team_id) as any;
            const o = t ? (orgById.get(t.org_id) as any) : null;
            return { id: l.id, name: l.name, email: l.email, team_name: t?.name ?? '—', org_name: o?.name ?? '—' };
          });
        return json({ leaders: out });
      }

      if (url.pathname === '/admin/impersonate' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as any;
        const email = String(body?.email ?? '').trim();
        if (!email) return json({ error: 'email required' }, 422);
        const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/generate_link', {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: 'magiclink', email }),
        });
        const gl = (await res.json().catch(() => null)) as any;
        const props = gl?.properties ?? gl;
        if (!res.ok || !props?.hashed_token) return json({ error: 'could not mint session' }, 502);
        return json({ token_hash: props.hashed_token, type: props.verification_type || 'magiclink' });
      }

      // Admin connection board: every team's FUB status in one place — the verify-at-
      // a-glance view AND the source for setting a key on a team's behalf.
      if (url.pathname === '/admin/connections' && req.method === 'GET') {
        const [teams, orgs, secrets, state] = await Promise.all([
          database.select('teams', 'is_active=eq.true&select=id,name,org_id,fub_subdomain'),
          database.select('orgs', 'select=id,name'),
          database.select('team_secrets', 'select=team_id'),
          database.select('sync_state', 'select=team_id,last_sync_at'),
        ]);
        const orgById = new Map((orgs as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]));
        const hasKey = new Set((secrets as Array<{ team_id: string }>).map((s) => s.team_id));
        const lastByTeam = new Map((state as Array<{ team_id: string; last_sync_at: string }>).map((s) => [s.team_id, s.last_sync_at]));
        const out = (teams as Array<{ id: string; name: string; org_id: string; fub_subdomain: string | null }>)
          .map((t) => ({
            teamId: t.id, name: t.name, orgName: orgById.get(t.org_id) ?? '—',
            connected: hasKey.has(t.id), subdomain: t.fub_subdomain, lastSync: lastByTeam.get(t.id) ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json({ connections: out });
      }

      // Admin sets/rotates any team's FUB key on their behalf (no impersonation).
      if (url.pathname === '/admin/connect-fub' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as { teamId?: string; fubKey?: string } | null;
        const teamId = String(body?.teamId ?? '').trim();
        const fubKey = body?.fubKey?.trim();
        if (!teamId || !fubKey) return json({ error: 'teamId and fubKey required' }, 422);
        const rows = await database.select('teams', `id=eq.${teamId}&select=id,org_id`);
        if (!rows.length) return json({ error: 'team not found' }, 404);
        const team = rows[0] as { id: string; org_id: string };
        const check = await validateKey(fubKey);
        if (!check.valid) return json({ error: 'That API key was rejected by Follow Up Boss. Copy it fresh from FUB → Admin → API.' }, 400);
        try {
          await connectTeamKey(env, database, ctx, url.origin, team, fubKey, check.subdomain);
          return json({ ok: true, subdomain: check.subdomain, syncing: true });
        } catch (e) {
          return json({ error: String(e) }, 500);
        }
      }
    }

    // ── TRU Rep — agent onboarding ──────────────────────────────────────────
    // Invite an agent to set up a login. Leader (member of the agent's org) or
    // admin. First time → a Supabase `invite` link (creates the auth user, which
    // we pre-link to the agent row); re-invite of an already-linked agent → a
    // `recovery` link so they can get back in / reset.
    if (url.pathname === '/rep/invite' && req.method === 'POST') {
      const admin = isAdmin(req, env);
      const userId = admin ? null : await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!admin && !userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as any;
      const agentId = String(body?.agentId ?? '').trim();
      if (!agentId) return json({ error: 'agentId required' }, 422);
      const rows = await database.select('agents', `id=eq.${agentId}&select=id,org_id,email,auth_id`);
      if (!rows.length) return json({ error: 'agent not found' }, 404);
      const agent = rows[0] as any;
      if (!agent.email) return json({ error: 'agent has no email on file' }, 422);
      if (!admin) {
        const orgs = await userOrgIds(database, userId as string);
        if (!orgs.includes(agent.org_id)) return json({ error: 'forbidden' }, 403);
      }
      const linkType = agent.auth_id ? 'recovery' : 'invite';
      const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/generate_link', {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: linkType, email: agent.email, redirect_to: 'https://app.truhq.co' }),
      });
      const gl = (await res.json().catch(() => null)) as any;
      const props = gl?.properties ?? gl;
      const link = props?.action_link;
      if (!res.ok || !link) return json({ error: 'could not mint invite' }, 502);
      const newUserId = gl?.user?.id ?? gl?.id;
      if (!agent.auth_id && newUserId) {
        await database.update('agents', `id=eq.${agentId}`, { auth_id: newUserId });
      }
      return json({ link, email: agent.email, reinvite: !!agent.auth_id });
    }

    // ── TRU Rep — the Live Sim (practice calls) ─────────────────────────────
    // The scenario roster + whether the sim is configured (keys present).
    if (url.pathname === '/rep/practice/scenarios' && req.method === 'GET') {
      return json({
        configured: simConfigured(env),
        scenarios: PERSONAS.map((p) => ({ key: p.key, name: p.name, label: p.label, blurb: p.blurb })),
      });
    }

    // Ops: cast the four persona agents (own voices, slowed speech, patience).
    // Idempotent — creates the missing ones, re-tunes the existing. Admin-guarded.
    if (url.pathname === '/rep/practice/setup' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      if (!env.RETELL_API_KEY || !env.RETELL_AGENT_ID) return json({ error: 'sim not configured' }, 503);
      try {
        return json({ ok: true, cast: await setupPersonaAgents(env) });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // Ops: tune one persona's voice behavior (responsiveness, speed, voice)
    // without touching the Retell dashboard. Admin-token guarded.
    if (url.pathname === '/rep/practice/tune' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
      if (!env.RETELL_API_KEY || !env.RETELL_AGENT_ID) return json({ error: 'sim not configured' }, 503);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of ['responsiveness', 'interruption_sensitivity', 'voice_id', 'voice_speed', 'voice_temperature', 'enable_backchannel', 'end_call_after_silence_ms']) {
        if (body[k] != null) patch[k] = body[k];
      }
      if (!Object.keys(patch).length) return json({ error: 'nothing to tune' }, 422);
      // Target one persona's agent (?persona=relocator), or the base agent.
      const persona = body.persona ? personaByKey(String(body.persona)) : null;
      const targetId = persona ? await agentIdForPersona(env, persona) : env.RETELL_AGENT_ID;
      const res = await fetch(`https://api.retellai.com/update-agent/${targetId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${env.RETELL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return json({ ok: res.ok, target: persona?.name ?? 'base', applied: patch, voice_id: j.voice_id }, res.ok ? 200 : 502);
    }

    // Start a practice call: create the Retell web call with the persona
    // injected, record the attempt, hand the browser its access token.
    if (url.pathname === '/rep/practice/start' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      if (!simConfigured(env)) return json({ error: 'The Live Sim isn’t configured yet — ask your leader.' }, 503);
      const body = (await req.json().catch(() => null)) as any;
      const persona = personaByKey(String(body?.scenario ?? ''));
      if (!persona) return json({ error: 'unknown scenario' }, 422);
      const agent = await agentFromAuth(database, userId);
      if (!agent) {
        // Leader/admin TEST mode: real call, real grade, nothing stored — a
        // leader trying the sim never pollutes certification records.
        const orgs = await userOrgIds(database, userId);
        const allowed = orgs.length > 0 || (await database.select('admins', `id=eq.${userId}&select=id`)).length > 0;
        if (!allowed) return json({ error: 'not an agent' }, 403);
        try {
          const { callId, accessToken } = await createWebCall(env, persona);
          return json({ practiceId: `test:${persona.key}:${callId}`, accessToken, test: true });
        } catch (e) {
          return json({ error: String(e) }, 502);
        }
      }
      try {
        const { callId, accessToken } = await createWebCall(env, persona);
        const row = await database.insert('rep_practice', {
          agent_id: agent.id, org_id: agent.org_id, scenario: persona.key, call_id: callId, status: 'started',
        });
        return json({ practiceId: row.id, accessToken });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // Finish: pull the transcript from Retell (retrying while it settles),
    // grade it against ALMS, store + return the scorecard.
    if (url.pathname === '/rep/practice/finish' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as any;
      const practiceId = String(body?.practiceId ?? '');
      if (!practiceId) return json({ error: 'practiceId required' }, 422);
      // Leader/admin TEST mode: grade straight off the Retell call, store nothing.
      if (practiceId.startsWith('test:')) {
        const orgs = await userOrgIds(database, userId);
        const allowed = orgs.length > 0 || (await database.select('admins', `id=eq.${userId}&select=id`)).length > 0;
        if (!allowed) return json({ error: 'forbidden' }, 403);
        const [, scenarioKey, callId] = practiceId.split(':');
        try {
          let transcript: string | null = null;
          let durationS: number | null = null;
          for (let i = 0; i < 5; i++) {
            const call = await getCall(env, callId);
            transcript = call.transcript; durationS = call.durationS;
            if (transcript && call.status === 'ended') break;
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (!transcript || transcript.trim().length < 40) {
            return json({ error: 'That call was too short to grade — give it at least a minute of real conversation.' }, 422);
          }
          const persona = personaByKey(scenarioKey);
          const { score, breakdown } = await gradeTranscript(env, persona?.name ?? 'Buyer', transcript);
          return json({ score, passed: score >= 80, breakdown, durationS, test: true });
        } catch (e) {
          return json({ error: String(e) }, 502);
        }
      }
      const agent = await agentFromAuth(database, userId);
      if (!agent) return json({ error: 'not an agent' }, 403);
      const rows = await database.select('rep_practice', `id=eq.${practiceId}&agent_id=eq.${agent.id}&select=id,call_id,scenario,status`);
      if (!rows.length) return json({ error: 'attempt not found' }, 404);
      const attempt = rows[0] as any;
      try {
        // Retell finalizes the transcript a few seconds after hangup.
        let transcript: string | null = null;
        let durationS: number | null = null;
        for (let i = 0; i < 5; i++) {
          const call = await getCall(env, attempt.call_id);
          transcript = call.transcript; durationS = call.durationS;
          if (transcript && call.status === 'ended') break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (!transcript || transcript.trim().length < 40) {
          await database.update('rep_practice', `id=eq.${practiceId}`, { status: 'failed' });
          return json({ error: 'That call was too short to grade — give it at least a minute of real conversation.' }, 422);
        }
        const persona = personaByKey(attempt.scenario);
        const { score, breakdown } = await gradeTranscript(env, persona?.name ?? 'Buyer', transcript);
        const passed = score >= 80;
        await database.update('rep_practice', `id=eq.${practiceId}`, {
          status: 'graded', score, passed, breakdown, transcript, duration_s: durationS, graded_at: new Date().toISOString(),
        });
        return json({ score, passed, breakdown, durationS });
      } catch (e) {
        await database.update('rep_practice', `id=eq.${practiceId}`, { status: 'failed' });
        return json({ error: String(e) }, 502);
      }
    }

    // Grade a module quiz server-side (so a pass can't be forged in the browser).
    // Caller must be the logged-in agent; answers are matched to the questions the
    // agent never received the correct index for.
    if (url.pathname === '/rep/grade' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as any;
      const moduleId = String(body?.moduleId ?? '').trim();
      const answers = Array.isArray(body?.answers) ? (body.answers as unknown[]) : null;
      if (!moduleId || !answers) return json({ error: 'moduleId and answers[] required' }, 422);
      const arows = await database.select('agents', `auth_id=eq.${userId}&select=id,org_id`);
      if (!arows.length) return json({ error: 'not an agent' }, 403);
      const agent = arows[0] as any;
      const [mods, qs] = await Promise.all([
        database.select('rep_modules', `id=eq.${moduleId}&select=id,pass_pct,active`),
        database.select('rep_questions', `module_id=eq.${moduleId}&select=idx,answer,explain&order=idx`),
      ]);
      if (!mods.length || !mods[0].active) return json({ error: 'module not found' }, 404);
      if (!qs.length) return json({ error: 'module has no questions' }, 422);
      const passPct = Number(mods[0].pass_pct ?? 80);
      let correct = 0;
      const review = (qs as any[]).map((q, i) => {
        const your = typeof answers[i] === 'number' ? (answers[i] as number) : -1;
        const isCorrect = your === q.answer;
        if (isCorrect) correct++;
        return { idx: q.idx, your, correct_index: q.answer, is_correct: isCorrect, explain: q.explain ?? null };
      });
      const total = qs.length;
      const score = Math.round((correct / total) * 100);
      const passed = score >= passPct;
      const prior = await database.select(
        'rep_progress',
        `agent_id=eq.${agent.id}&module_id=eq.${moduleId}&select=attempts,passed_at`,
      );
      const attempts = ((prior[0]?.attempts as number) ?? 0) + 1;
      const passed_at = passed ? ((prior[0]?.passed_at as string) ?? new Date().toISOString()) : ((prior[0]?.passed_at as string) ?? null);
      await database.upsert(
        'rep_progress',
        [{
          agent_id: agent.id, org_id: agent.org_id, module_id: moduleId,
          status: passed ? 'passed' : 'in_progress', score, attempts,
          passed_at, updated_at: new Date().toISOString(),
        }],
        'agent_id,module_id',
      );
      return json({ score, passed, correct, total, review });
    }

    // Mint a SHORT-LIVED signed DOWNLOAD url for a private rep-media object so a
    // learner can play/embed it in the course (Block 4). Storage RLS only grants
    // read to org MEMBERS (is_org_member → memberships) and a learner agent is NOT
    // a member (agents table, not memberships) — so a learner can never mint their
    // own client-side createSignedUrl. This mirrors /rep/grade's exact learner
    // lookup (agents.auth_id → org_id) and additionally authorizes a leader/admin
    // of that same org (so the authoring preview can use the same path).
    if (url.pathname === '/rep/media/sign-download' && req.method === 'GET') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const path = (url.searchParams.get('path') ?? '').trim();
      const segs = path.split('/').filter(Boolean);
      // Path convention is strictly <org_id>/<uuid>.<ext> (Block 1) — reject
      // anything else (no traversal, no extra segments).
      if (segs.length !== 2 || path.includes('..')) return json({ error: 'path required' }, 422);
      if (!isUuid(segs[0]) || !/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(segs[1])) {
        return json({ error: 'invalid id' }, 422);
      }
      const orgId = segs[0];
      // Same lookup /rep/grade uses to resolve a learner agent to their org —
      // never trust the path's org_id blindly; the caller must actually belong
      // to it, either as that org's agent or as its leader/admin.
      const arows = await database.select('agents', `auth_id=eq.${userId}&select=id,org_id`);
      const isAgentOfOrg = arows.length > 0 && (arows[0] as any).org_id === orgId;
      const isLeader = !isAgentOfOrg && (await isOrgLeaderOrAdmin(database, userId, orgId));
      if (!isAgentOfOrg && !isLeader) return json({ error: 'forbidden' }, 403);
      try {
        const objectPath = segs.map(encodeURIComponent).join('/');
        const signRes = await fetch(
          `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/sign/rep-media/${objectPath}`,
          {
            method: 'POST',
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expiresIn: 3600 }),
          },
        );
        const sj = (await signRes.json().catch(() => null)) as { signedURL?: string } | null;
        if (!signRes.ok || !sj?.signedURL) return json({ error: 'could not sign download' }, 502);
        const signedUrl = env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1' + sj.signedURL;
        return json({ url: signedUrl });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // ── TRU Rep — authoring (custom modules) ────────────────────────────────
    // Every route below: signed-in caller, leader/admin of the target org,
    // never trusts an org_id/module_id from the body without checking it.

    // Mint a Supabase Storage signed UPLOAD url for the private `rep-media`
    // bucket (Block 1). There's no supabase-js binding in the Worker, so this
    // talks to the Storage REST API directly with the same base URL + service
    // key db.ts uses for PostgREST. Path convention: <org_id>/<uuid>.<ext>.
    if (url.pathname === '/rep/uploads/sign' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as any;
      const orgId = String(body?.org_id ?? '').trim();
      const ext = String(body?.ext ?? '').trim().toLowerCase().replace(/^\./, '');
      const contentType = body?.contentType ? String(body.contentType) : null;
      if (!orgId || !ext) return json({ error: 'org_id and ext required' }, 422);
      if (!isUuid(orgId)) return json({ error: 'invalid id' }, 422);
      if (!(await isOrgLeaderOrAdmin(database, userId, orgId))) return json({ error: 'forbidden' }, 403);
      if (!REP_UPLOAD_EXTS.has(ext)) return json({ error: 'file type not allowed' }, 422);
      if (contentType && !REP_UPLOAD_CT_RE.some((re) => re.test(contentType))) {
        return json({ error: 'file type not allowed' }, 422);
      }
      const objectPath = `${orgId}/${crypto.randomUUID()}.${ext}`;
      try {
        const signRes = await fetch(
          `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/upload/sign/rep-media/${objectPath}`,
          {
            method: 'POST',
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          },
        );
        const sj = (await signRes.json().catch(() => null)) as { url?: string } | null;
        if (!signRes.ok || !sj?.url) return json({ error: 'could not sign upload' }, 502);
        const tokenMatch = sj.url.match(/[?&]token=([^&]+)/);
        const uploadToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
        if (!uploadToken) return json({ error: 'could not sign upload' }, 502);
        const signedUrl = env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1' + sj.url;
        return json({ path: objectPath, token: uploadToken, signedUrl });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // Create OR update a source='custom' module for the caller's org. Update
    // requires the existing row to already be source='custom' AND in that
    // org — a leader can never touch another org's rows or a system module.
    if (url.pathname === '/rep/modules' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as any;
      const orgId = String(body?.org_id ?? '').trim();
      const title = String(body?.title ?? '').trim();
      const id = body?.id ? String(body.id).trim() : null;
      if (!orgId || !title) return json({ error: 'org_id and title required' }, 422);
      if (!isUuid(orgId) || (id && !isUuid(id))) return json({ error: 'invalid id' }, 422);
      if (!(await isOrgLeaderOrAdmin(database, userId, orgId))) return json({ error: 'forbidden' }, 403);
      const patch: Record<string, unknown> = {
        title,
        summary: body?.summary ?? null,
        cards: Array.isArray(body?.cards) ? body.cards : [],
        pass_pct: Number.isFinite(Number(body?.pass_pct)) ? Number(body.pass_pct) : 80,
      };
      // `active` (the runtime on/off switch the learner loaders filter on) is
      // kept a strict function of `status` so a draft can never be born live:
      // whenever status is written, active = (status === 'published').
      if (body?.status) {
        const status = String(body.status);
        patch.status = status;
        patch.active = status === 'published';
      }
      try {
        if (id) {
          const existing = await database.select('rep_modules', `id=eq.${id}&select=id,org_id,source`);
          if (!existing.length) return json({ error: 'module not found' }, 404);
          const mod = existing[0] as any;
          if (mod.source !== 'custom' || mod.org_id !== orgId) return json({ error: 'forbidden' }, 403);
          // If no status was provided on this update, `active` is left untouched
          // — omitting status must not flip a published module offline.
          await database.update('rep_modules', `id=eq.${id}`, patch);
          const rows = await database.select('rep_modules', `id=eq.${id}&select=*`);
          return json(rows[0]);
        }
        const createStatus = (patch.status as string) ?? 'draft';
        const row = await database.insert('rep_modules', {
          ...patch,
          org_id: orgId,
          source: 'custom',
          author_id: userId,
          status: createStatus,
          active: createStatus === 'published',
        });
        return json(row);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Author/replace a custom module's quiz questions (delete-all + insert is
    // the simplest correct semantics here — the module's org/source is
    // re-verified so a stale/forged module id can't write into another org).
    const questionsMatch = url.pathname.match(/^\/rep\/modules\/([^/]+)\/questions$/);
    if (questionsMatch && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const moduleId = questionsMatch[1];
      if (!isUuid(moduleId)) return json({ error: 'invalid id' }, 422);
      const body = (await req.json().catch(() => null)) as any;
      const questions = Array.isArray(body?.questions) ? (body.questions as any[]) : null;
      if (!questions) return json({ error: 'questions[] required' }, 422);
      const rows = await database.select('rep_modules', `id=eq.${moduleId}&select=id,org_id,source`);
      if (!rows.length) return json({ error: 'module not found' }, 404);
      const mod = rows[0] as any;
      if (mod.source !== 'custom') return json({ error: 'forbidden' }, 403);
      if (!(await isOrgLeaderOrAdmin(database, userId, mod.org_id))) return json({ error: 'forbidden' }, 403);
      const payload = questions.map((q, i) => ({
        module_id: moduleId,
        idx: Number.isFinite(Number(q?.idx)) ? Number(q.idx) : i + 1,
        prompt: String(q?.prompt ?? ''),
        choices: Array.isArray(q?.choices) ? q.choices : [],
        answer: Number.isFinite(Number(q?.answer)) ? Number(q.answer) : 0,
        explain: q?.explain ?? null,
      }));
      if (payload.some((q) => !q.prompt || q.choices.length < 2)) {
        return json({ error: 'each question needs a prompt and at least 2 choices' }, 422);
      }
      try {
        await deleteRepQuestions(env, moduleId);
        if (payload.length) await database.upsert('rep_questions', payload);
        // Caller here is the authoring leader (not the learner grading path),
        // so returning answer/explain is deliberate — rep_questions_public
        // (hq_rep_agent.sql) is what actually reaches the browser for agents.
        const saved = await database.select(
          'rep_questions',
          `module_id=eq.${moduleId}&select=id,idx,prompt,choices,answer,explain&order=idx`,
        );
        return json({ count: saved.length, questions: saved });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Return the REAL answers for a custom module's quiz — leader/admin authoring
    // use only (prefills the editor without the re-confirm-every-answer friction
    // the masked view forces). Re-fetches the module's own org_id/source server
    // side (never trusts the client) so this can never leak a system module's
    // answers or another org's custom module — and it is never reachable from any
    // learner-facing path (learners still only ever read rep_questions_public).
    const answersMatch = url.pathname.match(/^\/rep\/modules\/([^/]+)\/answers$/);
    if (answersMatch && req.method === 'GET') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const moduleId = answersMatch[1];
      if (!isUuid(moduleId)) return json({ error: 'invalid id' }, 422);
      const rows = await database.select('rep_modules', `id=eq.${moduleId}&select=id,org_id,source`);
      if (!rows.length) return json({ error: 'module not found' }, 404);
      const mod = rows[0] as any;
      if (mod.source !== 'custom') return json({ error: 'forbidden' }, 403);
      if (!(await isOrgLeaderOrAdmin(database, userId, mod.org_id))) return json({ error: 'forbidden' }, 403);
      const qs = await database.select(
        'rep_questions',
        `module_id=eq.${moduleId}&select=idx,prompt,choices,answer,explain&order=idx`,
      );
      return json({ questions: qs });
    }

    // Archive a custom module: status='archived' + active=false (active is
    // the runtime on/off switch the learner-facing queries already filter on;
    // status is the authoring lifecycle — Block 1's carry-forward note).
    const archiveMatch = url.pathname.match(/^\/rep\/modules\/([^/]+)\/archive$/);
    if (archiveMatch && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const moduleId = archiveMatch[1];
      if (!isUuid(moduleId)) return json({ error: 'invalid id' }, 422);
      const rows = await database.select('rep_modules', `id=eq.${moduleId}&select=id,org_id,source`);
      if (!rows.length) return json({ error: 'module not found' }, 404);
      const mod = rows[0] as any;
      if (mod.source !== 'custom') return json({ error: 'forbidden' }, 403);
      if (!(await isOrgLeaderOrAdmin(database, userId, mod.org_id))) return json({ error: 'forbidden' }, 403);
      try {
        await database.update('rep_modules', `id=eq.${moduleId}`, { status: 'archived', active: false });
        return json({ ok: true });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const database = db(env);
    await syncAllActiveTeams(env, database, 180);
    // The daily 07:05 trigger also runs the 3-strike reconcile (after a fresh sync).
    if (controller.cron === '5 7 * * *') {
      await reconcileAllTeams(database);
    }
    // Monday 13:00 UTC → the weekly Leadership Brief.
    if (controller.cron === '0 13 * * 1') {
      await sendWeeklyBriefs(env, database);
    }
  },
} satisfies ExportedHandler<Env>;
