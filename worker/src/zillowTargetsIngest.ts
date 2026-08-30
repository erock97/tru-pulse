// POST /zillow/targets — the ONE door the fub-weekly-reports scraper sends its
// per-team Zillow target/pacing numbers through. Its own dedicated secret
// (ZILLOW_TARGETS_INGEST_TOKEN, never ADMIN_TOKEN or COACH_INGEST_TOKEN): a
// leaked key here can submit target numbers and nothing else. Only the
// admins-gated dashboard ever reads what lands here — see GET /admin/targets.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { secretsMatch } from './crypto.js';
import { validateZillowTargets } from '../../shared/zillowTargets.js';

const MAX_BODY_BYTES = 200_000;

interface TeamRow { id: string }

async function resolveTeam(database: Db, slug: string): Promise<TeamRow | null> {
  const rows = await database.select('teams', `select=id&zillow_team_slug=eq.${slug}&limit=1`);
  return (rows[0] as TeamRow | undefined) ?? null;
}

export async function handleZillowTargetsIngest(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  database: Db,
): Promise<Response | null> {
  if (url.pathname !== '/zillow/targets') return null;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors },
  });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Fail closed: an unset ZILLOW_TARGETS_INGEST_TOKEN must never make ingest public.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.ZILLOW_TARGETS_INGEST_TOKEN || !secretsMatch(token, env.ZILLOW_TARGETS_INGEST_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 4xx on anything malformed, so the scraper's retry loop stops rather than spins.
    return json({ error: 'body is not valid JSON' }, 422);
  }
  const v = validateZillowTargets(parsed);
  if (!v.ok) return json({ error: 'invalid payload', details: v.errors }, 422);
  const push = v.push;

  const slug = push.teamSlug.toLowerCase();
  const team = await resolveTeam(database, slug);
  // Unlike coach briefs, an unresolved team is not held for later — with only
  // a handful of Zillow teams, the slug is seeded ahead of time (see
  // db/hq_zillow_targets.sql), so an unknown slug here means the scraper and
  // the database have drifted and should surface as an error immediately.
  if (!team) return json({ error: `unknown teamSlug "${slug}" — not mapped in teams.zillow_team_slug` }, 422);

  const snapshotRows = push.metrics.map((m) => ({
    team_id: team.id,
    metric: m.metric,
    target_value: m.targetValue,
    actual_value: m.actualValue,
    unit: m.unit,
    period_label: m.periodLabel ?? null,
    period_start: m.periodStart ?? null,
    period_end: m.periodEnd ?? null,
    source_refresh_date: push.sourceRefreshDate ?? null,
    captured_at: push.capturedAt,
    raw: m,
    updated_at: new Date().toISOString(),
  }));
  const historyRows = push.metrics.map((m) => ({
    team_id: team.id,
    metric: m.metric,
    captured_at: push.capturedAt,
    target_value: m.targetValue,
    actual_value: m.actualValue,
    unit: m.unit,
    period_label: m.periodLabel ?? null,
    period_start: m.periodStart ?? null,
    period_end: m.periodEnd ?? null,
    raw: m,
  }));

  await database.upsert('zillow_targets_snapshot', snapshotRows, 'team_id,metric');
  // Idempotent on retries: the same (team_id, metric, captured_at) triple
  // just overwrites itself rather than creating a duplicate history row.
  await database.upsert('zillow_targets_history', historyRows, 'team_id,metric,captured_at', { ignoreDuplicates: true });

  return json({ ok: true, teamId: team.id, metrics: push.metrics.map((m) => m.metric) });
}
