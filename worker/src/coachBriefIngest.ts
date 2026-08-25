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
// defense-in-depth as UUID_RE on the data routes.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

interface TeamRow { id: string; org_id: string }

async function resolveTeam(database: Db, slug: string): Promise<TeamRow | null> {
  const rows = await database.select('teams', `select=id,org_id&report_slug=eq.${slug}&limit=1`);
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
