# TRU Pulse — going live

Pulse gets its **own** Supabase project (separate from the Coaching app, so nothing
collides). Your part is ~5 minutes in the Supabase dashboard; I do the rest.

## Your part — Supabase (create the project + hand me 3 values)

1. **Supabase → New project.** Name it `TRU-Pulse`, region `us-west-2` (or nearest),
   set a database password (save it somewhere). Upgrade the org if it prompts you.
2. **SQL Editor → New query →** paste the entire contents of [`db/schema.sql`](db/schema.sql)
   → **Run.** That creates every Pulse table + RLS in one shot.
3. *(optional)* **Authentication → Providers →** enable **Google** if you want Google
   sign-in. Email/password works without this.
4. **Project Settings → API →** copy me these three:
   - **Project URL** (e.g. `https://xxxx.supabase.co`)
   - **anon public** key
   - **service_role** key  (secret — this one lets the Worker bypass RLS)

## My part — once I have those 3 values

- **Worker:** set secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
  plus the `FUB_ENC_KEY` + `ADMIN_TOKEN` already generated in `worker/.secrets.local`)
  and `wrangler deploy`. Gives us the sync endpoint + the crons (sync 30 min, reconcile
  daily, Brief weekly).
- **Web:** build with the real env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_WORKER_URL`) and deploy to Cloudflare Pages.
- **Prove it:** provision a tenant with one of your real FUB keys (read-only), run a
  sync, and you log into the dashboard on **live data** — the real thing, not `?demo=1`.

## Notes
- The `service_role` key is powerful (bypasses RLS). It only ever lives as a Worker
  secret, never in the browser or in git.
- Google sign-in also needs the Google OAuth client configured in Supabase; skip it for
  the first login test and use email/password.
