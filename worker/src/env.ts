export interface Env {
  SESSIONS: KVNamespace;              // server-side login sessions; see wrangler.toml
  AUTH_COOKIE_DOMAIN?: string;        // defaults to host-only on api.truhq.co
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;  // bypasses RLS — server-side only
  SUPABASE_ANON_KEY: string;          // used to validate a caller's user token
  FUB_ENC_KEY: string;                // base64 of a 32-byte AES-GCM key
  ADMIN_TOKEN: string;                // guards ops routes (manual provision / sync-all)
  RESEND_API_KEY?: string;            // Resend — shared by the brief and invite mail
  BRIEF_FROM?: string;                // weekly Leadership Brief sender, e.g. "TRU Pulse <pulse@truhq.co>"
  INVITE_FROM?: string;               // leader set-password invites, e.g. "TRU HQ <hq@truhq.co>"
  APPLY_NOTIFY_TO?: string;           // comma-separated recipients for truhq.co/apply submissions
  WEBHOOK_SECRET?: string;            // master secret; each team's callback URL carries a
                                      // DERIVED per-team token, never this value itself
  WEBHOOK_REQUIRE_SIGNATURE?: string; // '1' → reject webhooks whose FUB-Signature doesn't
                                      // verify. Roll out log-only first (see /webhook/fub).
  FUB_SYSTEM_KEY?: string;            // FUB system key (X-System-Key) — required to create webhooks
  FUB_SYSTEM_NAME?: string;           // FUB system name (X-System) — defaults to 'TerrasonFUBDashboard' when unset
  // TRU Rep — Live Sim (practice calls). Optional until configured.
  RETELL_API_KEY?: string;            // Retell account (shared with voice-isa)
  RETELL_AGENT_ID?: string;           // the practice-buyer agent (created by db/setup_practice_agent.mjs)
  ANTHROPIC_API_KEY?: string;         // ALMS grading of practice transcripts
}
