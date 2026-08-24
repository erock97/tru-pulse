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

/** Where this agent stands on text messages.
 *
 *  Deliberately carries `last_four` rather than the number itself. This block is
 *  rendered on a home screen that gets shown on a projector at team meetings, and
 *  a full mobile number has no business travelling to the browser to be printed
 *  there — four digits is enough for someone to recognise their own phone. */
export interface AgentSms {
  last_four: string;
  has_phone: boolean;
  consent_at: string | null;
  opt_out_at: string | null;
  /** Set once we have asked, whatever the answer. Null means never asked. */
  prompted_at: string | null;
  /** The database's own verdict on whether we may text them. Never recompute this
   *  in the browser — see agent_sms_reachable() in db/hq_sms_consent.sql. */
  reachable: boolean;
}

export interface AgentHomeRow {
  agent: { id: string; name: string } | null;
  assessment: { code: string; personal_code: string | null; taken_at: string } | null;
  welcome_seen_at: string | null;
  gated: boolean;
  /** Optional on the ROW because it genuinely is: an environment that has not run
   *  db/hq_sms_consent.sql returns an agent_home() json with no `sms` key at all.
   *  It is not optional on the shaped AgentHome below — the browser always gets an
   *  answer, even if that answer is null. */
  sms?: AgentSms | null;
  commitments: AgentCommitment[];
  latest_checkin: string | null;
}

export interface AgentHome extends AgentHomeRow {
  sms: AgentSms | null;
  hasEverMet: boolean;
}

/** Normalise the RPC's json into something the browser can render without guarding
 *  every field. Pacing arithmetic is deliberately NOT here — it lives in exactly one
 *  place, web/src/lib/agentPace.ts, so there is never a second answer to the same sum. */
export function shapeAgentHome(row: AgentHomeRow): AgentHome {
  return {
    ...row,
    commitments: row.commitments ?? [],
    // Null until db/hq_sms_consent.sql has been run — the older agent_home()
    // returns no `sms` key at all. Null is load-bearing rather than tidy: it means
    // "this product does not have SMS yet", and every screen treats it as hide the
    // feature entirely. The alternative, defaulting to a never-asked object, would
    // march every agent into a consent screen whose save RPC does not exist yet.
    sms: row.sms ?? null,
    hasEverMet: row.latest_checkin != null,
  };
}
