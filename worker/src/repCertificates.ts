// A certificate is issued the moment the last REQUIRED module of a track passes.
//
// Completion is decided by buildTrackViews — the same pure function the shelf and
// the leader board use — so a learner can never see 100% on their shelf without
// the certificate that follows from it.
import type { Db } from './db.js';
import type { Learner } from './repLearner.js';
import { buildTrackViews } from '../../shared/repLibrary.js';
import type { TrackRow, TrackModuleRow, ProgressRow, AssignmentRow } from '../../shared/repLibrary.js';

/** Issue a certificate for every track this learner has just completed. Idempotent. */
export async function maybeIssueCertificates(database: Db, learner: Learner): Promise<string[]> {
  const [tracks, trackModules, progress, existing, assignments] = await Promise.all([
    database.select('rep_tracks', 'select=id,slug,title,subtitle,cover,order_idx&active=eq.true'),
    database.select('rep_track_modules', 'select=track_id,module_id,idx,required'),
    database.select('rep_progress', `learner_id=eq.${learner.id}&select=module_id,status,score,passed_at`),
    database.select('rep_certificates', `learner_id=eq.${learner.id}&select=track_id`),
    database.select('rep_assignments', `learner_id=eq.${learner.id}&select=track_id,due_at,completed_at`),
  ]);
  const already = new Set((existing as Array<{ track_id: string }>).map((c) => c.track_id));
  const views = buildTrackViews(
    tracks as TrackRow[], trackModules as TrackModuleRow[],
    progress as ProgressRow[], assignments as AssignmentRow[], new Date(),
  );
  const fresh = views.filter((v) => v.complete && !already.has(v.id));
  if (!fresh.length) return [];

  const now = new Date().toISOString();
  // ignoreDuplicates: two tabs finishing the same module at once must not race
  // into two certificates, and the unique index means the loser is a no-op.
  await database.upsert(
    'rep_certificates',
    fresh.map((v) => ({ org_id: learner.org_id, learner_id: learner.id, track_id: v.id, issued_at: now })),
    'learner_id,track_id',
    { ignoreDuplicates: true },
  );
  for (const v of fresh.filter((x) => x.assigned)) {
    await database.update(
      'rep_assignments',
      `learner_id=eq.${learner.id}&track_id=eq.${v.id}`,
      { completed_at: now },
    );
  }
  return fresh.map((v) => v.id);
}
