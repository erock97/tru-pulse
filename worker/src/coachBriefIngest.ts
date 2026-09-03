// POST /coach/weekly-report — the ONE door the Hermes laptop automation sends
// its weekly coaching brief through. Its own dedicated secret (COACH_INGEST_TOKEN,
// never ADMIN_TOKEN): a leaked report key can submit coaching reports and nothing
// else. Everything downstream — storage, publishing policy, the Coach tab — lives
// on this side; the laptop's only job is one authenticated send, retried freely,
// because run_id makes the write idempotent.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
import { absorbReport } from './coachPatterns.js';
import { briefStatusFor, matchAgents, validateCoachBrief } from '../../shared/coachBrief.js';
import type { CoachBrief } from '../../shared/coachBrief.js';

const MAX_BODY_BYTES = 4_000_000;
// The slug goes into a PostgREST filter, so its shape is validated first — same
// defense-in-depth as UUID_RE on the data routes. A TrueHQ team UUID matches this
// too (it's a lowercase, dashed, alphanumeric string), so the same gate covers both.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Permanent friendly aliases for teams whose TrueHQ UUID is the canonical identifier.
// New onboarding should prefer sending the UUID directly (see GET /coach/teams);
// an alias here is for readability and to give an existing desktop config a stable
// human name. Never point one at a team by name-matching — only by its real UUID,
// confirmed against TrueHQ, so a same-named duplicate can never be selected.
const TEAM_ALIASES: Record<string, string> = {
  'the-synergy-group-nj': '213f7da9-6c3d-425e-86e6-a32d16db32a3',
  'sb-realty': 'df216d4d-b05e-4ddf-a84e-0d685182d692',
};

interface TeamRow { id: string; org_id: string }

async function fetchTeamById(database: Db, id: string): Promise<TeamRow | null> {
  const rows = await database.select('teams', `select=id,org_id&id=eq.${id}&limit=1`);
  return (rows[0] as TeamRow | undefined) ?? null;
}

/** identifier is whatever run.teamId carried: a TrueHQ team UUID (preferred for new
 *  teams), one of TEAM_ALIASES, or a legacy report_slug. UUID and alias both resolve
 *  straight to a team id, so neither can drift onto a different team sharing a name. */
async function resolveTeam(database: Db, identifier: string): Promise<TeamRow | null> {
  if (UUID_RE.test(identifier)) return fetchTeamById(database, identifier);
  const aliasedId = TEAM_ALIASES[identifier];
  if (aliasedId) return fetchTeamById(database, aliasedId);
  const rows = await database.select('teams', `select=id,org_id&report_slug=eq.${identifier}&limit=1`);
  return (rows[0] as TeamRow | undefined) ?? null;
}

async function teamRoster(database: Db, teamId: string): Promise<Array<{ id: string; name: string }>> {
  return database.select('agents', `select=id,name&team_id=eq.${teamId}&excluded=eq.false`);
}

/** A report that arrived before its team was set up sits with team_id null.
 *  Every successful ingest gives those rows another chance, so setting a team's
 *  report_slug is all it takes for its held reports to publish — no re-send. */
async function republishHeldReports(database: Db): Promise<void> {
  const held = await database.select(
    'coach_weekly_reports',
    'select=id,team_slug,run_trigger,payload&team_id=is.null&order=received_at.asc&limit=20',
  ) as Array<{ id: string; team_slug: string; run_trigger: string; payload: CoachBrief }>;
  const teamBySlug = new Map<string, TeamRow | null>();
  for (const row of held) {
    if (!SLUG_RE.test(row.team_slug)) continue;
    if (!teamBySlug.has(row.team_slug)) {
      teamBySlug.set(row.team_slug, await resolveTeam(database, row.team_slug));
    }
    const team = teamBySlug.get(row.team_slug);
    if (!team) continue;
    const roster = await teamRoster(database, team.id);
    const m = matchAgents((row.payload.agents ?? []).map((a) => a.agentName), roster);
    await database.update('coach_weekly_reports', `id=eq.${row.id}`, {
      org_id: team.org_id,
      team_id: team.id,
      status: briefStatusFor(row.run_trigger, true),
      agent_links: m.links,
    });
  }
}

export async function handleCoachBriefIngest(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  database: Db,
): Promise<Response | null> {
  if (url.pathname !== '/coach/weekly-report') return null;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors },
  });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Fail closed: an unset COACH_INGEST_TOKEN must never make ingest public.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.COACH_INGEST_TOKEN || !secretsMatch(token, env.COACH_INGEST_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 4xx on anything malformed, so the laptop's retry loop stops rather than spins.
    return json({ error: 'body is not valid JSON' }, 422);
  }
  const v = validateCoachBrief(parsed);
  if (!v.ok) return json({ error: 'invalid payload', details: v.errors }, 422);
  const brief = v.brief;

  const slug = brief.run.teamId.toLowerCase();
  if (!SLUG_RE.test(slug)) return json({ error: 'run.teamId must be a simple slug (letters, digits, dashes)' }, 422);

  // Unknown slug is NOT an error: the report is stored and held, and publishes on
  // its own once the team exists with this report_slug (see republishHeldReports).
  const team = await resolveTeam(database, slug);
  let links: Record<string, string> = {};
  let agentsReport = { matched: [] as string[], unmatched: [] as string[], ambiguous: [] as string[] };
  if (team) {
    const roster = await teamRoster(database, team.id);
    const m = matchAgents(brief.agents.map((a) => a.agentName), roster);
    links = m.links;
    agentsReport = { matched: m.matched, unmatched: m.unmatched, ambiguous: m.ambiguous };
  }

  const status = briefStatusFor(brief.run.trigger, team !== null);
  await database.upsert('coach_weekly_reports', [{
    run_id: brief.run.runId,
    org_id: team?.org_id ?? null,
    team_id: team?.id ?? null,
    team_slug: slug,
    run_trigger: brief.run.trigger,
    status,
    week_start: brief.run.startDate,
    week_end: brief.run.endDate,
    generated_at: brief.run.generatedAt ?? null,
    payload: brief,
    agent_links: links,
  }], 'run_id');

  // Rules 3-10: fold an ACCEPTED report into the ninety-day view. Only on
  // publish — rule 6 turns on the difference between accepted and merely
  // received, and a held report advancing the window would have the app claim a
  // freshness it does not have.
  //
  // Wrapped so it can never fail the ingest: the report itself is already
  // stored, and losing the delivery over a rollup would cost the raw evidence
  // as well. A failure here is recoverable by replay; a rejected delivery is
  // not, because the laptop moves on.
  if (team && status === 'published') {
    try {
      const absorbed = await absorbReport(database, team, brief, links);
      console.log(`coach patterns ${slug}:`, JSON.stringify(absorbed));
    } catch (e) {
      console.error(`absorbReport failed for ${slug}:`, e);
    }
  }

  // Give earlier held reports their second chance — never let it fail the send.
  try {
    await republishHeldReports(database);
  } catch (e) {
    console.error('republishHeldReports failed:', e);
  }

  // The laptop logs this response: whether the team resolved, what published, and
  // exactly which agent names didn't match — the visible trail for name drift.
  return json({
    ok: true,
    runId: brief.run.runId,
    status,
    teamResolved: team !== null,
    agents: agentsReport,
  });
}

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
