export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;  // bypasses RLS — server-side only
  SUPABASE_ANON_KEY: string;          // used to validate a caller's user token
  FUB_ENC_KEY: string;                // base64 of a 32-byte AES-GCM key
  ADMIN_TOKEN: string;                // guards ops routes (manual provision / sync-all)
  RESEND_API_KEY?: string;            // weekly Leadership Brief email (optional until set)
  BRIEF_FROM?: string;                // e.g. "TRU Pulse <pulse@trucoaching.co>"
  WEBHOOK_SECRET?: string;            // shared secret in the FUB webhook callback URL (?key=)
  FUB_SYSTEM_KEY?: string;            // FUB system key (X-System-Key) — required to create webhooks
  // TRU Rep — Live Sim (practice calls). Optional until configured.
  RETELL_API_KEY?: string;            // Retell account (shared with voice-isa)
  RETELL_AGENT_ID?: string;           // the practice-buyer agent (created by db/setup_practice_agent.mjs)
  ANTHROPIC_API_KEY?: string;         // ALMS grading of practice transcripts
}
