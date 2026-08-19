import type { AgentCommitment } from './api';

export type PaceState = 'none' | 'behind' | 'onTrack' | 'complete';

/**
 * How an agent is tracking against what they committed to.
 *
 * Pacing is measured against the commitments themselves, NOT against FUB. The
 * deals table keys on `agent_name` as free text (db/hq_deals.sql:18), so
 * attaching closings to a person is a name match — too fragile to sit under a
 * number an agent reads every morning. Revisit if deals ever carry an agent id.
 *
 * The one number this function must never invent: with no commitments there is no
 * pace, and saying "0%" would read as failure when it actually means their lead
 * hasn't run a 1:1 yet. That case is `none`, and the UI says so in words.
 */
export function pace(commitments: AgentCommitment[]): {
  done: number; total: number; pct: number; state: PaceState;
} {
  const total = commitments.length;
  const done = commitments.filter((c) => c.agent_done).length;
  if (total === 0) return { done: 0, total: 0, pct: 0, state: 'none' };
  const pct = Math.round((done / total) * 100);
  const state: PaceState = done === total ? 'complete' : pct >= 50 ? 'onTrack' : 'behind';
  return { done, total, pct, state };
}

export const PACE_LABEL: Record<PaceState, string> = {
  none: 'No commitments yet',
  behind: 'Behind',
  onTrack: 'On track',
  complete: 'All done',
};
