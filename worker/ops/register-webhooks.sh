#!/usr/bin/env bash
#
# Re-register every active team's Follow Up Boss webhooks against the current
# Worker address.
#
# WHEN YOU NEED THIS
#   - a team's live updates have stopped (a hook FUB disabled never recovers)
#   - the Worker moves to a new address (e.g. workers.dev -> api.truhq.co)
#   - the webhook signing/token scheme changes
#
# WHAT IT DOES
#   For each active team, asks the Worker to delete the existing hooks on our own
#   callback path and create five fresh ones. Recreating rather than updating is
#   deliberate: FUB matches by path and permanently disables a hook that ever
#   failed, so re-adding the same path can silently leave a dead one in place.
#
# WHAT IT DOES NOT DO
#   It syncs nothing and writes nothing to Pulse's tables. Webhooks are only
#   notification subscriptions — no lead, note or contact is touched. Worst case is
#   a sub-second window where a change isn't announced instantly, and the 30-minute
#   cron covers every active team regardless, so nothing is ever lost.
#
# USAGE
#   bash worker/ops/register-webhooks.sh
#   WORKER_URL=https://api.truhq.co bash worker/ops/register-webhooks.sh
#
# The ops token is read from worker/.secrets.local at runtime and never printed.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETS="$REPO_ROOT/worker/.secrets.local"
WORKER="${WORKER_URL:-https://tru-pulse-sync.eric-b3c.workers.dev}"

if [ ! -f "$SECRETS" ]; then
  echo "Can't find $SECRETS — run this from a checkout that has your local secrets."
  exit 1
fi

# Handles either NAME=value (quoted or not) or a JSON "NAME": "value".
TOKEN="$(sed -n 's/.*ADMIN_TOKEN["'"'"']*[:=][[:space:]]*["'"'"']*\([^"'"'"',[:space:]]*\).*/\1/p' "$SECRETS" | head -1)"
if [ -z "$TOKEN" ]; then
  echo "Found $SECRETS but couldn't read ADMIN_TOKEN out of it."
  echo "Tell Claude the file's format — do NOT paste the value."
  exit 1
fi

echo "Worker: $WORKER"
echo "Fetching active teams…"
TEAMS_JSON="$(curl -s -H "x-admin-token: $TOKEN" "$WORKER/teams")"

if echo "$TEAMS_JSON" | grep -q '"error"'; then
  echo "The Worker refused the token: $TEAMS_JSON"
  exit 1
fi

IDS="$(echo "$TEAMS_JSON" | grep -oE '"id":"[^"]+"' | cut -d'"' -f4)"
COUNT="$(echo "$IDS" | grep -c . || true)"
if [ "$COUNT" -eq 0 ]; then
  echo "No active teams came back. Raw response:"
  echo "$TEAMS_JSON"
  exit 1
fi

echo "Found $COUNT active team(s)."
echo

FAILED=0
for ID in $IDS; do
  NAME="$(echo "$TEAMS_JSON" | tr '}' '\n' | grep -F "$ID" \
    | grep -oE '"name":"[^"]*"' | cut -d'"' -f4 | head -1)"
  RESP="$(curl -s -X POST -H "x-admin-token: $TOKEN" "$WORKER/webhook/register?teamId=$ID")"

  CREATED="$(echo "$RESP" | grep -oE '"event":"(peopleCreated|peopleUpdated|peopleStageUpdated|callsCreated|textMessagesCreated)","status":2[0-9][0-9]' | grep -c . || true)"
  BAD="$(echo "$RESP" | grep -oE '"status":[45][0-9][0-9]' | grep -c . || true)"

  if [ "$CREATED" -gt 0 ] && [ "$BAD" -eq 0 ]; then
    printf '%-38s ✅ live updates on (%s hooks)\n' "${NAME:-$ID}" "$CREATED"
  else
    printf '%-38s ⚠️  needs a look\n' "${NAME:-$ID}"
    echo "     $RESP"
    FAILED=$((FAILED + 1))
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Done — every team re-registered. Nothing was synced and no tracked data was written."
else
  echo "Done with $FAILED team(s) needing attention. Those fall back to the 30-minute"
  echo "cron, so no data is lost — they just aren't instant until fixed."
  exit 1
fi
