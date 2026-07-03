// TRU Pulse — sync Worker. Health / provision / manual sync, plus the cron that
// keeps every tenant's flags fresh. Provision + sync accept EITHER an ops admin token
// (Eric) OR a signed-in user's Supabase token (self-serve onboarding).
import type { Env } from './env.js';
import { db } from './db.js';
import { verifySupabaseUser, userOrgIds } from './auth.js';
import { provision, type ProvisionInput } from './provision.js';
import { syncTeam, syncAllActiveTeams, logStageChanges, type TeamRow } from './sync.js';
import { reconcileAllTeams } from './accountability.js';
import { sendWeeklyBriefs } from './brief.js';
import { importEncKey, decryptKey, encryptKey } from './crypto.js';
import { registerWebhooks, validateKey } from './fub.js';
import { PERSONAS, personaByKey, createWebCall, getCall, gradeTranscript, simConfigured, agentFromAuth, setupPersonaAgents, agentIdForPersona } from './practice.js';
import { runCircleCampaign, runOutboundCampaign, logDisposition } from './prospect/service.js';
import { saveVoiceProfile, loadVoiceProfile, generateSocialCalendar, listSocialCalendar, setContentStatus } from './social/service.js';

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
      // FUB posts { event, resourceIds }. On a stage change, stamp the moment into
      // person_stage_log — the dated closings/UC signal (never the Deals tab).
      const payload = (await req.json().catch(() => null)) as { event?: string; resourceIds?: number[] } | null;
      try {
        const synced = await syncTeam(env, database, team, 30);
        const logged = payload?.event === 'peopleStageUpdated' && Array.isArray(payload.resourceIds)
          ? await logStageChanges(env, database, team, payload.resourceIds)
          : 0;
        return json({ ok: true, synced, logged });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
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
        return json({ team: teamId, callback: cb, results: await registerWebhooks(fubKey, cb, env.FUB_SYSTEM_KEY) });
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
        const enc = await encryptKey(await importEncKey(env.FUB_ENC_KEY), fubKey);
        await database.upsert('team_secrets', [{ team_id: team.id, org_id: team.org_id, fub_key_enc: enc }], 'team_id');
        if (check.subdomain) await database.update('teams', `id=eq.${team.id}`, { fub_subdomain: check.subdomain });
        if (env.FUB_SYSTEM_KEY) {
          const cb = `${url.origin}/webhook/fub?team=${team.id}` + (env.WEBHOOK_SECRET ? `&key=${env.WEBHOOK_SECRET}` : '');
          try { await registerWebhooks(fubKey, cb, env.FUB_SYSTEM_KEY); } catch { /* live updates are best-effort */ }
        }
        // Heavy full pull → run in the background so the UI returns immediately.
        ctx.waitUntil(syncTeam(env, database, { id: team.id, org_id: team.org_id, fub_subdomain: check.subdomain }, 180).catch(() => {}));
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

    // ── TRU Prospect — agent-assist outbound (Circle Prospecting) ───────────
    // Run a circle campaign around a subject location: neighbor lookup → skip
    // trace → DNC scrub → compliance gate → prioritized call_queue. A human dials
    // from the queue; nothing here auto-dials. Providers are stubbed until keys land.
    if (url.pathname === '/prospect/circle/run' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json({ error: 'no org' }, 403);
      const body = (await req.json().catch(() => null)) as any;
      const lat = Number(body?.center?.latitude ?? body?.latitude);
      const lng = Number(body?.center?.longitude ?? body?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json({ error: 'center {latitude, longitude} required' }, 422);
      }
      try {
        return json(await runCircleCampaign(env, database, {
          orgId: orgIds[0], teamId: body?.teamId ?? null, agentId: body?.agentId ?? null,
          name: body?.name, center: { latitude: lat, longitude: lng },
          radiusMeters: Number(body?.radiusMeters) || 500, limit: Number(body?.limit) || 50,
        }));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // Expired / FSBO campaigns — pull today's listings (stubbed feed) and run the
    // same data→gate→queue→dossier pipeline. Body: { channel:'expired'|'fsbo', name?, limit? }.
    if (url.pathname === '/prospect/listing/run' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json({ error: 'no org' }, 403);
      const body = (await req.json().catch(() => null)) as any;
      const channel = body?.channel === 'fsbo' ? 'fsbo' : body?.channel === 'expired' ? 'expired' : null;
      if (!channel) return json({ error: "channel must be 'expired' or 'fsbo'" }, 422);
      try {
        return json(await runOutboundCampaign(env, database, {
          orgId: orgIds[0], teamId: body?.teamId ?? null, agentId: body?.agentId ?? null,
          channel, name: body?.name, limit: Number(body?.limit) || 25,
        }));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // List a campaign's call queue (person + phone + state + gate decision + dossier),
    // priority-ordered. Org-scoped; the browser could also read this via RLS.
    if (url.pathname === '/prospect/queue' && req.method === 'GET') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json({ items: [] });
      const campaignId = url.searchParams.get('campaignId');
      const filter = campaignId ? `campaign_id=eq.${campaignId}&` : '';
      const rows = await database.select(
        'prospect_call_queue',
        `${filter}org_id=in.(${orgIds.join(',')})&order=priority.asc&select=id,person_id,phone_e164,channel,priority,state,next_eligible_at,last_gate_decision,dossier`,
      );
      const ids = [...new Set(rows.map((r: any) => r.person_id))];
      const names = new Map<string, any>();
      if (ids.length) {
        const people = await database.select('prospect_people', `id=in.(${ids.join(',')})&select=id,full_name,timezone,source`);
        for (const p of people as any[]) names.set(p.id, p);
      }
      return json({ items: rows.map((r: any) => ({ ...r, person: names.get(r.person_id) ?? null })) });
    }

    // Log a call outcome (one-tap). Advances the queue + propagates opt-outs;
    // FUB writeback is TODO (task #7).
    if (url.pathname === '/prospect/disposition' && req.method === 'POST') {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const orgIds = await userOrgIds(database, userId);
      if (!orgIds.length) return json({ error: 'no org' }, 403);
      const body = (await req.json().catch(() => null)) as any;
      if (!body?.queueItemId || !body?.outcome) return json({ error: 'queueItemId and outcome required' }, 422);
      try {
        return json(await logDisposition(env, database, {
          orgId: orgIds[0], agentId: body?.agentId ?? null, queueItemId: String(body.queueItemId),
          outcome: String(body.outcome), notes: body?.notes, nextAction: body?.nextAction,
        }));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // ── TRU Studio — Social content calendar (Bundle B, shares no telephony/
    // compliance spine with Prospect). Dual auth: an agent's own login scopes to
    // themself; a leader's login scopes to their org and must name an agentId.
    if (url.pathname.startsWith('/social/')) {
      const userId = await verifySupabaseUser(env, req.headers.get('Authorization'));
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const asAgent = await agentFromAuth(database, userId);
      const resolveScope = async (bodyAgentId?: string): Promise<{ orgId: string; agentId: string } | null> => {
        if (asAgent) return { orgId: asAgent.org_id, agentId: asAgent.id };
        const orgIds = await userOrgIds(database, userId);
        if (!orgIds.length || !bodyAgentId) return null;
        return { orgId: orgIds[0], agentId: bodyAgentId };
      };

      if (url.pathname === '/social/voice-profile' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as any;
        const scope = await resolveScope(body?.agentId);
        if (!scope) return json({ error: 'agentId required (leader) or sign in as an agent' }, 422);
        try {
          return json(await saveVoiceProfile(env, database, {
            orgId: scope.orgId, agentId: scope.agentId,
            samplePosts: Array.isArray(body?.samplePosts) ? body.samplePosts.map(String) : [],
            audience: body?.audience, brandKit: body?.brandKit,
          }));
        } catch (e) {
          return json({ error: String(e) }, 500);
        }
      }

      if (url.pathname === '/social/voice-profile' && req.method === 'GET') {
        const scope = await resolveScope(url.searchParams.get('agentId') ?? undefined);
        if (!scope) return json({ error: 'agentId required' }, 422);
        return json((await loadVoiceProfile(database, scope.orgId, scope.agentId)) ?? {});
      }

      if (url.pathname === '/social/calendar/generate' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as any;
        const scope = await resolveScope(body?.agentId);
        if (!scope) return json({ error: 'agentId required (leader) or sign in as an agent' }, 422);
        if (!body?.focus) return json({ error: 'focus required — what should this content be about?' }, 422);
        try {
          return json(await generateSocialCalendar(env, database, {
            orgId: scope.orgId, agentId: scope.agentId, focus: String(body.focus),
            days: Number(body?.days) || undefined, startDate: body?.startDate,
          }));
        } catch (e) {
          return json({ error: String(e) }, 500);
        }
      }

      if (url.pathname === '/social/calendar' && req.method === 'GET') {
        const scope = await resolveScope(url.searchParams.get('agentId') ?? undefined);
        if (!scope) return json({ error: 'agentId required' }, 422);
        return json({ items: await listSocialCalendar(database, scope.orgId, scope.agentId) });
      }

      if (url.pathname === '/social/content/status' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as any;
        const scope = await resolveScope(body?.agentId);
        if (!scope) return json({ error: 'agentId required (leader) or sign in as an agent' }, 422);
        const contentId = String(body?.contentId ?? '');
        const status = String(body?.status ?? '');
        if (!contentId || !['draft', 'approved', 'scheduled', 'posted', 'rejected'].includes(status)) {
          return json({ error: 'contentId and a valid status required' }, 422);
        }
        try {
          await setContentStatus(database, scope.orgId, contentId, status as any);
          return json({ ok: true });
        } catch (e) {
          return json({ error: String(e) }, 500);
        }
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
