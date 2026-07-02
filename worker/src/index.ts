// TRU Pulse — sync Worker. Health / provision / manual sync, plus the cron that
// keeps every tenant's flags fresh. Provision + sync accept EITHER an ops admin token
// (Eric) OR a signed-in user's Supabase token (self-serve onboarding).
import type { Env } from './env.js';
import { db } from './db.js';
import { verifySupabaseUser, userOrgIds } from './auth.js';
import { provision, type ProvisionInput } from './provision.js';
import { syncTeam, syncAllActiveTeams, type TeamRow } from './sync.js';
import { reconcileAllTeams } from './accountability.js';
import { sendWeeklyBriefs } from './brief.js';
import { importEncKey, decryptKey, encryptKey } from './crypto.js';
import { registerWebhooks } from './fub.js';

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
  async fetch(req: Request, env: Env): Promise<Response> {
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
      for (const k of ['avg_gci', 'close_rate', 'window_hours', 'strike_limit', 'strike_window_days', 'per_agent_capacity']) {
        const v = Number(body[k]);
        if (body[k] != null && Number.isFinite(v)) patch[k] = v;
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
      try {
        return json({ ok: true, synced: await syncTeam(env, database, rows[0] as TeamRow, 30) });
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
