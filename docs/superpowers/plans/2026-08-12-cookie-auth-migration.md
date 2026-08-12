# Cookie Auth Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` for tracking.

**Goal:** Move the login out of browser storage into an `httpOnly` cookie backed by a server-side session, without changing any row-level security policy.

**Architecture:** The existing Cloudflare Worker becomes a thin authenticated proxy at `api.truhq.co`. It holds Supabase tokens in KV, hands the browser an opaque `httpOnly` cookie, and calls Supabase **as the signed-in user** so Postgres keeps enforcing tenancy.

**Spec:** `docs/superpowers/specs/2026-08-12-cookie-auth-migration-design.md`

**Branch:** `feat/cookie-auth` off `main`. Single cutover (Eric's call). Old path stays behind `VITE_AUTH_MODE`.

## Global Constraints

- **Never change an RLS policy.** The worker forwards the user's JWT; Postgres enforces. If a task seems to need a hand-written tenancy check, stop — that means the JWT isn't being forwarded.
- Cookie: `hq_sid`, `HttpOnly; Secure; SameSite=Lax; Path=/`, host-scoped to `api.truhq.co`. Never readable by JavaScript.
- Every mutating route requires an allowlisted `Origin`. Absent Origin on a mutating route = reject.
- Run `npm run typecheck && npm test` in the changed package before every commit. Worker currently at 99 tests, web at 86.
- Verify against a Pages **preview** URL before anything touches `app.truhq.co`.
- Do not remove the anon key from the bundle until Phase 6 is done and verified.

---

### Phase 1 — `api.truhq.co`

- [ ] Add the custom domain to `worker/wrangler.toml` (`routes` with the `truhq.co` zone). If the zone isn't reachable from config, hand Eric the one DNS step.
- [ ] Deploy; confirm `https://api.truhq.co/health` returns `{"ok":true}`.
- [ ] Add `https://api.truhq.co` to nothing — it's the server, not an origin. Leave the allowlist alone.
- [ ] Point `VITE_WORKER_URL` at `https://api.truhq.co` in `web/.env.production`; build and confirm the app still works end to end on a preview URL.
- [ ] Keep the `workers.dev` address live — FUB webhooks are registered against it. Do NOT re-register yet.
- [ ] Commit.

**Done when:** both addresses serve, the app works via `api.truhq.co`, webhooks still land on the old one.

---

### Phase 2 — Content-Security-Policy + owner-token trim

Folded in early because it protects during the migration.

- [ ] Add a CSP response header on the Pages side (`web/public/_headers`): `default-src 'self'`, `connect-src 'self' https://api.truhq.co https://*.supabase.co`, `img-src 'self' data:`, `media-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`.
- [ ] Load every screen on a preview URL, read the console, fix any legitimate blocks (the hero video and Supabase are the likely ones). A CSP that breaks the app is worse than none.
- [ ] Commit only once the console is clean.

**Done when:** all four screens render with zero CSP violations in the console.

---

### Phase 3 — Cookie login, running alongside the old path

- [ ] Create the KV namespace; bind as `SESSIONS` in `wrangler.toml`.
- [ ] `worker/src/session.ts`: `createSession(env, tokens)`, `readSession(env, sid)`, `refreshIfNeeded(env, sid)`, `destroySession(env, sid)`, `sessionCookie(sid)`, `clearCookie()`. Session id from `crypto.getRandomValues`, 32 bytes, base64url.
- [ ] Unit-test that module: cookie flags present, expired access token triggers refresh, destroyed session reads as null, a tampered id doesn't resolve.
- [ ] Routes: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/set-password`, `POST /auth/reset-request`. Each mutating one requires an allowlisted Origin.
- [ ] Route tests: login sets an `HttpOnly` cookie and returns no token in the body; `/auth/me` without a cookie is 401; logout clears both cookie and KV.
- [ ] Web: `VITE_AUTH_MODE` switch. In `cookie` mode, `web/src/lib/authClient.ts` calls the worker with `credentials: 'include'`; in `token` mode nothing changes.
- [ ] Commit.

**Done when:** on a preview URL with `VITE_AUTH_MODE=cookie`, login works, the cookie is `HttpOnly` in devtools, and `localStorage` holds no token.

---

### Phase 4 — Data calls behind the worker: Pulse

The repeatable pattern. Do Pulse first because it has the most traffic and the fewest writes.

- [ ] `worker/src/asUser.ts`: `supabaseAsUser(env, sid)` returning a helper that calls PostgREST with the **user's** access token, not the service role. This is the load-bearing piece — RLS keeps enforcing.
- [ ] Test that it sends the user's token and never the service-role key.
- [ ] `GET /data/dashboard` — replaces the 8 direct calls behind `loadDashboard()`: `leads`, `teams`, `org_settings`, `agents`, `deals`, `accountability_cases`, `person_stage_log`, `memberships`.
- [ ] Test: two users in different orgs get disjoint rows through the same endpoint. This is the tenancy regression test for the whole migration — it must exist.
- [ ] Web: `loadDashboard()` calls the endpoint when in cookie mode.
- [ ] Verify on preview: Pulse renders identically, numbers match production.
- [ ] Commit.

**Done when:** Pulse works with zero direct Supabase calls, and the cross-tenant test passes.

---

### Phase 5 — Coach and Rep

Same pattern, one commit per product.

- [ ] Coach: `commitments` 8, `checkin_items` 4, `goals` 3, `checkins` 2, `checkin_leader` 2, `assessments` 1, plus RPCs `log_structured_checkin`, `set_agent_pause`, `set_coaching`.
- [ ] Rep: `rep_questions_public` 3, `rep_progress` 3, `rep_modules` 3, `rep_practice` 2.
- [ ] `agents` (7) and `orgs` (1) are shared — do them with Coach and re-verify Pulse after.
- [ ] Each product: cross-tenant test, then verify on preview before moving on.
- [ ] Commit per product.

**Done when:** `grep -c "supabase.from\|supabase.rpc"` in `web/src` reaches zero except the public-assessment path.

---

### Phase 6 — The public assessment link, and removing the database key

Last, because it's the only path that must work with no login.

- [ ] `POST /public/assessment/*` wrapping `resolve_join_token`, `resolve_cohort_roster`, `resolve_invite_token`, `submit_cohort_assessment`, `enroll_agent`, `get_agent_home`, `agent_save_checkin`, `agent_toggle_commitment`, `my_agent_token`, `claim_agent`. Treat the join token as the capability, exactly as the database does.
- [ ] Add per-IP rate limiting on these — the only unauthenticated write surface.
- [ ] Test: a valid token works with no cookie; an invalid one is refused; the rate limit trips.
- [ ] Verify the full agent journey on preview: open the link, take the assessment, see the result.
- [ ] **Remove `VITE_SUPABASE_ANON_KEY` from the bundle.** Confirm with a secrets scan that the shipped JavaScript contains zero JWTs.
- [ ] Then `revoke` the anon role's remaining grants and re-run the security advisors.
- [ ] Commit.

**Done when:** the bundle ships no database credential and the agent journey works end to end.

---

### Phase 7 — Cutover

- [ ] Full sweep: both packages' typecheck + tests; every screen on preview; the agent journey; the intake form; act-as.
- [ ] Re-register FUB webhooks onto `api.truhq.co` (Eric runs the script — needs the ops token).
- [ ] Ship with `VITE_AUTH_MODE=cookie`.
- [ ] Watch `wrangler tail` and confirm real webhook traffic plus a real login.
- [ ] If wrong: flip `VITE_AUTH_MODE=token`, rebuild, redeploy. Rehearse this once on preview *before* cutover so it's known to work.
- [ ] A week later: delete the token path, `hq_admin_return`, and the flag.

**Eric's steps:** the DNS record if config can't do it, the FUB re-registration script, the Supabase leaked-password toggle, and the go-ahead on cutover timing.

---

## Self-Review

**Spec coverage:** `api.truhq.co` → Phase 1. CSP + owner-token → Phase 2. Cookie/KV/refresh/CSRF → Phase 3. RLS-preserving proxy → Phase 4. All 39 calls → Phases 4–6. Public assessment + anon-key removal → Phase 6. Rollback flag → Phases 3 and 7. No gaps.

**Risk order:** the two riskiest things — CSP breaking a screen, and the proxy accidentally using the service role instead of the user's token — are both caught by tests/checks inside their own phase rather than at cutover.

**The one thing that would make this a downgrade:** hand-writing tenancy checks in the worker instead of forwarding the user's JWT. Called out in Global Constraints and covered by a cross-tenant test in every data phase.
