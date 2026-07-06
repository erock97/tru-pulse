# Feature spec — "What to do today": persistent pause confirmation

**Status:** deferred feature block (approved by Eric). The *presentational* reframe shipped
in the Pulse redesign (Block 4): the tab is renamed "What to do today", the pause-watch
list is reframed as "Recommended pauses", and each flagged agent has a **"Pause in Zillow ↗"**
deep link (`https://premieragent.zillow.com/leads/routing/routing`, new tab). This spec
covers the ONE remaining piece, which needs backend and so was kept out of the redesign.

## Goal
Give the team lead a **manual "confirm paused" checkbox** per recommended agent whose state
**persists and is shared** — survives refresh, and co-leads/admins see the same thing. So
once a leader has actually paused someone in Zillow and ticks the box, the board stops
re-nagging about that agent, and everyone knows it's handled.

## What already exists (no new logic needed)
- Pause flag engine: the two broker rules in Settings — **capacity** (`pause_volume_leads`,
  default 20 leads/month) and **no-close** (`pause_no_close_leads`, default 30 leads since
  last under-contract). Computed in `Dashboard.tsx` as `pausedByAgent`.
- The reframed UI + the Zillow deep link (shipped).

## What this feature adds (backend — handle with data-safety care)
This crosses the redesign's front-end-only guardrail on purpose; it touches `worker/` + `db/`.

- **DB** (new, org-scoped, RLS): e.g. `agent_pause_confirmations`
  `(org_id, team_id, agent_ref, paused bool, confirmed_by, confirmed_at, reason_snapshot, updated_at)`.
  RLS: a team lead/admin can read+write only their own org's rows (mirror existing
  org-scoped policies). Never expose cross-org.
- **Worker**: `POST /pulse/pause-confirm` (set/clear a confirmation) and include current
  confirmations in the dashboard load (or a `GET`). Writes go through the worker/service
  role like `saveSettings` already does — the browser stays read-only for writes.
- **Frontend**: the checkbox in each "Recommended pauses" row; optimistic toggle → worker
  write; persisted `paused=true` renders the row as **"Confirmed paused"** (distinct from
  "Recommended") and optionally drops it from the "Need you this week" triage until its
  reason clears.
- **Demo mode**: `?demo=1` returns a canned confirmations set; never hits Supabase.

## Open questions to resolve at build time
- **Agent identity key** — the flag map keys on agent *name* today; confirmations should key
  on a stable agent **id** (join to the `agents` table) to survive renames.
- **Un-pause / lifecycle** — does a confirmation auto-clear when the reason resolves (month
  rolls over / an under-contract lands), or only on manual untick? Recommend auto-clear +
  manual override.
- **Who can confirm** — team lead + admin only; record `confirmed_by` for an audit trail.
- **Zillow link** — generic routing page (Zillow has no per-agent deep link); acceptable.

## Guardrail
Restyle/interaction only until this block is explicitly greenlit; the DB/RLS/worker work is
the whole point of scoping it separately so customer data stays protected. See
`DESIGN_HANDOFF.md` §9 for the standing guardrails.
