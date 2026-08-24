// Shared shapes for TRU Agents. Kept in one file so the routes, the store and
// (later) the runner can never drift on what a mode is or what it permits.

/**
 * How autonomous one automation is allowed to be. The ORDER of this array is
 * load-bearing — MODE_RANK below is derived from it, and every ceiling check in
 * the product is a comparison of two ranks.
 *
 *   off         — inert. The runner does not select it at all.
 *   notify_only — it runs and records what it WOULD do, and sends nothing.
 *   ask_first   — it proposes; a human approves before anything reaches anyone.
 *   full_auto   — it acts.
 */
export const MODES = ['off', 'notify_only', 'ask_first', 'full_auto'] as const;
export type Mode = (typeof MODES)[number];

export const MODE_RANK: Record<Mode, number> = Object.fromEntries(
  MODES.map((m, i) => [m, i]),
) as Record<Mode, number>;

export const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);

/**
 * The plain-English label a platform owner sees. The four internal modes are
 * the OWNER's controls; a team lead, if ever given this screen, sees only a
 * switch and a "check with me first" toggle. Keeping the wording here means the
 * two audiences can never drift apart in the UI.
 */
export const MODE_LABEL: Record<Mode, string> = {
  off: 'Off',
  notify_only: 'Watch only',
  ask_first: 'Ask me first',
  full_auto: 'On',
};

/** One agent on the shelf. Seeded by SQL; no route ever writes this table. */
export interface AutomationType {
  key: string;
  label: string;
  blurb: string;
  trigger_kind: 'schedule' | 'event';
  max_mode: Mode;
  channels: string[];
  capability: string | null;
  leader_visible: boolean;
  active: boolean;
}

/** One agent switched on for one team. */
export interface AutomationRow {
  id: string;
  org_id: string;
  team_id: string;
  type_key: string;
  name: string | null;
  mode: Mode;
  enabled: boolean;
  config: Record<string, unknown>;
  max_per_day: number;
  sms_live: boolean;
  visible_to_leader: boolean;
  leader_editable: boolean;
  updated_at: string;
  /** Never the numbers themselves — see redactRecipient in store.ts. */
  hasRecipient: boolean;
  recipientMasked: string | null;
}

export interface TeamSummary {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  timezone: string;
  /** Capability keys granted to this team, unexpired. Read-only here. */
  capabilities: string[];
  last_sync_at: string | null;
}

export interface AutomationRun {
  id: string;
  team_id: string;
  automation_id: string | null;
  type_key: string;
  trigger: string;
  mode: string;
  status: string;
  actions_proposed: number;
  actions_executed: number;
  summary: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AutomationBoard {
  types: AutomationType[];
  teams: TeamSummary[];
  automations: AutomationRow[];
  flags: { automation_enabled: boolean; automation_live_sends: boolean };
}
