# Go-live runbook — interior redesign

Local `main` is fast-forwarded to the full redesign (`7760bf9`); `origin/main` is still
`a336aa3` (nothing deployed). Order below is **backend → frontend → verify**. Claude's
environment has no network to Cloudflare/Supabase, so steps 1–2 + verify are run by Eric
from his own terminal/dashboards (wrangler is authed there).

## What's actually new vs current prod
The coach/rep/prospect tables were already committed to `main` before this redesign, so
they're almost certainly already live. The genuinely-new backend is:
- `db/hq_stage_log.sql` — new table (now idempotent/non-destructive).
- `worker/` — adds `/admin/connections` + `/admin/connect-fub` (admin-only "Team
  connections" panel) and stage-log sync.

The frontend degrades gracefully: if the worker/migration lag, Coach still works (tables
exist), Pulse/Rep/Home work; only the admin "Team connections" panel and freshest
stage-log accuracy wait for the worker. No crashes.

## 1. Migration (Supabase — Eric)
Dashboard → project `yeyoteredgunhvhqmais` → SQL Editor → New query → paste the contents of
`db/hq_stage_log.sql` → Run. Safe (idempotent). Only re-run the coach/rep SQL if those tabs
error after deploy.

## 2. Worker (Eric's terminal — wrangler authed there)
```
cd "C:\Users\ericg\Desktop\truhq\pulse\worker"
npx wrangler deploy
```

## 3. Frontend
Local `main` already has the redesign merged. Push it (Claude can do this from here on your
go-ahead, or you run it):
```
cd "C:\Users\ericg\Desktop\truhq\pulse"
git push origin main
```
→ Cloudflare Pages rebuilds from `main` → app.truhq.co live.
If Pages is NOT GitHub-connected, deploy the build directly instead:
```
cd "C:\Users\ericg\Desktop\truhq\pulse\web"
npm run build
npx wrangler pages deploy dist
```

## 4. Verify (Eric)
- app.truhq.co → sign in → confirm the dark redesign across Home / Pulse / Coach / Rep.
- Walk the auth screens (sign out → Login) — the obsidian video backdrop.
- Platform owner: check the "Team connections" panel (needs step 2 done).

## Rollback
- Frontend: redeploy the previous build from the Cloudflare Pages dashboard (one click), or
  `git revert` + push.
- Migration: non-destructive — nothing to undo.
