# Move TRU HQ off browser-stored login tokens onto server-held sessions

**Date:** 2026-08-12
**Status:** awaiting Eric's approval to build
**Scope:** `truhq/pulse` — worker + web

## Why

Today the browser holds the login. A token sits in `localStorage`, and the app's own
code attaches it to every request. Two consequences:

1. **A script on the page can steal the login.** Today nothing can — there is no
   `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` anywhere in the app, so
   React escapes everything. That is the only thing standing between the token and
   an attacker, and it depends on never shipping an injection bug.
2. **The long-lived renewal key is in the browser too.** `hq_admin_return` stores
   Eric's *owner* access **and refresh** token in `localStorage` whenever he is
   acting as a team. A refresh token mints fresh logins for a long time, and this is
   the highest-privilege account in the system.

Eric's decision (2026-08-12): do the full migration rather than a partial hardening.
Growing to ~7 teams and hundreds of agents' personal data, so the ceiling matters
more than the effort. He is currently the only real user — brokers are not on it yet
— so cutover risk is low right now, which is the cheapest this will ever be to do.

## What changes, and what deliberately does not

**Changes:** where the credential lives. It moves from browser storage into an
`httpOnly` cookie the browser cannot read, plus a server-side session record.

**Does NOT change: the security model.** Every row-level policy audited on
2026-08-11 stays exactly as it is and keeps doing the enforcing. The worker calls
Supabase **as the signed-in user**, forwarding their identity, so tenant isolation
is still Postgres's job, not new hand-written checks. This is the single most
important constraint in this document — a version of this migration that
re-implements tenancy in TypeScript would be a downgrade, however modern it looked.

## Architecture

```
browser (app.truhq.co)                worker (api.truhq.co)            Supabase
  │  no token, no database key          │                                 │
  │──── POST /auth/login ──────────────>│── signInWithPassword ──────────>│
  │<─── Set-Cookie: hq_sid (httpOnly) ──│   store tokens in KV            │
  │                                     │                                 │
  │──── GET /data/pulse (cookie sent ──>│── read KV → call as THAT user ─>│
  │     automatically by browser)       │   RLS enforces tenancy ─────────│
```

- **Cookie:** `hq_sid`, opaque random id. `HttpOnly; Secure; SameSite=Lax;
  Path=/`, host-scoped to `api.truhq.co`. No JavaScript can read it.
- **Session store:** Cloudflare KV, keyed by session id, holding the Supabase access
  and refresh tokens. Chosen over putting the tokens inside an encrypted cookie
  because it makes sessions **revocable** — offboard an agent, kill their session.
  With hundreds of agents across seven teams, that matters. The refresh token never
  touches the browser in either design; KV adds revocation.
- **Refresh:** handled entirely server-side. The worker notices an expired access
  token, refreshes with Supabase, updates KV. The browser never participates, which
  is what removes today's tab-focus refresh behaviour as a class of problem.
- **Session state for the UI:** `GET /auth/me` returns who you are. The app can no
  longer inspect a token, and must not try.

## Cross-site request forgery

Cookies are sent automatically, so this becomes a real concern the moment we adopt
them. Three layers, all cheap:

1. `SameSite=Lax` — the browser won't attach the cookie to requests initiated by
   another site. `app.truhq.co` → `api.truhq.co` is same-site (both under
   `truhq.co`), so the app keeps working.
2. **Origin check on every state-changing request.** The allowlist shipped
   2026-08-11 already does this; it graduates from hygiene to load-bearing.
3. Reject any request whose `Origin` is absent on a mutating route, so a
   non-browser caller cannot ride a cookie it never received.

## `api.truhq.co`

Prerequisite, because cookies are per-domain: a cookie for `truhq.co` is never sent
to `workers.dev`. Moving the worker onto the domain Eric already owns costs nothing
and also stops leaking the Cloudflare account name (`eric-b3c`) in every request.

## The public assessment link

An agent reaches the TRU assessment from a link with no login by design, and that
must keep working. It is also the **last public door**: these `SECURITY DEFINER`
functions are callable by anyone holding the anon key that ships in our JavaScript —
`resolve_join_token`, `resolve_cohort_roster`, `resolve_invite_token`,
`submit_cohort_assessment`, `enroll_agent`, `get_agent_home`, `agent_save_checkin`,
`agent_toggle_commitment`, `my_agent_token`, `claim_agent`.

Route them through the worker too, as the final phase. Three wins:

- Rate limiting, validation and logging on the only unauthenticated write surface.
- The link keeps working with no login — the worker treats the join token as the
  capability, exactly as the database does today.
- **The anon key can then be removed from the bundle entirely.** After this phase the
  browser ships no database credential at all. That is the real prize, and it is only
  reachable once every other call has moved.

## Rollback

The old token path stays in the code behind `VITE_AUTH_MODE` (`cookie` | `token`),
defaulting to `cookie` at cutover. A bad cutover is a flag flip and a redeploy of
static assets, not an emergency migration. Delete the old path a week after the
cutover holds.

## Inventory (the actual work)

**21 auth calls** — `getSession` ×4, `signOut` ×3, `getUser` ×3, `signUp` ×2,
`refreshSession` ×2, `verifyOtp`, `updateUser`, `signInWithPassword`,
`signInWithOAuth`, `setSession`, `resetPasswordForEmail`, `onAuthStateChange`.

**33 table calls**, by table: `commitments` 8, `agents` 7, `checkin_items` 4,
`rep_questions_public` 3, `rep_progress` 3, `rep_modules` 3, `goals` 3, `teams` 2,
`rep_practice` 2, `checkins` 2, `checkin_leader` 2, and one each of
`person_stage_log`, `orgs`, `org_settings`, `memberships`, `leads`, `deals`,
`assessments`, `accountability_cases`.

**6 RPC calls** — `claim_agent`, `log_structured_checkin`, `resolve_cohort_roster`,
`set_agent_pause`, `set_coaching`, `submit_cohort_assessment`.

24 calls already route through the worker and are the pattern to copy.

## Out of scope

- Rewriting the app as server-rendered. Not needed; a thin server in front is enough.
- Changing any row-level policy.
- The marketing site and the booking flow, which have their own auth story.

## Also folded in (cheap, and protects during the migration)

- **Content-Security-Policy header** — only run our own code, only send data to our
  own backend. Hardens the exact attack this migration targets, in minutes.
- **Trim `hq_admin_return`** — becomes unnecessary once sessions are server-side;
  the act-as swap happens in the worker.
- **Supabase leaked-password protection** — dashboard toggle, Eric to flip.
