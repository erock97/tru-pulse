# TRU HQ — owner intake form + 1:1 session persistence

**Date:** 2026-08-11
**Status:** approved design, ready for planning
**Branch:** `feat/hq-intake-and-1on1-persistence` (off `origin/main` @ a04e0f7)

Two independent pieces of work in one spec. They share no code and can ship in
either order.

- **Part 1 — Owner intake form.** TRU HQ is sold by hand, not self-serve. Eric
  needs to create a brokerage himself from an API key and have its team leaders
  emailed a set-your-password link.
- **Part 2 — 1:1 session persistence.** Switching to another browser tab and
  coming back tears down the whole app and drops the leader back at the top of
  the team list mid-1:1.

---

## Part 1 — Owner intake form

### Why the current flow doesn't work

Today provisioning is **self-serve and leader-initiated**: a leader signs up,
lands on `Onboarding.tsx`, and types the org name plus their own Follow Up Boss
key. That inverts the real sales motion — Eric holds the key and the
relationship, and the leaders should receive a finished account.

There is also a **completeness gap** in the existing server-side path.
`worker/src/provision.ts` writes `orgs`, `memberships`, `org_settings`, `teams`,
and `team_secrets`. It does **not** write:

| Missing | Consequence |
|---|---|
| `leaders` row | Coach's `current_team_id()` returns null → the whole Coach product is broken for that tenant |
| `entitlements` rows | Pulse/Coach not marked enabled for the org |
| FUB webhook registration | Team silently falls back to cron-only freshness |
| First full sync | Dashboard is empty until the next cron |

The Coach-side signup RPC `create_team()` (`db/hq_coach_compat.sql`) *does*
write `leaders` and `entitlements`. So the two provisioning paths have drifted,
and `provision()` is the incomplete one. Intake must do the complete job.

### Where it lives

A new owner-only screen in TRU HQ, reached from the existing platform-owner
home — the same surface that already renders the act-as leader picker
(`App.tsx` → `shell({id:'hq'}, admin)` when `org === null` and `adminLeaders()`
returns rows).

Authorization reuses the existing gate verbatim: every `/admin/*` route
verifies the caller's Supabase token, then requires a row in the `admins`
table. No new auth surface, no shared secret.

### The form

| Section | Fields | Rules |
|---|---|---|
| Brokerage | Name | Required |
| FUB accounts (repeatable, ≥1) | Account name, API key, optional subdomain | Both required per row — Eric chose to always require the key |
| Team leaders (repeatable, ≥1) | Name, email, team | Team selector only rendered when >1 FUB account; otherwise implicit |

Client-side validation before submit: non-empty brokerage, ≥1 complete team,
≥1 leader with a syntactically valid email, no duplicate leader emails.

### Server: `POST /admin/intake`

One call, ordered so a failure can never leave a half-built tenant that looks
finished.

1. **Validate** the whole payload. Reject with 422 before any write.
2. **Create the tenant** — extend `provision()` to take
   `members: Array<{ userId, role }>` instead of a single `userId`, and to also
   write `leaders` and `entitlements`. The existing `/provision` route maps its
   single-user body into the new shape, so the self-serve path keeps working and
   the two paths stop drifting.

   `provision()` also **stops encrypting and storing FUB keys**. It creates
   tenant rows only (`orgs`, `memberships`, `leaders`, `entitlements`,
   `org_settings`, `teams`) and returns the new team ids. Key storage moves
   entirely to step 4, so there is exactly one code path that puts a key on a
   team. Without this, intake would upsert `team_secrets` twice — once in
   `provision()` and again in `connectTeamKey()`.

   The `/provision` route is updated to call `connectTeamKey()` per team after
   `provision()` returns. This is a **latent fix for self-serve too**: today
   that path stores the key without ever registering FUB webhooks, so
   `Onboarding.tsx`'s tenants are silently cron-only. After this change both
   paths get webhooks and a first sync.
3. **Mint each leader's login** via Supabase `admin/generate_link` with
   `type: 'invite'` — this creates the auth user *and* returns the action link
   in one call. Reuses the exact pattern already proven in `/rep/invite`. A
   leader whose email already has an auth user gets `type: 'recovery'` instead,
   so re-running intake for an existing person is safe.
4. **Bring each team's data online** by calling the existing
   `connectTeamKey()` helper — encrypt → upsert `team_secrets` → register FUB
   webhooks → background full sync via `ctx.waitUntil`. Deliberately reusing
   this instead of `provision()`'s inline encryption, so admin-on-behalf and
   self-serve connect stay identical.
5. **Email each leader** their link through Resend.

Returns per-leader status so the UI can distinguish "invited" from "created,
email failed".

### Two leaders, two logins

Chosen over a shared account. Each leader gets their own auth user, their own
`memberships` row on the org, and their own `leaders` row pointing at their
team. Both see an identical team; the 1:1 record attributes who ran it.

This is native to the schema, not a workaround — `memberships` is unique on
`(org_id, user_id)`, and `leaders.id` is the auth user id, so two `leaders`
rows can share one `team_id`.

**Known limitation, accepted:** `leaders.team_id` is a single column, so a
leader is pinned to one team for Coach purposes. A brokerage with two FUB
accounts and one leader who oversees both will have that leader see only their
assigned team in Coach. Out of scope; revisit if a real tenant hits it.

### Email

- **New setting `INVITE_FROM`, set to `TRU HQ <hq@truhq.co>`.**
- **`BRIEF_FROM` is not read, written, or otherwise touched by this work.**
  It is the sender for the reports that reach Eric and his team leaders
  (hustle score, PCVR), those reports are confirmed arriving, and they must
  keep working. Two independent senders so an invite failure cannot affect
  reporting.
- Resend has exactly one verified domain, `truhq.co`. Any other domain is
  rejected *silently*, so every sender must be `@truhq.co`.
- Separately: `worker/src/env.ts` and `worker/wrangler.toml` still document
  `BRIEF_FROM` with a `trucoaching.co` example. That domain was retired
  2026-08-09. Fix the **comments only** — the live secret value is correct, as
  proven by the reports arriving.

The email lands the leader on the **existing** `SetPassword.tsx`, which already
handles an invite/recovery token in the URL hash. No new page.

Invite links are single-use and expire in 24 hours, so the intake result screen
offers **Resend invite** per leader, branching invite/recovery on whether the
auth user already exists.

### Failure handling

Validation happens before any write, so a bad payload writes nothing. Past that
point the tenant is real, and a failed email must not roll it back — Eric would
have no idea what state things were left in. Instead each leader reports its own
outcome (`invited` / `email_failed` with a copyable link), and the team is
usable either way. FUB webhook registration stays best-effort-but-logged,
matching `connectTeamKey`'s existing behavior.

---

## Part 2 — 1:1 session persistence

### Root cause

`supabase-js` v2 auto-refreshes its token when the tab regains visibility, and
emits an auth event when it does. `App.tsx` treats every such event as a
possible identity change:

```ts
supabase.auth.onAuthStateChange((event, s) => {
  setSession(s);            // ← brand-new object identity on every refresh
  ...
});

useEffect(() => {
  ...
  setOrg(undefined);        // ← wipes org
  myOrg().then(setOrg);
}, [session]);              // ← re-runs, because `session` is a new object
```

With `org === undefined`, `App` renders the spinner branch
(`if (session === undefined || (session && org === undefined))`), which
**unmounts `Coach` entirely**. When `myOrg()` resolves, `Coach` mounts fresh.

So returning from a Follow Up Boss tab is, to the app, indistinguishable from a
cold login. That is the flash Eric sees, with no actual refresh involved.

### Why typed answers survive but the leader still loses their place

The 1:1 form already persists every keystroke to `localStorage` under
`pulse:1on1draft:<agentId>`. That text is not lost.

But **which agent is open is `Coach`'s local `openId` state**, held nowhere
else. On remount it resets to `null` → the roster renders → the leader is at
the top of the team list, with their typed answers sitting invisibly behind an
agent they'd have to click back into. `useReveal([roster, openId])` replays the
entrance animations, completing the "just opened the app" impression.

### Three fixes

1. **Don't rebuild on token refresh.** Compare the incoming `session.user.id`
   to the current one and only reset `org` when the actual user changes. A token
   refresh becomes a no-op. This alone stops the unmount and the flash.
2. **Put the open agent in the hash route** (approved). `#/coach/<agentId>`
   drives `openId`, so a real refresh, the back button, and a bookmark all land
   back in that agent's sheet instead of the team list.
3. **Restore scroll position per agent.** Save on scroll (debounced), restore
   on mount, so returning lands on the same line rather than the top.

Each addresses a different way the leader loses their place, so all three ship
together: (1) covers tab switching, (2) covers refresh and back, (3) covers
where on the page they were.

### Verification

The acceptance test is Eric's own description: open a 1:1, fill in part of it,
switch to another tab, come back — the screen has not moved, nothing has
re-animated, no spinner appeared. Plus: a hard refresh mid-1:1 returns to the
same agent's sheet.

Automated coverage is a unit test that the auth handler ignores a
same-user token refresh (no `org` reset), which is the actual regression risk;
the scroll and route behavior are verified by hand in the real app.

---

## Out of scope

- Billing, plans, or self-serve signup.
- Any change to `BRIEF_FROM` or existing report delivery.
- Letting one leader span multiple teams in Coach.
- Retiring the self-serve `Onboarding.tsx` flow — it keeps working as the
  fallback for a leader who somehow signs up directly.
