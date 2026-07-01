# TRU Pulse

The multi-tenant **accountability dashboard** in the TRU suite — a logged-in,
always-on version of the Free Accountability Audit. It watches a team's paid leads
across every source, flags the ones nobody personally worked, holds agents
accountable (the 3-strike system), and pushes the leader a weekly brief of the
moves that matter.

> **This is a fresh, multi-tenant build.** The internal "Terrason Consulting
> Dashboard" stays running as Eric's private tool for his four teams. Pulse ports
> its *proven logic* — flag math, FUB sync, metrics, the 3-strike system — into a
> product a stranger can self-provision. Nothing here touches the internal tool.

## Decisions (locked)

- **Auth:** Supabase Auth (email/password + Google). Login, database, and RLS are
  one system — no second auth vendor.
- **Stack:** React + Vite front-end on **Cloudflare Pages**; **Supabase**
  (Postgres + Auth + RLS) for data + login; a **Cloudflare Worker** for FUB
  ingestion (backfill / incremental / webhook / cron).
- **Multi-tenancy:** every row carries `org_id`. RLS scopes every read to the
  signed-in user's org. Per-tenant FUB API keys are **encrypted** and only the
  Worker (service role) can read them — the browser never sees a key.
- **v1 scope (accountability core):** self-serve onboarding (org → FUB key(s) →
  seat mapping → first sync) · per-agent zero-contact / stuck / worked flags ·
  $-at-risk · the 3-strike accountability system · the weekly Leadership Brief.
- **Deferred / left in the internal tool:** earnings & payout, broker
  closing-verification, ALMS call-grading. Those are Eric's ops, not the product.

## Tenancy model

```
auth.users ──< memberships >── orgs           (a customer = one org)
                   │ role: admin | leader | coach
                   │
orgs ──< teams >── team_secrets (encrypted FUB key, service-role only)
   │        │
   │        └──< agents
   │
   └──< leads >──< events            (synced from FUB, org+team scoped)
   └──< accountability_cases >──< accountability_events >
   └──< sync_state / daily_snapshots >
```

- A **customer is an org.** An org can hold several FUB accounts (`teams`), exactly
  like Eric's own multi-team setup — so the model isn't tied to one FUB login.
- **RLS** scopes reads to `is_org_member(org_id)`. Coaches can later be narrowed to
  specific teams via `coach_teams` (structure is in place; enforced in v1.1).
- The **Worker** writes with the Supabase service role (bypasses RLS) during sync.

## Layout

```
db/       schema.sql (+ future migrations) — the multi-tenant spine, RLS, indexes
worker/   Cloudflare Worker — FUB ingestion, flag logic, 3-strike reconcile, cron
web/      React + Vite — Supabase-auth'd dashboard, onboarding, per-agent views
shared/   flag math + source families (kept identical to the audit tool)
```

## Porting map (internal tool → Pulse)

| Internal tool | Pulse |
|---|---|
| `worker/src/flags.ts`, `db/metrics.sql` | `shared/flags.ts` + `db/metrics.sql`, now `org_id`-scoped |
| `audit/accountability_audit.py` source families | `shared/flags.ts` `SOURCE_FAMILIES` (incl. pay-at-close Referrals) |
| `db/accountability.sql` (3-strike) | `db/accountability.sql`, org-scoped + coach-aware |
| `worker/src/sync/*` (backfill/incremental/webhook) | `worker/src/sync/*`, per-tenant keys |
| Clerk auth | Supabase Auth |
| Hardcoded `TEAMS` + Worker-secret keys | `teams` rows + encrypted `team_secrets` |

## Build order

1. **db/schema.sql** — tenancy + RLS (done first; the spine). ← current
2. **shared/flags.ts** — port the flag math + source families.
3. **worker** — tenant sync (backfill/incremental/webhook), flag persistence, 3-strike reconcile, cron.
4. **web** — Supabase auth, self-serve onboarding, the accountability dashboard.
5. **Leadership Brief** — weekly proactive push (email).

See the suite GTM plan for where Pulse sits (the "Command" tier gate).
