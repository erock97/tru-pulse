export interface Env {
  SESSIONS: KVNamespace;              // server-side login sessions; see wrangler.toml.
                                      // Also holds contract:draft:* (prepared contract
                                      // drafts, 30-day TTL) and prl:* (public rate limits).
  CONTRACT_APPROVALS: DurableObjectNamespace; // one-time contract approval tokens
                                      // (ContractApprovalLedger) — send/void stay locked
                                      // without it
  AUTH_COOKIE_DOMAIN?: string;        // defaults to host-only on api.truhq.co
  APP_ORIGIN?: string;                // where OAuth returns the user; defaults to app.truhq.co
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;  // bypasses RLS — server-side only
  SUPABASE_ANON_KEY: string;          // used to validate a caller's user token
  FUB_ENC_KEY: string;                // base64 of a 32-byte AES-GCM key
  ADMIN_TOKEN: string;                // guards ops routes (manual provision / sync-all)
  COACH_INGEST_TOKEN?: string;        // guards POST /coach/weekly-report (the Hermes
                                      // laptop's brief sends) — deliberately NOT
                                      // ADMIN_TOKEN so a leaked report key can submit
                                      // coaching reports and nothing else
  ZILLOW_TARGETS_INGEST_TOKEN?: string; // guards POST /zillow/targets (the
                                      // fub-weekly-reports scraper's target/pacing
                                      // pushes) — its own secret, same reasoning as
                                      // COACH_INGEST_TOKEN
  RELAY_TOKEN?: string;               // guards /relay/queue + /relay/ack — the phone
                                      // relay's own key. Deliberately NOT ADMIN_TOKEN:
                                      // it lives in a Tasker profile and travels in a
                                      // query string, so it must buy the day's briefs
                                      // and nothing else. Unset = the relay is closed.
  RESEND_API_KEY?: string;            // Resend — shared by the brief and invite mail
  STRIPE_SECRET_KEY?: string;         // Stripe fallback ONLY — the real key is read from
                                      // Infisical at /Stripe (see stripeClient.ts). Unset
                                      // is normal when Infisical is configured.
  GOOGLE_CAL_CLIENT_ID?: string;      // "Link your calendar" OAuth client — the flow
  GOOGLE_CAL_CLIENT_SECRET?: string;  // stays dark until both are set AND
                                      // https://api.truhq.co/calendar-link/callback is
                                      // registered on that client in the Google console
  INFISICAL_SITE_URL?: string;        // non-secret; defaults to app.infisical.com
  INFISICAL_CLIENT_ID?: string;       // Universal Auth machine identity — same identity
  INFISICAL_CLIENT_SECRET?: string;   // TRU OS's worker uses; read-only on the vault
  INFISICAL_PROJECT_ID?: string;
  INFISICAL_ENV?: string;             // non-secret; defaults to 'prod'
  // TruSign (Contracts) — all optional as env vars: each resolves via
  // Infisical (/TruSign, /Contracts) when unset, so normally NONE of these
  // need to be worker secrets.
  TRUSIGN_SUPABASE_URL?: string;      // TruSign's OWN Supabase project ref
  TRUSIGN_SUPABASE_SERVICE_KEY?: string; // service_role, used SELECT-only (RLS trap: anon reads as zero rows)
  TRUSIGN_SUPABASE_ANON_KEY?: string; // fallback only — triggers the honest not-connected path
  TRUSIGN_JARVIS_M2M_KEY?: string;    // the single write credential, sent as X-Jarvis-Key
  TRUSIGN_APP_URL?: string;           // non-secret; defaults to https://trusign.pages.dev
  ERIC_SIGNING_EMAILS?: string;       // comma list; drives the "waiting on you" flag
  MONEY_FROM?: string;                // broker verification + invoice-copy sender, e.g.
                                      // "Terrason Consulting <billing@truhq.co>". MUST be
                                      // @truhq.co (Resend's only verified domain — anything
                                      // else is rejected silently). Falls back to BRIEF_FROM.
  BRIEF_FROM?: string;                // weekly Leadership Brief sender, e.g. "TRU Pulse <pulse@truhq.co>"
  INVITE_FROM?: string;               // leader set-password invites, e.g. "TRU HQ <hq@truhq.co>"
  APPLY_NOTIFY_TO?: string;           // comma-separated recipients for truhq.co/apply submissions
  WEBHOOK_SECRET?: string;            // master secret; each team's callback URL carries a
                                      // DERIVED per-team token, never this value itself
  WEBHOOK_REQUIRE_SIGNATURE?: string; // '1' → reject webhooks whose FUB-Signature doesn't
                                      // verify. Roll out log-only first (see /webhook/fub).
  /** '1' stops every automation at send time, without touching the database.
   *  The backstop for when Postgres itself is the problem. */
  AUTOMATION_KILL?: string;
  FUB_SYSTEM_KEY?: string;            // FUB system key (X-System-Key) — required to create webhooks
  FUB_SYSTEM_NAME?: string;           // FUB system name (X-System) — defaults to 'TerrasonFUBDashboard' when unset
  // TRU Rep — Live Sim (practice calls). Optional until configured.
  RETELL_API_KEY?: string;            // Retell account (shared with voice-isa)
  RETELL_AGENT_ID?: string;           // the practice-buyer agent (created by db/setup_practice_agent.mjs)
  ANTHROPIC_API_KEY?: string;         // ALMS grading of practice transcripts
}
