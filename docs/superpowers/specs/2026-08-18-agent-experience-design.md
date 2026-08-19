# The agent experience — invite to home screen — design spec

**Written** 2026-08-18. **Owner:** Eric Matthews · **Repo:** `~/Desktop/truhq/pulse` ·
**Deploys to:** app.truhq.co · **Branch at time of writing:** `rep-training-library-wip`

Companion to `2026-08-14-rep-training-library-design.md`, which covers the *content* side of
Rep. This one covers the *person* side: what an agent walks into, in what order, from the
moment their team lead invites them.

---

## 1. The ask, stated plainly

An agent's whole experience today is one screen. They log in and land in `AgentCourse` — the
training shelf — and that is the entire application as far as they are concerned. There is no
home, no sense of what to do today, no visible connection to the coaching their lead is doing
with them, and the personality assessment lives outside the account entirely on a public link.

The ask is a real arrival: an invite that lands somewhere, a first task that must be done, and
then a home screen that answers "what am I supposed to be doing" every time they log in.

Two things follow that are not features but are the reason for the work:

1. **Eric cannot see the agent view.** There is no impersonation for agents, so the person who
   owns this product has never looked at it through the eyes of the people who use it. Nothing
   else in this spec can be judged until that exists.
2. **This is a paid-consulting inclusion, not a product tier.** Teams get it because they pay
   for consulting. There is no seat cap and no upsell anywhere in the flow.

---

## 2. What exists today

More than it feels like from the outside.

**Invite plumbing — done.** `POST /rep/invite` (`worker/src/index.ts:788`) takes an agent id,
mints a Supabase `invite` link for a new agent or a `recovery` link for a re-invite, and emails
it via Resend (`INVITE_FROM`, must be `@truhq.co`). `App.tsx` redeems the one-time token against
`/auth/exchange`, strips it from the address bar, and renders `SetPassword`.

**Agent identity — done.** After login, `claimAgent()` links the auth user to their `agents` row
by verified email, then `myAgent()` resolves it. An agent is simply a signed-in user with no org
and no admin row (`App.tsx:154-158`).

**The course — done, and good.** `AgentCourse.tsx` (1016 lines) has an internal `home` view
(module shelf grouped into tracks), lesson player, quiz, result, live sim, and an agent-safe 1:1
recap (`MyOneOnOnes`) that renders only date, met, wins and the agent's own commitments — never
`checkin_leader`.

**Quiz grading — done.** `gradeQuiz()` / `POST /rep/grade`, with `rep_questions_public`
withholding the correct answer from the browser. Whatever "homework" becomes later, the grading
machine is already built.

**Slide decks in-app — done.** `LessonCard` supports `t:'slide'` with `deck` + `slide` pointing
at `/public/decks`, rendered natively by `SlideDeck.tsx`. No download path exists, which is the
behaviour we want.

**Leader roster — largely done.** `Rep.tsx` (1050 lines) already has the certification gauge,
searchable roster, per-agent drill-down and sign-off.

**Impersonation — done for leaders, absent for agents.** `POST /auth/act-as` and
`/auth/act-as/return` (`worker/src/authRoutes.ts:359,419`) let a platform owner enter a leader's
session and come back. It resolves the target by email and is guarded server-side.

**The assessment — exists, but detached.** `Assess.tsx` (391 lines) runs off a public
`#/assess?t=<join_token>` link with no auth. Its `RegisterFlow` ends by offering to create an
account so the person can revisit their result. So there are two ways into the platform today and
they do not meet — §3.4 closes the second one.

---

## 3. The flow being built

### 3.1 Invite

A team lead or a TRU admin adds the agent (name + email) and sends the invite from inside the
app. No seat cap, no approval step, no cost check. Leads invite through their own account.

*No new backend.* `/rep/invite` already does this. The work is making sure the lead-side control
is present and obvious wherever leads manage their roster.

### 3.2 Set a password — and nothing else

The invite lands on `SetPassword`. The agent sets a password and is in.

We deliberately do **not** ask for name, phone, or a profile. The lead already typed the name and
email when they created the agent row, and every extra field is a place to lose someone on day
one. Accepted risk: a name the lead misspelled stays misspelled until someone fixes it lead-side.

### 3.3 A short welcome walkthrough, once

Two or three screens: what this platform is, what the team expects of them, what happens next.
Shown once, on first login, never again. Dismissible only by finishing it.

**Open item — Eric writes the copy.** Nothing ships here until those words exist; placeholder
onboarding copy is worse than none.

### 3.4 The assessment gate

The personality assessment becomes the first and only thing a new agent can do. Home, Coach and
Rep are all visible but locked behind it. This is a hard gate: no skip, no dismiss.

**One front door.** The invite is the only way in. The assessment is taken inside the account,
the result attaches to the agent's existing row, and the gate lifts.

There are **three** doors open today, not two, and closing them costs less than it first looked:

1. **The invite** — the one that stays.
2. **Self-serve signup at the end of the public assessment** — `RegisterFlow` calls `signUp()`
   with any email, and `claim_agent()` then binds that login to whichever agent row shares the
   address (`db/hq_rep_agent.sql:29-44`, no confirmation check). This closes. It is the door
   worth closing on security grounds alone.
3. **The legacy token portal** — `get_agent_home`, `enroll_agent`, `agent_save_checkin` and
   `agent_toggle_commitment` are granted to `anon` and reachable through `/public/*` with an
   agent's `token` UUID and no login at all (`db/hq_coach_compat.sql:207-239`). Nothing in this
   app calls them; they are left over from the old site. This closes too.

The consequence that is *not* a cost: the public assessment link never created agents anyway —
`submit_cohort_assessment` requires the person to already be a `coaching_enabled` member of the
team owning the token, and raises otherwise. So closing door 2 does not remove the ability to
assess someone who isn't on a roster; that ability never existed.

The consequence that is real: the emailed assessment link stops being a way to *get an account*.
Anyone who needs one gets invited.

Existing assessment results taken through the old public link stay valid and satisfy the gate for
whoever they belong to.

**Existing agents are not gated.** Anyone with an account today keeps working as they do now. The
gate applies to accounts created from this point forward.

### 3.5 Home — what to do today

The landing screen on every login after onboarding. Three things:

- **Commitments** — what they committed to, entered by their lead during the one-on-one from what
  the agent gave them. The agent does not set these; they can check them off.
- **Pacing** — how they are tracking against those commitments. Measured in **outcomes**
  (appointments held, agreements, closings), deliberately not activity counts. Eric's call:
  activity tracking makes this ridiculous to maintain.

  Pacing is counted against the commitments themselves — how many of the outcomes they
  committed to they have hit — not derived from FUB. The `deals` table keys on `agent_name`
  as free text (`db/hq_deals.sql:18`), so attaching closings to a person is a name match, and
  a name match is too fragile to sit under a number an agent reads every morning. Revisit if
  deals ever carry an agent id.
- **What's next** — any training waiting on them.

**The dependency worth stating out loud:** Home is only as alive as the one-on-one habit. If a
lead does not enter commitments, this screen is empty and the agent's whole experience regresses
to "browse training." Empty-state copy must say that plainly and point at their lead.

### 3.6 Coach — their side of the coaching

- Their assessment result and what it means: profile, how they're best coached, strengths and
  blind spots. This is real content on day one with no performance data required, which is why
  the assessment is the gate rather than a nice-to-have.
- Wins and commitments from their one-on-ones — the existing `MyOneOnOnes` surface.
- The lead's private section stays private. That boundary already exists in the data model
  (`checkin_items` vs `checkin_leader`) and must not be softened.

### 3.7 Rep — the training library

Everything open, browse freely, nothing locked in sequence. A veteran joining mid-season should
not have to click through the basics to reach what they need.

Slide decks from live sessions read in the app, page by page. **No downloads.** The primary job
of the library for launch trainings is replay and reference: an agent who sat through Day 1
Zillow Preferred can come back and re-read what was covered.

**Required vs self-paced.** Eric marks modules himself. Two groups:

- **Required to launch** — the Zillow Preferred onboarding set. These are instructor-led; the
  platform is the archive, not the teacher.
- **Everything else** — uploaded as available, taken if wanted.

Marking is **display only**. The platform does not gate anything on it. Whether an agent is
eligible to take leads on a team roster is decided by Eric and the lead off-platform. No "ready
to launch" checklist, no traffic light, no automated nudges or stall emails — the launch
trainings are taught live, so attendance is already known to a human.

**Homework quizzes are deferred.** The grading machinery stays where it is, unused for new
modules, until Eric has written questions worth asking. Multiple choice, graded instantly, no
lead sign-off in the loop when it does land.

### 3.8 Leader roster view

Leads see full training progress for their people — who finished what, who has stalled, scores.
Mostly built in `Rep.tsx`; the work is confirming it covers everything above and reads clearly.

### 3.9 View as agent

Extend the existing act-as mechanism to agents so Eric can enter an agent's session and see
exactly their home, coach and training views, then return.

Same server-side guard as the leader path: resolve by email, verify the caller is entitled, never
let an impersonated session start another impersonation.

**Open item:** whether team leads get this or only platform admins. Recommendation: admins only
to start. A lead seeing an agent's view is a trust question, not a technical one.

---

## 4. What this deliberately does not do

- No phone or profile capture at signup.
- No launch gating, no automated chase emails, no stall alerts.
- No new homework or quiz authoring.
- No changes for agents who already have accounts.
- No lead sign-off step in the completion path.
- No file downloads of decks.

---

## 5. Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| One-on-one commitments not entered | Home screen is permanently empty; the whole flow feels dead | Honest empty state; leads' roster view shows which agents have no commitments |
| Retiring self-serve signup | Someone mid-flight on the public link can no longer create their own login | Accepted — one front door is the decision. The assessment still saves; the account comes from an invite |
| Old public-link results | A gate that re-fires on someone who already did the assessment | Treat any stored result for that agent as satisfying the gate, whichever entrance produced it |
| Welcome copy never written | Blocks the onboarding sequence | Build the walkthrough shell to take content; ship the rest without it if needed |
| Hard gate on day one | An agent bounces before ever seeing the product | Accepted by Eric; the assessment is short and produces something they immediately get value from |

---

## 6. To verify at build time

- Does anything today actually surface a stored assessment result to the agent who took it?
  `Assess.tsx:360` promises "sign in any time to revisit your result" — confirm that promise is
  currently kept, and if not, §3.6 is building it rather than reusing it.
- Where the lead-side "invite agent" control lives today, and whether every lead can reach it.
- Whether `rep_progress` alone is enough for the roster view in §3.8.
- Whether the required/self-paced marking belongs on `rep_modules` or on the track grouping
  introduced by the training-library spec.
- Whether this project's JWTs expose `email_verified` at the top level or under `user_metadata`
  — the hardened `claim_agent()` checks both, but confirm one of them actually fires before
  trusting the guard.
