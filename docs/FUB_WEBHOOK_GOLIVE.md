# Go-live runbook — FUB → Pulse live sync (webhooks)

The fix that makes Pulse update **within seconds** of a change in Follow Up Boss
(commit `57b5c36`, hardened here) needs the `tru-pulse-sync` worker deployed with a
**dedicated FUB system identity**. Until then, Pulse still syncs every 30 min via
cron — this runbook turns on the instant path.

## Why this was needed
FUB disables a webhook when **two integrations share one system identity**. Pulse's
webhooks were registered under the Terrason dashboard's system (`TerrasonFUBDashboard`),
so FUB kept auto-disabling them. The fix registers Pulse's webhooks under its **own**
FUB system (`TruPulse`) and re-creates them idempotently (deletes any dead webhook on
Pulse's exact callback path first, matched by path prefix so no other integration is
touched). The `/webhook/fub` handler now **acks instantly** and syncs in
`ctx.waitUntil` (targeted `syncPeopleByIds` for `people*` events, full `syncTeam`
otherwise).

## Prerequisites
- A **new FUB system key** issued for a system named **`TruPulse`** (FUB → Admin →
  API/Integrations). This is the value Eric supplies.
- `wrangler` authed to the Cloudflare account (Eric's terminal / this session with
  `--use-system-ca` if TLS interception bites).

## Steps

### 1. Set the two secrets on the worker
```
cd "C:\Users\ericg\Desktop\truhq\pulse\worker"
npx wrangler secret put FUB_SYSTEM_KEY      # paste the new TruPulse key
npx wrangler secret put FUB_SYSTEM_NAME     # value: TruPulse
```
`WEBHOOK_SECRET` must also be set (it authenticates FUB→worker via `?key=`); confirm
with `npx wrangler secret list`. If missing, `wrangler secret put WEBHOOK_SECRET` with
any long random string.

> **Critical:** if `FUB_SYSTEM_NAME` is left unset it falls back to
> `TerrasonFUBDashboard` (`worker/src/fub.ts` `DEFAULT_X_SYSTEM`) — the exact collision
> this fix cures. It **must** read `TruPulse`.

### 2. Deploy the worker
```
npx wrangler deploy
```
(This same deploy also ships the Rep custom-module routes — `/rep/uploads/sign`,
`/rep/media/sign-download`, `/rep/modules` — which need `db/hq_rep_authoring.sql` run first.)

### 3. Re-register webhooks under TruPulse (per team)
Hit the admin connect route for each connected team so webhooks are deleted +
recreated under the new system:
```
POST /admin/connect-fub    (Authorization: Bearer $ADMIN_TOKEN, body: { teamId })
```
or reconnect the team from the admin "Team connections" panel.

### 4. Verify
- `GET /admin/probe-events` (Bearer `ADMIN_TOKEN`) → the returned `webhooks[]` show
  Pulse's callback URL, are **active** (not disabled), and belong to the new system.
- Move a person's stage in FUB → the lead updates in Pulse within seconds.
- `npx wrangler tail` shows the webhook hit with `mode=targeted` for a `people*` event.

## Rollback
Removing/rotating `FUB_SYSTEM_KEY` reverts webhook creation to a no-op (the code gates
all webhook calls behind `if (env.FUB_SYSTEM_KEY)`); the 30-min cron sync keeps Pulse
current in the meantime. No data is affected.
