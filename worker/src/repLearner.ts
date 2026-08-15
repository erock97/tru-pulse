// One identity for both kinds of learner. An AGENT is an `agents` row linked to
// a login by auth_id (hq_rep_agent.sql); a MEMBER is a leader/admin in
// `memberships`, whose display name lives in `leaders` (provision.ts:63-70).
// rep_progress / rep_assignments / rep_certificates all key on rep_learners.id
// so neither kind is special-cased downstream.
import type { Db } from './db.js';

export type Learner = {
  id: string;
  org_id: string;
  kind: 'agent' | 'member';
  agent_id: string | null;
};

/** Narrow a rep_learners row to exactly the four fields callers may rely on. */
function toLearner(row: any): Learner {
  return {
    id: row.id,
    org_id: row.org_id,
    kind: row.kind,
    agent_id: row.agent_id ?? null,
  };
}

/**
 * Resolve (and lazily create) the rep_learners row for a signed-in user.
 * Agent identity wins when a login is somehow both — an agent taking the course
 * must record progress against their roster row, which is what the leader board
 * reads.
 *
 * `orgHint` picks the org for a user who leads more than one; ignored for agents
 * (an agents row already carries exactly one org_id).
 */
export async function resolveLearner(
  database: Db,
  userId: string,
  orgHint?: string,
): Promise<Learner | null> {
  // ── Agent path ─────────────────────────────────────────────────────────────
  const agents = await database.select('agents', `auth_id=eq.${userId}&select=id,org_id,name,email`);
  if (agents.length) {
    const a = agents[0] as { id: string; org_id: string; name: string; email: string | null };
    const existing = await database.select(
      'rep_learners', `agent_id=eq.${a.id}&select=id,org_id,kind,agent_id`);
    if (existing.length) return toLearner(existing[0]);
    const row = await database.insert('rep_learners', {
      org_id: a.org_id, kind: 'agent', agent_id: a.id, name: a.name, email: a.email,
    });
    return { id: row.id, org_id: a.org_id, kind: 'agent', agent_id: a.id };
  }

  // ── Member path ────────────────────────────────────────────────────────────
  // Ordered so a multi-org leader without an orgHint lands on the same org every
  // call, matching userOrgIds() in auth.ts.
  const memberships = await database.select(
    'memberships', `user_id=eq.${userId}&select=org_id,role&order=org_id`);
  if (!memberships.length) return null;
  const orgId = orgHint && memberships.some((m: any) => m.org_id === orgHint)
    ? orgHint
    : (memberships[0] as { org_id: string }).org_id;

  const existing = await database.select(
    'rep_learners', `user_id=eq.${userId}&org_id=eq.${orgId}&select=id,org_id,kind,agent_id`);
  if (existing.length) return toLearner(existing[0]);

  const leaders = await database.select('leaders', `id=eq.${userId}&select=name,email`);
  const p = (leaders[0] as { name?: string; email?: string } | undefined) ?? {};
  const row = await database.insert('rep_learners', {
    org_id: orgId, kind: 'member', user_id: userId,
    name: p.name ?? p.email ?? 'Team leader', email: p.email ?? null,
  });
  return { id: row.id, org_id: orgId, kind: 'member', agent_id: null };
}
