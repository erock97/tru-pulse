// TRU Agents — the platform-owner routes.
//
// Every path here is mounted INSIDE the existing `/admin/` block in index.ts,
// which has already verified the caller against the admins table. This module
// adds no authentication of its own and must never be mounted anywhere else.
//
// It returns null for anything it does not own, so the existing /admin routes
// fall through untouched.
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import {
  automationById, enabledFor, loadBoard, modeExceedsCeiling, runsFor, typeByKey,
} from './store.js';
import { isMode } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

export interface AutomationCtx {
  userId: string;
  database: Db;
  json: (body: unknown, status?: number) => Response;
}

export async function handleAutomationRoutes(
  req: Request,
  _env: Env,
  url: URL,
  ctx: AutomationCtx,
): Promise<Response | null> {
  const { database, json, userId } = ctx;
  const path = url.pathname;
  if (!path.startsWith('/admin/automations')) return null;

  // ── The shelf ────────────────────────────────────────────────────────────
  if (path === '/admin/automations' && req.method === 'GET') {
    return json(await loadBoard(database));
  }

  // ── Create or update one automation ──────────────────────────────────────
  // Allow-listed field by field, never a blind spread of the body. A request
  // that names a column we did not plan to expose simply does not reach the
  // database — which is why `enabled`, `visible_to_leader` and `sms_live` are
  // absent from this handler entirely. They are not editable over HTTP.
  if (path === '/admin/automations' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as any;
    const id = body?.id ? String(body.id).trim() : null;
    const teamId = String(body?.team_id ?? '').trim();
    const typeKey = String(body?.type_key ?? '').trim();

    if (id && !isUuid(id)) return json({ error: 'invalid id' }, 422);
    if (!id && (!teamId || !typeKey)) return json({ error: 'team_id and type_key required' }, 422);
    if (teamId && !isUuid(teamId)) return json({ error: 'invalid team_id' }, 422);

    const existing = id ? await automationById(database, id) : null;
    if (id && !existing) return json({ error: 'automation not found' }, 404);

    const key = existing?.type_key ?? typeKey;
    const type = await typeByKey(database, key);
    // A type that is not on the shelf cannot be instantiated. This is what keeps
    // the product a menu: there is no request body that invents a new agent.
    if (!type) return json({ error: 'unknown automation type' }, 422);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body?.name !== undefined) patch.name = body.name ? String(body.name).slice(0, 120) : null;
    if (body?.config !== undefined && body.config !== null) {
      if (typeof body.config !== 'object' || Array.isArray(body.config)) {
        return json({ error: 'config must be an object' }, 422);
      }
      patch.config = body.config;
    }
    if (body?.max_per_day !== undefined) {
      const n = Number(body.max_per_day);
      // A cap is a safety rail, so an unreadable one is refused rather than
      // silently defaulted to something permissive.
      if (!Number.isInteger(n) || n < 0 || n > 50) {
        return json({ error: 'max_per_day must be a whole number from 0 to 50' }, 422);
      }
      patch.max_per_day = n;
    }
    if (body?.mode !== undefined) {
      const mode = String(body.mode);
      if (!isMode(mode)) return json({ error: 'invalid mode' }, 422);
      if (modeExceedsCeiling(mode, type)) {
        return json({ error: `${type.label} cannot go beyond "${type.max_mode}"` }, 422);
      }
      patch.mode = mode;
      patch.enabled = enabledFor(mode);
    }

    try {
      if (existing) {
        await database.update('automations', `id=eq.${existing.id}`, patch);
        return json(await automationById(database, existing.id));
      }
      // Born off, always. `mode` and `enabled` are set from the constant below
      // rather than from `patch`, so even a create that asked for full_auto
      // lands inert and has to be switched on deliberately afterwards.
      const teams = await database.select('teams', `id=eq.${teamId}&select=id,org_id`);
      if (!teams.length) return json({ error: 'team not found' }, 404);
      const row = await database.insert('automations', {
        ...patch,
        org_id: (teams[0] as any).org_id,
        team_id: teamId,
        type_key: key,
        mode: 'off',
        enabled: false,
        created_by: userId,
      });
      return json(row);
    } catch (e) {
      // A duplicate (team, type) is a real answer, not a server fault — the
      // console should say "already on the shelf", not "something broke".
      const msg = String(e);
      if (msg.includes('duplicate key') || msg.includes('23505')) {
        return json({ error: 'that agent is already set up for this team' }, 409);
      }
      return json({ error: msg }, 500);
    }
  }

  // ── The switch ───────────────────────────────────────────────────────────
  const modeMatch = path.match(/^\/admin\/automations\/([^/]+)\/mode$/);
  if (modeMatch && req.method === 'POST') {
    const id = modeMatch[1];
    if (!isUuid(id)) return json({ error: 'invalid id' }, 422);
    const body = (await req.json().catch(() => null)) as any;
    const mode = String(body?.mode ?? '');
    if (!isMode(mode)) return json({ error: 'invalid mode' }, 422);

    const row = await automationById(database, id);
    if (!row) return json({ error: 'automation not found' }, 404);
    const type = await typeByKey(database, row.type_key);
    if (!type) return json({ error: 'unknown automation type' }, 422);
    if (modeExceedsCeiling(mode, type)) {
      // The ceiling lives in the database and is raised only by a migration, so
      // this refusal cannot be argued with by a client, however it is called.
      return json({ error: `${type.label} cannot go beyond "${type.max_mode}"` }, 422);
    }

    await database.update('automations', `id=eq.${id}`, {
      mode,
      enabled: enabledFor(mode),
      updated_at: new Date().toISOString(),
    });
    return json({ ok: true, mode, enabled: enabledFor(mode) });
  }

  // ── The log ──────────────────────────────────────────────────────────────
  if (path === '/admin/automations/runs' && req.method === 'GET') {
    const teamId = url.searchParams.get('teamId') ?? undefined;
    const automationId = url.searchParams.get('automationId') ?? undefined;
    if (teamId && !isUuid(teamId)) return json({ error: 'invalid teamId' }, 422);
    if (automationId && !isUuid(automationId)) return json({ error: 'invalid automationId' }, 422);
    return json({
      runs: await runsFor(database, {
        teamId, automationId, limit: Number(url.searchParams.get('limit') ?? 50),
      }),
    });
  }

  // A path under /admin/automations that we do not serve is a 404 from HERE
  // rather than a fall-through, so a typo can never be answered by an unrelated
  // admin route further down index.ts.
  return json({ error: 'not found' }, 404);
}
