# TRU HQ — Unification Plan

**Goal:** one login at `app.truhq.co`. Coach, Pulse (and later Rep) become **modules of one account**. The payoff isn't a shared home page — it's that **data flows: a Pulse flag becomes a Coach coaching move.**

---

## Where we are (the honest starting point)

| | **TRU Coach** | **TRU Pulse** |
|---|---|---|
| Lives at | `trucoaching.co` (Netlify) | `app.truhq.co` (Cloudflare Pages + Worker) |
| Supabase | "True-The-Real-U" project | "TRU-Pulse" project (separate) |
| Data model | **team-centric**: team → agents; assessments, goals, commitments, checkins | **org-centric multi-tenant**: org → teams → agents → leads/events/accountability |
| Auth | Supabase Auth — leaders (email+Google), **agents via magic-link/token** | Supabase Auth — leaders (email+Google); agents are just FUB names, no login |
| Onboarding | access-code gated (`create_team` RPC) | self-serve org provisioning (Worker) |
| Users | **2 pilot teams** (real assessment data) | 1 tenant (Costigan) — rebuildable |

Two projects, two auth systems, two data shapes. That's the gap to close.

---

## Target architecture

**ONE Supabase project = the TRU HQ home** (identity + shared org/team/agent backbone + entitlements).

**Recommendation: make the `TRU-Pulse` project the backbone.** Its org/membership/multi-tenant model is already the right foundation for a *suite* (orgs buy products, members have roles). Coach's simpler team model folds under an org. Pulse's single tenant is rebuildable, so nothing of value moves — only Coach migrates *in*. *(Alt: a fresh `TRU-HQ` project both migrate into — cleaner slate, more total churn.)*

**The unified data model:**
- **org** — the tenant (brokerage/customer)
- **membership** — user ↔ org, role (admin / leader / coach) → this is identity + access
- **team** — a FUB account / sub-group within an org
- **agent** — ⭐ **the shared join. One row per real person. BOTH products hang their data off it.** This is the whole game.
- **entitlements** — org → products owned (`pulse` | `coach` | `rep`) → gates which modules appear in HQ
- Coach data (assessments, goals, commitments, checkins) → **keyed to the shared `agent`**
- Pulse data (leads, events, accountability) → keyed to the shared `agent` / `team`

**One Supabase Auth.** Leaders/coaches log in once; memberships + entitlements decide their org and which modules show. Agents keep their Coach token-links (they're profiled subjects, not HQ logins), pointed at the shared `agent` rows.

**The HQ shell** (`app.truhq.co`): login → load memberships + entitlements → a home with product cards → each product is a module/route.

---

## Why this is the point (the handoff)

Both products reference the **same `agent` row**, so Pulse's computed flag (zero-contact, strike) is readable inside Coach's 1:1 prep for that exact person:

> Pulse: *"Trevor hasn't worked 8 Zillow leads — strike 3."* → Coach: *"Trevor's 1:1 this week: the will-vs-skill conversation, here's the move for his archetype."*

**One identity, two products' data.** That handoff is the reason the suite exists — and it's impossible until the agent is a single shared record.

---

## The central hard part: agent identity

Today the two products don't agree on who an agent is:
- **Coach**: agents are enrolled people (name + email + assessment).
- **Pulse**: "agents" are just FUB `assignedTo` **names** on leads (the `agents` table isn't even populated yet).

Unifying means creating **canonical `agent` rows per org** and matching both sources to them (by name + email), with a human review step for collisions. This is the real data-modeling work — everything downstream (the handoff) depends on it.

---

## Migration — phased, nothing breaks the live pilots

**Phase 0 — HQ shell (days).** Scaffold `app.truhq.co` as a home: login (Pulse's auth = the HQ identity from day one) → product cards → Pulse as the first module. Link Coach as `coach.truhq.co` (same brand). *Feels like one suite immediately; sellable/demoable.*

**Phase 1 — Unified schema (days).** Extend the HQ project: `entitlements` table + canonical `agents` + Coach's tables (assessments/goals/commitments/checkins) keyed to the shared `agent`/`org`.

**Phase 2 — Migrate the 2 Coach teams (~1–2 wks, careful).** Per team: create an org, map the team, migrate leaders → memberships, **agents → shared agents (dedupe by name+email)**, assessments/goals/checkins → shared agents. Re-point the Coach app at the HQ project's auth + data. Coordinate the 2 leaders directly (short maintenance window; back up first); reissue agent magic-links if needed.

**Phase 3 — The handoff (days–week).** Surface Pulse flags inside Coach's 1:1 prep — the payoff feature.

**Phase 4 — Fold Coach's UI into the HQ shell as a true module (optional/later).** Until then it runs as an embedded/linked app sharing the same auth + data.

---

## Decisions to lock before Phase 1

1. **HQ home project:** `TRU-Pulse` as backbone *(rec)* vs a fresh `TRU-HQ` project.
2. **Codebase strategy:** share auth + data now, merge the UIs later *(rec)* — vs a full codebase merge up front.
3. **Agent matching:** the rule for deduping Coach agents ↔ Pulse FUB agents (name + email), and who reviews collisions.
4. **Onboarding:** unify Coach's access-code flow + Pulse's self-serve provisioning into one HQ onboarding.

## Effort (at 2 teams)

Phase 0 ~days · Phases 1–2 ~1–2 weeks careful · Phase 3 ~days–week · Phase 4 optional. **"Genuinely one product" ≈ 2–4 weeks, staged so the live pilots never break.**
