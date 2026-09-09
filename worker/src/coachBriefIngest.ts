import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
export { handleReportReceipts as handleCoachBriefIngest } from './reportReceipts.js';

/** GET /coach/teams — lets desktop-side onboarding look up a team's TrueHQ UUID
 *  without touching the database directly. Same door, same secret as the report
 *  ingest: COACH_INGEST_TOKEN is the reporting/integration credential, deliberately
 *  not ADMIN_TOKEN, so this stays scoped to reporting setup and nothing else. Only
 *  the fields an onboarding flow needs — never FUB keys, tokens, or user emails. */
export async function handleCoachTeamsList(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  database: Db,
): Promise<Response | null> {
  if (url.pathname !== '/coach/teams') return null;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors },
  });
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.COACH_INGEST_TOKEN || !secretsMatch(token, env.COACH_INGEST_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const teams = await database.select('teams', 'select=id,name&is_active=eq.true&order=name.asc') as
    Array<{ id: string; name: string }>;
  // fub_connections rows are the only signal this database has for "FUB is connected";
  // it is known to lag behind TrueHQ (a team can be connected there before a row lands
  // here), so treat `connected: false` as "not confirmed," not "definitely not connected."
  const connections = await database.select('fub_connections', 'select=team_id') as Array<{ team_id: string }>;
  const connectedIds = new Set(connections.map((c) => c.team_id));

  return json({
    teams: teams.map((t) => ({ teamId: t.id, name: t.name, connected: connectedIds.has(t.id) })),
  });
}
