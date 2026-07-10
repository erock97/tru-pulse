# Structured Leadership 1:1 — Design (Block 3)

**Status:** DESIGN ONLY — nothing here is applied. SQL below is a proposal for Eric to
approve; Block 4 builds it.
**Scope source:** `COACH_1ON1_PLAN.md` Blocks 3–4. Eric's two locked decisions are honored
throughout: (a) ONE standard TRU checklist for v1, (b) the agent sees only wins +
commitments + next focuses; checklist completion and private notes are leader-only.

---

## 0. What exists today (verified in code)

| Piece | Where | Behavior |
|---|---|---|
| `checkins` table | `db/hq_coach.sql:73-87` | One row per 1:1: `met`, `leads`, `convos`, `win` (single text), `focus` (single text), `logged_by`, `created_at`. |
| `checkins` RLS | `db/hq_coach.sql:132-156` | Two policies: `checkins_org_all` (org members, FOR ALL) and `checkins_agent_self` (FOR ALL, `agent_id in (select id from agents where auth_id = auth.uid())`). **The agent can already read every column of their own checkins rows.** |
| Token agent surface | `db/hq_coach_compat.sql:207-219` | `get_agent_home(p_token)` — SECURITY DEFINER RPC granted to **anon** — returns `row_to_json` of the agent's **full** `checkins` rows by `agents.token`. A second, unauthenticated read path into `checkins`. |
| Auth agent surface | `App.tsx:71-79, 119-124` | An agent signs in with Supabase Auth → `claim_agent()` links `agents.auth_id` → `myAgent()` → renders `AgentCourse` (`web/src/pages/AgentCourse.tsx`, the Rep learner portal). This is the surface the recap lands on. |
| `commitments` table | `db/hq_coach.sql:59-71` | **Standing** quarterly behavioral checklist per agent (company/sphere, seeded from goal + archetype in `generateBaseCommitments`, toggled `done`). NOT per-session. Rendered by `GoalSheet`/`CommitGroup` (`Coach.tsx:1176-1374`). |
| Current form | `OneOnOneSheet` (`Coach.tsx:923-1065`) | met toggle + one win + one focus + date → `saveCheckin`. Block 1 draft persistence: `pulse:1on1draft:{agentId}` (`Coach.tsx:626-671`). |
| History | `PastOneOnOnes` (`Coach.tsx:1090-1162`) | Renders the `checkins` array: date, met pill (`ad-met-pill yes/partial/no`), win/focus preview, expandable detail. |
| Demo | `coachData.ts` `demoAgentRows()` / `demoCheckinRows()`; `?demo=1#/learn` renders `AgentCourse` for demo agent Jordan Rivera (`App.tsx:101-104`). |
| `fill_org_id` trigger | `db/hq_coach_compat.sql:70-85` | Autofills `org_id` from `team_id` on insert for the Coach tables — new tables must be added to this loop. |

Two consequences drive the whole data model:

1. **`checkins` is agent-readable twice over** (RLS `agent_self` + the anon token RPC), and
   Postgres RLS is row-level, not column-level. So leader-only data can never live in
   `checkins` — not as columns, not as jsonb. It must be a separate table with no agent path.
2. Roster pace/health, `lastFocus`, talking points, Past 1:1s previews, and the legacy token
   agent-home all key off `checkins` exactly as shaped today. A parallel `one_on_ones` table
   would force rebuilding all of that plumbing.

---

## 1. DATA MODEL

**Recommendation: keep `checkins` as the session spine, unchanged. Add two child tables:
`checkin_items` (agent-visible wins / focuses / commitments) and `checkin_leader`
(leader-only checklist state + private note).**
Rationale: every existing read path (pace, health, history, demo, token RPC) keeps working
untouched, and the visibility split falls out of table boundaries instead of fragile
column filtering.

### 1a. `checkins` — no schema change

The structured save still inserts one `checkins` row per session. For backward
compatibility, `win` gets the **first win's text** and `focus` the **first focus's text**
(summary columns). Everything downstream — roster `lastFocus`, `paceFromDays`, Past 1:1s
one-line preview, `get_agent_home` — keeps working with zero edits. A structured session is
recognizable by having child rows; legacy quick check-ins simply have none.

### 1b. `checkin_items` — agent-visible content (proposal, not applied)

```sql
-- One row per win / next-focus / commitment captured in a 1:1.
create table if not exists checkin_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  checkin_id  uuid not null references checkins(id) on delete cascade,
  kind        text not null check (kind in ('win','focus','commitment')),
  body        text not null,
  position    int  not null default 0,
  -- commitment lifecycle (kind='commitment' only; null = not yet reviewed):
  status      text check (status in ('done','partial','missed')),
  reviewed_in uuid references checkins(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists checkin_items_checkin_idx on checkin_items (checkin_id);
create index if not exists checkin_items_agent_idx   on checkin_items (agent_id, kind, created_at);
```

**How "review last 1:1's commitments" links sessions:** a commitment set in session A is a
`checkin_items` row (`kind='commitment'`, `checkin_id = A`, `status = null`). When the
leader runs session B, the form loads **all of the agent's unreviewed commitments**
(`kind='commitment' and status is null`) — not "the previous checkin's rows" — so nothing
falls through the cracks if a session was skipped or quick-logged. Marking each one
Done/Partial/Missed sets `status` and stamps `reviewed_in = B`. No separate review table;
one child table carries wins, focuses, commitments, AND the review outcome.

**Multiple wins/focuses:** one row each, ordered by `position`. The form is a multi-add
list (same add-row idiom as `CommitGroup`).

**Relationship to the standing `commitments` table:** untouched. That table is the
quarterly behavioral standard (company/sphere) living in `GoalSheet`; per-session 1:1
commitments are a different thing ("what you'll do before we meet again") and live in
`checkin_items`. The two coexist; the guided checklist references the standing checklist
in one prompt but the tables never mix.

### 1c. `checkin_leader` — leader-only sidecar (proposal, not applied)

```sql
-- LEADER-ONLY. Never add an agent policy; never expose via get_agent_home or any
-- anon/token RPC. The agent-visibility contract depends on this table staying dark.
create table if not exists checkin_leader (
  checkin_id        uuid primary key references checkins(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  team_id           uuid not null references teams(id) on delete cascade,
  agent_id          uuid not null references agents(id) on delete cascade,
  checklist_version text  not null default 'tru-1on1-v1',
  checklist         jsonb not null default '{}'::jsonb,   -- { "<step_id>": true, ... }
  private_note      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists checkin_leader_agent_idx on checkin_leader (agent_id);
```

**Where the checklist definition lives:** in code, not the DB — a versioned constant
(`ONE_ON_ONE_CHECKLIST` in `web/src/lib/coachData.ts`, steps with stable string ids like
`'open' | 'review' | 'win' | 'blockers' | 'wired' | 'goal' | 'next' | 'book'`).
`checklist_version` is stamped on each row so the later "customizable checklist" phase
(an org-level definition table) can render historical sessions against the right prompt
set. v1 ships zero checklist-definition tables.

### 1d. Atomic save — one RPC, SECURITY INVOKER

The Supabase JS client can't do transactions, and a structured save touches three tables
plus review-updates. Ship one RPC:

```sql
-- SECURITY INVOKER (the default): runs AS THE CALLER, so every insert/update inside is
-- still filtered by the RLS policies below. Not a bypass — just atomicity.
create or replace function log_structured_checkin(
  p_agent_id uuid, p_team_id uuid, p_met text, p_created_at timestamptz,
  p_wins text[], p_focuses text[], p_commitments text[],
  p_reviews jsonb,          -- [{ "item_id": uuid, "status": "done|partial|missed" }, ...]
  p_checklist jsonb,        -- { "<step_id>": true }
  p_private_note text
) returns uuid language plpgsql as $$
declare v_checkin uuid;
begin
  insert into checkins (agent_id, team_id, logged_by, met, win, focus, created_at)
  values (p_agent_id, p_team_id, 'leader', p_met,
          nullif(p_wins[1], ''), nullif(p_focuses[1], ''),
          coalesce(p_created_at, now()))
  returning id into v_checkin;

  insert into checkin_items (team_id, agent_id, checkin_id, kind, body, position)
  select p_team_id, p_agent_id, v_checkin, k.kind, k.body, k.pos
  from (
    select 'win' as kind, w as body, ordinality::int as pos from unnest(p_wins) with ordinality as t(w, ordinality)
    union all
    select 'focus', f, ordinality::int from unnest(p_focuses) with ordinality as t(f, ordinality)
    union all
    select 'commitment', c, ordinality::int from unnest(p_commitments) with ordinality as t(c, ordinality)
  ) k where btrim(k.body) <> '';

  update checkin_items i
     set status = r.status, reviewed_in = v_checkin
    from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as r(item_id uuid, status text)
   where i.id = r.item_id and i.agent_id = p_agent_id and i.kind = 'commitment';

  insert into checkin_leader (checkin_id, team_id, agent_id, checklist, private_note)
  values (v_checkin, p_team_id, p_agent_id, coalesce(p_checklist, '{}'::jsonb), nullif(btrim(p_private_note), ''));

  return v_checkin;
end $$;
grant execute on function log_structured_checkin(uuid, uuid, text, timestamptz, text[], text[], text[], jsonb, jsonb, text) to authenticated;
```

(`org_id` on all three inserts is filled by extending the existing `fill_org_id` trigger
loop — `db/hq_coach_compat.sql:78-85` — to include `checkin_items` and `checkin_leader`.
`p_reviews` re-checks `agent_id` so a review can never touch another agent's items. NOT
granted to `anon`.)

**`met` upgrade (small, contained):** the current form sends a boolean; the schema and the
Past-1:1s pills already speak `'yes' | 'partial' | 'no'`. The structured form uses a
tri-state pill row (same `ad-met-pill` classes), sending the text value. Legacy boolean
rows keep rendering via the existing `metStatus()` mapper — no migration.

---

## 2. TWO-SIDED VISIBILITY + RLS

### The agent surfaces (found, both verified)

1. **Auth'd agent portal** — the delivery mechanism Eric wants. Agent signs in →
   `agents.auth_id` linked → `AgentCourse` renders. The agent's Supabase client hits the
   tables directly; the `*_agent_self` RLS policies are what let them read their own rows.
   The recap view goes here.
2. **Legacy token home** — `get_agent_home(p_token)` (anon, SECURITY DEFINER) returns the
   agent's goals/commitments/checkins by `agents.token`. **v1 leaves this RPC byte-for-byte
   untouched**: it only ever selects from `checkins` (whose columns remain the agent-safe
   summary), so it can't leak the new leader-only data because that data isn't in any table
   it reads.

### Policy design (proposal, not applied)

```sql
alter table checkin_items  enable row level security;
alter table checkin_leader enable row level security;

-- Leader/coach: full access to their org's rows (mirrors the existing Coach loop).
create policy checkin_items_org_all on checkin_items for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy checkin_leader_org_all on checkin_leader for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Agent: SELECT-ONLY on items. Deliberately narrower than the existing agent_self
-- FOR ALL policies — the 1:1 record is the leader's log; the agent reads it, never edits.
create policy checkin_items_agent_read on checkin_items for select to authenticated
  using (agent_id in (select id from agents where auth_id = auth.uid()));

-- checkin_leader: NO agent policy of any kind. RLS default-deny does the work.
```

### Exactly what each side can read

| Data | Table.column | Leader | Agent |
|---|---|---|---|
| Session date, met, activity, summary win/focus | `checkins.*` | ✅ | ✅ (existing `checkins_agent_self` + token RPC — unchanged) |
| Wins (all) | `checkin_items` kind `win` | ✅ | ✅ read-only |
| Next focuses (all) | `checkin_items` kind `focus` | ✅ | ✅ read-only |
| Commitments + Done/Partial/Missed outcome | `checkin_items` kind `commitment` (`body`, `status`, `reviewed_in`) | ✅ | ✅ read-only |
| Checklist completion | `checkin_leader.checklist` (+version) | ✅ | ❌ no policy exists |
| Private notes | `checkin_leader.private_note` | ✅ | ❌ no policy exists |

### Why this cannot leak (the rigor)

- **No column filtering anywhere.** The split is table-shaped. There is no query the agent
  client could craft — direct select, PostgREST FK embed (`checkins.select('*, checkin_leader(*)')`),
  or filter probe — that returns `checkin_leader` rows, because RLS default-denies a table
  with no matching policy. Embeds through a denied table return empty, and RLS applies to
  embedded resources.
- **No new anon surface.** `log_structured_checkin` is SECURITY INVOKER and granted to
  `authenticated` only; `checkin_leader` is excluded from every SECURITY DEFINER RPC.
  Standing rule for Block 4 + the Block 6 audit: **no SECURITY DEFINER function may ever
  select from `checkin_leader`, and no leader-only column may ever be added to `checkins`
  or `checkin_items`.**
- **Cross-org/agent:** `org_all` policies scope by `is_org_member(org_id)` (memberships,
  `schema.sql:41-47`), identical to every existing Coach table; `agent_read` scopes by
  `auth_id`. The RPC re-checks `agent_id` on review updates.
- **Audit test (Block 6):** sign in as a linked agent, attempt
  `supabase.from('checkin_leader').select('*')` and the FK-embed variant → both must
  return zero rows; attempt insert/update/delete on `checkin_items` → denied.

---

## 3. THE STANDARD CHECKLIST — "TRU Leadership 1:1" v1 (`tru-1on1-v1`)

Draft content for Eric's verbatim approval. Eight steps, ordered as the meeting should
run. Each step = short imperative title + one coaching cue (the cue renders as the
sub-line). Steps marked ⚡ auto-tick when the matching form section has content (the
leader can untick; nothing else auto-ticks).

| # | id | Prompt | Coaching cue |
|---|---|---|---|
| 1 | `open` | **Open on them, not the numbers.** | Two minutes of genuine catch-up. How are they actually arriving today — energized, scattered, guarded? You're reading the person before you coach the producer. |
| 2 | `review` ⚡ | **Review last 1:1's commitments — every one.** | Walk each commitment: done, partial, or missed. No judgment on a miss — curiosity: "What got in the way?" Skipping this step teaches them commitments are optional. |
| 3 | `win` ⚡ | **Celebrate one specific win.** | Name the exact behavior, not just the result — "You followed up five times on that Zillow lead" beats "great month." What gets celebrated gets repeated. |
| 4 | `blockers` | **Ask what's blocking them — then ask where they need you.** | "What's the biggest thing in your way right now?" then "What do you need from me?" Listen for their archetype's early-warning signal (it's on this page, under How to coach them). |
| 5 | `wired` | **Coach one move to how they're wired.** | Achievers stretch with bigger targets and autonomy. Strivers grow in structure and safety before stretch. Independents need credibility first — coach engagement, not skill. One move, matched to the person. |
| 6 | `goal` | **Connect this week's work to their goal.** | Draw the line out loud from their next focus to their quarterly number: "These conversations are what turns into your closings." Work with no line to the goal feels like your agenda, not theirs. |
| 7 | `next` ⚡ | **Set the next focus and commitments — in their words.** | They say it, you write it. Specific and countable ("10 sphere conversations by Friday"), never vague ("work the database"). If they can't say it back, it isn't set. |
| 8 | `book` | **Book the next 1:1 before you stand up.** | A 1:1 without a next date is a conversation, not a cadence. Same time next week beats "we'll find time." |

Design notes on the content:
- Steps 2/3/7 map 1:1 to the form's Review / Wins / Next sections — that's what makes ⚡
  auto-tick honest (the checklist reflects what actually happened, at zero extra clicks).
- Step 5 bakes the Achiever/Striver/Independent framing directly into the cue so the
  checklist teaches TRU's behavioral-leadership model even to a brand-new leader, and it
  points at the archetype panel already rendered above the form (`How to coach them`,
  `signal`/`unlock` from `Profile`).
- Step 4's cue references the agent's `signal` — the drill-in already shows it, so the
  checklist and the archetype engine reinforce each other instead of duplicating.

---

## 4. UX / FLOW

### Leader side — "Run this 1:1" replaces `OneOnOneSheet`

Same slot in `AgentDrill` (between the 1:1 Playbook card and `PastOneOnOnes`), same shell:
one `section.card.ad-panel.ad-sheet` with an `ad-panel-head` ("Run this 1:1" ·
panel-sub = last check-in recency + last focus, exactly as today). The existing two-column
`ad-sheet-cols` layout is kept: **left = the guided checklist** (replacing "The move"
talking points — the archetype-specific pointers migrate into checklist cues + the
untouched Playbook card above), **right = the capture form**. On narrow screens they stack
(existing behavior).

**Left column — the checklist as the guide.** Eight `ad-check`-style rows (checkbox box +
title; the cue as a smaller `ad-checkin-detail-text` line under the open/active step).
Header row carries a quiet leader-only marker: `Leadership checklist · only you see this`
(reuses `ad-sub-label` + the `blind` tag treatment). ⚡ steps tick themselves as sections
fill; all steps remain manually toggleable. Completed count surfaces in the panel-sub
("Checklist 6/8") so leaders feel the standard without being policed.

**Right column — four capture groups, in meeting order** (each styled like a
`CommitGroup`: `ad-commit-title` header + `ad-checklist` rows + `ad-commit-add` add-row):

1. **Last commitments** — the agent's unreviewed commitment items. Each row: the text +
   three `ad-met-pill` toggles (Done `yes` / Partial `partial` / Missed `no`), tap to set.
   Empty state (`ad-commit-empty`): "No commitments from a prior 1:1 yet — set the first
   ones below."
2. **Wins** — multi-add text rows (add input + Add button, exactly the `CommitGroup` add
   idiom). Placeholder: "Something {first} did well…"
3. **Next focuses** — multi-add rows. Placeholder: "What they'll work on next…"
4. **Commitments for next time** — multi-add rows. Placeholder: "Specific + countable —
   '10 sphere conversations by Friday'…"

Below the groups: **Private note** (an `ad-field` textarea labeled "Private note — never
shown to {first}"), then the footer row: met tri-state pills + date input (unchanged
`ad-field-date`) + the primary button ("Log this 1:1", `btn btn-primary ad-log-btn`), with
the existing `ad-saved` "Logged" flash and `ad-draft-note` "Draft restored" affordances.

No new visual vocabulary: every element above is `ad-panel` / `ad-sheet` / `ad-check` /
`ad-commit-*` / `ad-met-pill` / `ad-field` / `ad-input` / `btn` — all already in
`truHqDark.css`.

### Agent side — the recap in `AgentCourse`

On the `AgentCourse` home view (`view === 'home'`), a **"Your 1:1s"** section renders
under the module list when the agent has any logged sessions: a short list (newest first,
cap ~5 with a "show all" expander) of recap cards in the `ac-modcard` visual language —
date chip, then three compact blocks: **Wins** (celebrated first — this is the delivery
mechanism for recognition), **Your focus**, **Your commitments** (each with its
Done/Partial/Missed pill once reviewed; unreviewed = quiet "for this week" state). Copy is
second-person ("What you committed to"). Nothing about checklists or leader notes exists
in this view — and per §2, nothing the client could query returns them. Loader:
`loadMyOneOnOnes(agentId)` (checkins + items via the agent's own RLS). Empty state: the
section simply doesn't render. Demo: `?demo=1#/learn` seeds 2 recaps for Jordan Rivera.

---

## 5. COMPATIBILITY

**Block 1 draft persistence** — same key (`pulse:1on1draft:{agentId}`), richer shape:

```ts
interface OneOnOneDraft {
  v: 2;                       // version tag
  met: 'yes' | 'partial' | 'no';
  date: string;
  wins: string[]; focuses: string[]; commitments: string[];
  reviews: Record<string, 'done' | 'partial' | 'missed'>;  // itemId → status
  checklist: Record<string, boolean>;                       // stepId → checked
  privateNote: string;
}
```

Hydration migrates a v1 draft (`{met: boolean, win, focus, date}`) into v2 (`win`→`wins[0]`,
etc.) so nobody loses an in-flight draft on deploy day. Same debounce write, same
clear-on-successful-save, same per-agent keying.

**Block 2 Past 1:1s** — the collapsed row is untouched (date + met pill + preview still
read `checkins.win/focus`, which the RPC keeps writing). The expanded detail gets richer
when child rows exist: Wins list, Next focuses list, Commitments with their outcome pills,
"Checklist 7/8 · tru-1on1-v1" line, and the private note (leader side only — this
component only exists in the leader drill-in). Data comes from upgrading `loadCheckins` to
also fetch the agent's `checkin_items` + `checkin_leader` (two extra scoped queries, keyed
into the existing `checkins` array as optional fields) — legacy rows without children
render exactly as today.

**Block 5 paste-in import** — the structured form gives extraction clean targets: the AI
extracts `wins[]` and `focuses[]` (and optionally `commitments[]`) and writes them into the
**draft** arrays flagged as imported-for-review; the leader edits/deletes rows before
saving. Nothing writes to the DB without the leader hitting "Log this 1:1". Because import
fills the draft, Block 1 persistence covers it for free.

**Roster / health / demo** — `paceFromDays`, `healthOf`, `lastFocus`, `demoAgentRows` need
zero changes (all read `checkins`). Demo additions: `demoCheckinItems()` +
`demoCheckinLeader()` in `coachData.ts` keyed to the existing `demo-ci-*` ids (Trevor and
Dana get full structured sessions incl. reviewed commitments; Priya gets a legacy-only
history so the "old record" rendering is previewable; Maria keeps the empty state), plus
the Jordan Rivera recap seed for `#/learn`. `saveCheckin`/`log_structured_checkin` are
no-op-guarded under `isDemo` exactly like today's write paths.

---

## 6. BUILD BREAKDOWN (proposed Block 4 sub-blocks, each gated, each demo-testable)

**4a — Schema + data layer + demo seed (Sonnet).**
Write `db/hq_coach_1on1.sql` (tables, indexes, RLS, `fill_org_id` loop extension, RPC —
additive + idempotent, NOT applied by the agent; Eric runs it in the SQL editor like every
other `db/*.sql`). Add to `coachData.ts`: `ONE_ON_ONE_CHECKLIST` (the §3 content, verbatim),
types (`CheckinItem`, `CheckinLeader`), `loadCheckinBundle` (checkins + items + leader),
`loadOpenCommitments`, `saveStructuredCheckin` (RPC call), and the demo seeds.
**Test in `?demo=1`:** loaders return seeded structured data; existing UI unchanged and
unbroken. Typecheck + build clean.

**4b — Leader-side structured form + richer Past 1:1s (Sonnet).**
Replace `OneOnOneSheet` with the §4 "Run this 1:1" panel (checklist left, capture groups
right, private note, tri-state met, draft v2 with v1 migration). Upgrade `PastOneOnOnes`
expanded detail per §5. Reuse-only styling (standing constraint).
**Test in `?demo=1`:** full form renders on every demo agent incl. commitments-to-review
on Trevor/Dana, legacy rendering on Priya, empty states on Maria; draft survives
navigation; "save" flows the optimistic demo path.

**4c — Agent-side recap (Sonnet).**
`loadMyOneOnOnes` + the "Your 1:1s" section in `AgentCourse` home + Jordan Rivera demo
seed. **Test in `?demo=1#/learn`** and, on a real login, verify the §2 audit probes
(agent select on `checkin_leader` → zero rows; agent write on `checkin_items` → denied).

Order matters: 4b consumes 4a's loaders; 4c consumes 4a's tables but not 4b — so 4c could
run parallel to 4b if the orchestrator wants, though serial keeps the gates simple. Block 5
(paste-in) then targets 4b's draft arrays; Block 6 audits the §2 leak probes explicitly.

---

## Open questions for Eric

1. **Standing commitments in the review step?** v1 reviews only per-session 1:1
   commitments (`checkin_items`). The quarterly company/sphere checklist stays where it is
   in Goal & Commitments. If you'd rather the 1:1 review ALSO walk the standing checklist,
   that's a small 4b addition — say the word.
2. **Met tri-state:** the design upgrades the "We met" toggle to Met / Partial / Missed
   pills (the history view already renders all three). Confirm you want the third state on
   the form, or keep the simple toggle.
3. **Legacy token agent-home (`get_agent_home`, the old standalone Coach agent link):** v1
   deliberately leaves it untouched (it keeps showing the summary win/focus). If any team
   still actively uses those token links and should see full structured recaps there, that's
   a follow-up RPC extension — agent-visible fields only.
