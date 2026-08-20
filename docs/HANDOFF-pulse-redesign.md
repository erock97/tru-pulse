# Handoff — TRU HQ redesign and the Hustle Score wiring

Written 2026-08-20. Everything below is done and verified unless it says otherwise.
Nothing has been deployed to production.

---

## 1. What is finished

**Design — PR #33 on `erock97/tru-pulse`, branch `design/forest-deck`.**
The dark system is retheméd to a deep, desaturated forest ground, bone ink and a
single amber accent. Every dark surface reads from one token block scoped to
`.tru-dark` in `web/src/truHqDark.css`, so the retheme covers Home, Pulse, Coach,
Rep and every agent-facing screen at once. The lighting hangs off `.tru-shell`,
which both `hqShell` and `agentHqShell` already render — no page code changed to
get it. Categorical palettes (lead sources, coaching archetypes) were folded into
the same family. `Ring` and `Donut` in `web/src/components/viz.tsx` had light-theme
colours hardcoded and now read tokens.

Look at it with `npm --prefix web run dev`, then `localhost:5173/?demo=1#/pulse`.
Demo mode needs no login.

**Weekly-report source — branch `codex/team-report-command-center-production` on
`erock97/fub-weekly-reports`, commit `fd87787`.**
The code that actually sends your Monday reports existed only as 75 uncommitted
files on one Windows disk. It is now on GitHub. `main` on that repo is a stale
pre-August snapshot that still sends from `trucoaching.co` — deploying `main`
would silently kill every report.

**Database — live on the TRU-Pulse Supabase project (`yeyoteredgunhvhqmais`).**
- `hustle_weekly_scores` — one row per agent per week, RLS on, read policy limits
  a team to its own rows, indexed on `(org_id, week_ending desc)` and `agent_id`.
- `orgs.hustle_team_slug` — nullable. Costigan, Signature and Woosley are mapped.
  Synergy is deliberately unmapped; Eric is handling that separately.
- A duplicate empty "The Costigan Group" org was deleted after confirming all 34
  tables referencing `org_id` held zero rows for it.

**Writer — PR #1 on `erock97/fub-weekly-reports`, branch
`feat/publish-hustle-to-pulse`.**
Publishes the weekly score into that table. 385 tests pass, typecheck clean.
Credentials are set on the Worker and verified. **Merge this and the next Monday
run starts filling the table.**

---

## 2. Decisions already made — do not reopen these

These came out of a long interview and cost most of a session.

| Question | Decision |
|---|---|
| Where the roster lives | **It becomes Pulse. Home is removed entirely.** Three tabs: Pulse, Coach, Rep. |
| What the top of Pulse says | **A priority list — "what to do today"** — ranked people, each with a plain-English next step. Not a single named person, not a stat wall. |
| The conversion line | **Set per team.** Not one global number. |
| What Coach becomes | **Coach stays and is not absorbed.** It is the 1:1 coaching workspace: running effective 1:1s, logging them, importing notes from whatever note-taker the leader uses, how to approach an agent by personality, goal-setting by personality, early signs an agent is falling out. The agent panel on Pulse is a *summary that hands off* to Coach. |
| Depth of the next step shown | **Sentence, action, and how to approach them** — the personality angle comes from the existing archetype data. |
| Hustle Score | **Connect the real one first, then build.** Done. |
| Commission | **Removed.** Manual, scoped for a different purpose, of no interest. Do not reintroduce it. |

---

## 3. What is actually real in the data

The single most damaging thing in this product has been numbers that look real and
are not. Hold this line.

**Real today:** leads assigned per agent, worked percentage, leads sitting in Lead,
offers reached and under-contract per agent (from current stage), days since last
1:1, certification progress, lead source.

**Not real, and must not be invented:**
- *Trend.* `computeAgentTrends` exists in `shared/metrics.ts` and is deliberately
  switched off. Follow Up Boss carries no stage history, so the past is
  unrecoverable; the record only accrues forward. Trend becomes answerable roughly
  six to eight weeks after the Hustle writer starts filling `hustle_weekly_scores`.
- *Hustle score inside Pulse.* The 0–100 ring on Coach is **coaching health**, not
  hustle — check-in freshness, assessment cadence, profile confidence. Its own code
  comment says it stands in for "the mockup's fake hustle score". Rename or replace
  it; do not present it as performance.
- *Offer rate* is part-inferred. It carries a "part inferred" tag today. Keep it.

---

## 4. Next task — rebuild Pulse

Take the approved layout and build it against real data.

Reference mockup: https://claude.ai/code/artifact/ff203d0c-d1f2-4e57-b02b-24b0b8a925ce

Shape, top to bottom:
1. **Priority list.** Ranked people needing a conversation. Rank on: days since
   last 1:1, leads untouched in Lead, conversion against that team's line, never
   invited to certification — and the Hustle `broker_action` once rows exist. Each
   item gets one plain sentence, a specific action, and the approach for their
   archetype.
2. **Compact stat strip.** Leads in play, worked, under contract, leads per
   contract, still in Lead, how many are past the team's line. No commission.
3. **Dense roster table.** Agent, leads, worked, in Lead, offers, contracts,
   leads-per-contract with the team line marked on a shared scale, last 1:1, state.
   Sortable; the sorted column carries the gold underline.
4. **Agent panel on click.** Pipeline, coaching summary, certification — then hands
   off to Coach for the actual 1:1 work.
5. **Unmatched agents.** When `hustle_weekly_scores` has rows with a null
   `agent_id`, say so on screen with the names. Agreed explicitly: never drop them
   silently.

`web/src/pages/Dashboard.tsx` is 1,751 lines and `Coach.tsx` is 1,816. The app has
seven shared components. Split as you go rather than growing them.

---

## 5. Traps found the hard way

- **Repo rules are real.** `AGENTS.md` in tru-pulse: own worktree, own branch off
  `origin/main`, done means a PR exists, never deploy to production, never change
  the database as a side effect of a code task.
- **`web/.env.production` is gitignored.** A fresh worktree must have it copied in
  before building or the bundle bakes in a dead database address and nobody can log
  in.
- **The Codex tree has a `CLAUDE.md`** requiring a `tru-brain` MCP preflight. That
  server was not connected; Eric overrode it for one session. Ask again.
- **Legacy Supabase API keys were disabled on 13 August 2026.** `PULSE_SUPABASE_ANON_KEY`
  in Infisical is one of them and is dead — 208 chars, legacy format. Anything still
  using it has been failing. **Unresolved. Worth chasing.**
- **Infisical holds everything.** Project `8ae8aecb-79a2-4311-8fa3-82c44c2c5662`,
  env `prod`. Do not ask Eric for credentials. `infisical secrets get --plain`
  returns empty in Git Bash; list with `-o json` and read from that instead.
- **Give Eric PowerShell, not bash.** Backslash continuations and `sh -c` cost two
  rounds. And `cd` into the Worker folder first or wrangler targets nothing.
- **`zillowDecks.test.ts` fails on untouched `origin/main`.** Pre-existing, not from
  any of this work, still unfixed.
- **Scott Moore** gets a weekly Hustle report and has no Pulse org, so the writer
  skips it with `NO_MATCHING_ORG`. **Synergy NJ** is in Pulse with 1,514 leads and
  gets no weekly report. Both deliberate, both Eric's to resolve.

---

## 6. How Eric wants to be worked with

Short answers, plain English, no internal names in anything he has to decide on.
Multiple-choice questions when there is a real decision — he has said explicitly
that options help him think it through. One batched set, not one question at a
time. Recommend, do not survey. And do not write copy that sounds like a LinkedIn
post; he will notice and he is right.
