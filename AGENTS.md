# TRU Pulse — rules for agents

Read this before you touch anything. It applies to every agent working in this
repo, whatever tool you are running under.

Eric runs several agents at once. These rules exist so two of them can work in
parallel without one quietly undoing the other, and so finished work reaches him
instead of ageing on a branch nobody knows about.

---

## 1. Work in your own folder, on your own branch

Never work in a folder another agent is using, and never work directly on `main`.

```bash
git worktree add ../truhq-<task> -b feat/<task> origin/main
cd ../truhq-<task>
```

A worktree is a second checkout of the same repository. You get your own files;
another agent's edits, stashes and half-finished commits cannot reach you. The
alternative — several agents in one folder — silently mixes their work together.

Branch from `origin/main`, not from whatever the folder happened to be on.

## 2. "Done" means the pull request is open

Committing is not finishing. Pushing is not finishing. **A task is finished when
a pull request exists and Eric can see it.**

```bash
git fetch origin
git rebase origin/main        # catch up before asking anyone to look
npm --prefix web run typecheck && npm --prefix web test   # if you touched web/
git push -u origin feat/<task>
gh pr create --base main --fill
```

If you stop before `gh pr create`, the work is invisible. It has happened before:
branches with thirty commits on them that nobody knew existed, one of which was
never pushed at all and lived only on Eric's laptop.

Say in the PR description **what changed, why, and how you proved it**. If Eric
has to open the diff to find out what you did, the description failed.

## 3. Rebase before you ask, and keep the branch young

Rebase onto `origin/main` immediately before opening the PR, and again if the PR
sits for more than a day.

A branch a day old rebases in seconds. A branch a week old is a project of its
own — and merging one that has fallen far behind can revert other people's work
wholesale. Two branches in this repo reached eighty-two commits behind `main`
that way.

Prefer one unit of work per PR, merged the same day. Small and merged beats
thorough and waiting.

## 4. Give Eric something to look at

He cannot approve what he cannot see. Match the effort to the change:

- **Logic, worker, bug fixes — nothing visual.** Point at the tests. A test that
  fails against the old code and passes against the new one is the proof. Do not
  deploy anything.
- **Visual changes.** Tell him to run `npm --prefix web run dev` and give him the
  route to open. Instant, free, and it is the real app.
- **Needs real data end to end.** Publish a **preview**, which has its own URL and
  does not touch the live site:

```bash
cd web && npm run build
npx wrangler pages deploy dist --project-name tru-pulse-app --branch feat/<task>
```

That serves at `feat-<task>.tru-pulse-app.pages.dev`. Put the link in the PR.

**Before building in a fresh worktree, copy `web/.env.production` into it.** That
file is deliberately not in git. Without it the build silently bakes in a dead
database address: the page loads, and nobody can log in.

## 5. Never deploy to production

`--branch main` is production — it is `app.truhq.co`, with paying customers on
it. Only Eric, or the agent he has designated, publishes there. Preview branches
are yours; production is not.

Deploying is also two publishes, not one, and the worker goes first:

```bash
cd worker && npx wrangler deploy
cd ../web && npm run build && npx wrangler pages deploy dist \
  --project-name tru-pulse-app --branch main
```

Pushing to `main` publishes nothing on its own — this Pages project is
direct-upload. Someone has to run that command deliberately. That is a safety
feature; do not "fix" it.

## 6. Stay in your lane

Work is split by **what it touches**, not by what it does: one agent on the web
app, one on the worker, one on the database. Two agents in different files never
conflict, and when something breaks, the area tells you which agent to look at.

If your task needs a file outside your lane, say so in the PR rather than
reaching across quietly.

## 7. The database is shared, and branches do not protect it

Your branch isolates code. It does **not** isolate Supabase — there is one
database and every agent is pointed at it. A migration or a data change is live
the moment you run it, for everyone, including production.

Never change data or schema as a side effect of a code task. Propose it in the
PR and let Eric decide.
