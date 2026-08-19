/** The agent's own home, as `agent_home()` returns it and as the browser reads it.
 *  One shape, defined once — the RPC's json, the Worker's reply, and the React
 *  page all speak these types. */

export interface AgentCommitment {
  id: string;
  body: string;
  /** The agent's own "I did this". Distinct from `status`, which is the leader's
   *  verdict at the next 1:1 — see db/hq_agent_experience.sql. */
  agent_done: boolean;
  status: 'done' | 'partial' | 'missed' | null;
  created_at: string;
}

export interface AgentHomeRow {
  agent: { id: string; name: string } | null;
  assessment: { code: string; personal_code: string | null; taken_at: string } | null;
  welcome_seen_at: string | null;
  gated: boolean;
  commitments: AgentCommitment[];
  latest_checkin: string | null;
}

export interface AgentHome extends AgentHomeRow {
  hasEverMet: boolean;
}

/** Normalise the RPC's json into something the browser can render without guarding
 *  every field. Pacing arithmetic is deliberately NOT here — it lives in exactly one
 *  place, web/src/lib/agentPace.ts, so there is never a second answer to the same sum. */
export function shapeAgentHome(row: AgentHomeRow): AgentHome {
  return {
    ...row,
    commitments: row.commitments ?? [],
    hasEverMet: row.latest_checkin != null,
  };
}
