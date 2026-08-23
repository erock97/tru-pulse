# Coach Weekly Brief — design

Date: 2026-08-23. Approved by Eric in chat (design + "generate our own PDF" amendment).

## What this is

Eric runs a Hermes automation on an always-on laptop (built with Codex, not Claude — the
laptop is hands-off except for one send step Codex will add). It scrapes Follow Up Boss
weekly and produces a per-team coaching brief as structured JSON. This feature ingests
that JSON into TRU and renders it as a rolling weekly report in the Coach tab, with our
own PDF export. We never parse the laptop's PDF.

## Data flow

Hermes laptop → one authenticated `POST https://api.truhq.co/coach/weekly-report`
(JSON payload, dedicated bearer secret, retried safely) → Worker validates and stores in
Supabase → Coach tab reads it through the existing `/data/coach/*` as-user routes.

## Payload (from the Codex handoff)

`schemaVersion`, `run { runId, trigger, teamId (slug), teamName, startDate, endDate,
generatedAt, status }`, `agents[] { agentName, metrics { reviewedContacts,
substantiveContacts, callFirst, textFirst, noOutreach, unclassified }, doingRight[],
opportunities[], objections[], coachingActions[] }`, `findings[] { findingIndex,
agentName, leadName, leadUrl, occurredAt, channel, quote }`. Coaching points reference
findings by index for evidence.

## Storage

New table `coach_weekly_reports` (script `db/hq_coach_weekly_report.sql`, idempotent,
additive; SQL is proposed in the PR and applied with review, never as a side effect):

- `id uuid pk`, `run_id text unique` (idempotency key — re-sends upsert, never duplicate),
- `org_id uuid null`, `team_id uuid null` (both resolved from the slug at ingest; null =
  held until the team exists),
- `team_slug text`, `trigger text` (`weekly` | `personal` | other), `status text`
  (`published` | `held`),
- `week_start date`, `week_end date`, `generated_at timestamptz`,
- `payload jsonb` (the whole bundle), `agent_links jsonb` (agentName → agents.id where
  matched unambiguously), `received_at timestamptz`.

RLS: org members read their org's published reports (same `is_org_member(org_id)`
pattern as `db/hq_coach.sql`). Writes only via service role (the Worker ingest).

Additive column `teams.report_slug text unique null` maps Hermes slugs to teams
(seeded: `costigan` → Costigan; `scott-moore` added when Eric sets that team up).

## Ingest rules

- Auth: `Authorization: Bearer <COACH_INGEST_TOKEN>` — a dedicated Worker secret,
  timing-safe compare, narrow lane (this key can only submit reports). 401 otherwise.
- Upsert by `run_id`.
- `trigger === 'weekly'` → `status published`; anything else stored but never shown
  (personal on-demand runs stay email-only per the handoff).
- Unknown `teamId` slug → report stored with `team_id null`, `status held`; publishes
  automatically when the slug gets mapped (re-resolve on read is NOT done; a small
  re-resolve pass runs at ingest time for any held rows matching newly-mapped slugs —
  simplest: resolve held rows whenever a new report arrives, plus an admin re-resolve is
  unnecessary because the next weekly send re-resolves; document this).
- Agent matching: by normalized name among `agents` rows of the resolved team only.
  Ambiguous or missing → that agent stays unlinked in `agent_links`; never guess. The
  ingest response lists matched/unmatched agents so the laptop logs it.
- Payload size cap and field validation; reject non-JSON / missing runId with 4xx so
  the laptop's retry logic isn't fooled.
- Never store credentials; payload is treated as sensitive business data (RLS as above).

## Coach tab UI

Both surfaces wear the Coach tab's temperature tokens (`--tab-mid`/`--tab-soft`, not raw
`--terracotta`), following existing deck classes.

1. **Team brief section** on the Coach page (a `dk-sec` between the bento and the
   cohort): week range, coverage summary, the team scan (per agent: review coverage,
   objections heard, coaching priority), link into each agent.
2. **Agent brief panel** in the agent drill-in (`card ad-panel ad-sheet reveal`
   pattern): Doing Right, Priority Opportunities, Objections Heard, outreach behavior
   (call-first / text-first / no outreach / unclassified), This Week's Coaching Plan.
   Each coaching point expands to its evidence: exact quote, lead, date, channel, FUB
   link. History: past weeks selectable on the agent panel.
3. **Blank rule (Eric: "really important")**: any section without data renders
   "Not enough reviewed this week" — never an empty box, never an error.
4. **PDF export**: a print-designed brief view (dedicated route + print stylesheet,
   browser print-to-PDF). TRU-branded, built from stored data. No PDF libraries.

Client data: new loader in `web/src/lib/coachData.ts` following `loadRoster()` shape
(`workerFetch`, demo branch so `?demo=1` keeps working). Read routes added to
`worker/src/dataRoutes.ts` (as-user, RLS-bound): team brief + agent brief + history.

## Testing

Vitest, pure logic (no jsdom): payload validation, agent-name matching (exact,
normalized, ambiguous-rejects), publish/hold policy, evidence index resolution, and the
report-to-view mapping. Worker route tests beside `worker/src/dataRoutes.test.ts`.

## Shipping

Own branch `feat/coach-weekly-brief`, PR to main, typecheck + tests both packages,
Pages preview deploy for Eric to click (UI degrades to "no brief yet" until the Worker
route ships from main). After merge: apply SQL, deploy Worker from main, set
`COACH_INGEST_TOKEN`, hand Eric the one-line authenticated send command for Codex.

## Out of scope (deliberate)

Importing the laptop's PDF; showing personal on-demand reports in-app; any laptop-side
code (Codex owns the send step); Woosley/Synergy runs (they start whenever Eric enables
them — nothing here is team-specific).
