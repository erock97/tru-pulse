# TRU HQ interior redesign — handoff prompt

You are taking over the interior redesign of app.truhq.co — everything past sign-in — for TRU HQ, a coaching platform for real-estate team leaders (modules: Pulse, Coach, Rep, Team; owner-only Admin screens). The public marketing site is a separate effort; do not touch `web/src/site/**`.

## The vision (from Eric, the owner — this is the bar)

A client signs in and thinks: "what I need right now is so clear." Everything on screen feels relevant, powerful, and makes sense. Nothing is noise. It is premium — a $20,000 studio built this — but premium is not the same as plain: if a screen could belong to any other SaaS tool, it is not done. Nothing tacky, nothing corny, professional in design and layout. Clarity first, then presence.

## The visual benchmark — go look at it, do not work from memory

apple.com/apple-vision-pro. Open it before you write a single colour value. What it actually is: a LIGHT, neutral system. White and off-white (`#F5F5F7`) surfaces, near-black text (`#1D1D1F`), grey secondary text (`#6E6E73` / `#86868B`), light-grey rounded cards with one soft shadow, one blue (`#0071E3`) for the single thing that wants a click. Colour lives in what sits behind the glass, not in the glass. Dark is reserved for one cinematic moment, never for the everyday screens. Frosted glass appears only on chrome that floats over content.

Two mistakes have already been made and rejected — do not repeat them: (1) a dark room with dark panels ("dark mode with blur"); (2) a violet/blue/teal lit room. Both came from inventing a palette off a spec sheet instead of looking at the reference. Eric has also said, more than once, that he does not want the old green forest backdrop anywhere. Warmth (ember / terracotta) is allowed only on status — the agent who needs a conversation — never on chrome.

## The real stack — the spec you may have been given is wrong about this

- React 18 + TypeScript + Vite, **plain CSS**. No Tailwind, no animation library, no icon library, no shadcn. Zero UI dependencies. Do not add Clerk: auth is a custom httpOnly cookie set by a Cloudflare Worker at `api.truhq.co` (`web/src/lib/auth.ts`); the browser never holds a database key — that is a deliberate security fix, leave it alone.
- Routing is hash-based (`#/pulse`, `#/coach`, `#/coach/<agentId>`, `#/rep`, `#/team`, `#/learn` for agents). Each page renders its own shell (`web/src/components/hqShell.tsx`; agents use `agentHqShell.tsx`). The ⌘K command bar (`commandBar.tsx`) already exists and works.
- The design system is `web/src/truHqDark.css` (~6,300 lines): every interior page wraps itself in `.tru-dark`, and every rule reads the same custom properties (`--base`, `--card`, `--accent`, `--text`, `--lip`, `--r-card` …).
- The redesign so far lives in ONE file, `web/src/truHqSpatial.css`, imported LAST from `web/src/main.tsx`. It re-points those custom properties, so the whole interior re-themes without editing component CSS, and then overrides the few surfaces whose shape changed. Extend that file; do not fork the component CSS.
- Things that had to be overridden because they were hard-coded dark and will bite you again on new screens: the forest ground + bokeh field (`.tru-shell::before`), the corner vignette (`.tru-shell::after`), the brass plate behind the sidebar (`.side::before`), the room render (`.tru-room`), the table header (`.dk-table .tru-table thead th`), Rep's certification panel (`.rp-journey`), and the plates (`.rs-plate`, `.dk-tile`, `.ad-panel`, `.card`). If a new screen looks grey or muddy, one of these layers is showing through.
- Sidebar: both shells now wrap their contents in `<div className="side-capsule">`; the `aside.side` is an invisible full-height column that centres the capsule.

## How to see it

- `npm --prefix web run dev`, then `http://localhost:5173/?demo=1#/pulse` — demo mode renders every module on sample data with no sign-in. Swap `pulse` for `coach`, `rep`, `team`, or `learn` (agent view). `?site` shows the marketing home instead; ignore it.
- Review each screen at 1440, 1280, 1024 and 390 wide. Screenshot, critique against the vision above, revise. Do not show Eric a login page and call it done — he judges on Pulse and Coach.
- Signed-in review on real data has never worked on localhost or a `*.pages.dev` preview (the session cookie is same-site only); previous agents reviewed signed-in by deploying to the live site. Deploying to app.truhq.co is Eric's call — ask.

## Repo rules (AGENTS.md — read it)

Work in your own git worktree on your own branch from `origin/main`; never on `main`. Done means a PR is open with what changed, why, and how you proved it. `npm --prefix web run typecheck` and `npm --prefix web test` before pushing (one pre-existing failure in `zillowDecks.test.ts` is unrelated). Production is `wrangler pages deploy … --branch main` — never run it unless Eric says so. The database is shared; never change data or schema as a side effect.

## Where it stands

Branch `feat/interior-redesign-plan`, PR #142 on `erock97/tru-pulse`. Done: the light neutral palette across the interior, capsule glass sidebar, glass island and command bar (scale-in 180ms, sentence-case groups), the sign-in door (white glass panel, staggered fields, no backdrop), plates and tables re-pointed. Audit and plan in `docs/interior-redesign/`. Decisions recorded in `.21st/design.json`.

## What's next, in order

1. Module pass, Pulse first: the ALL-CAPS micro-labels (Eric's call — ask), the "watch" rows, the leads-per-contract scale, any remaining green/amber inside components. Then Coach, Rep, Team, then the agent-facing `#/learn` shell (still has its own old background).
2. Global states designed, not defaulted: empty, error, offline, permission-denied, 404.
3. Settings-level screens (Admin, Team) to the same standard.
4. Motion: one orchestrated moment per screen (dashboard first load = the numbers count up — `useCountUp` exists), shared-element transition from a roster row into the agent page, everything else 120–260ms. Never fade-up-on-scroll inside the app. Reduced-motion variant for everything.
5. Fix the routing bug found in the audit, separately: `#/coach/<uuid>` from the command bar changes the URL but keeps rendering the cohort list.
6. A `#/dev/kitchen-sink` route showing every component in every state, and a `DESIGN.md` at the repo root documenting tokens, motion rules and the reasoning, so the next session doesn't re-derive any of this.

## Working with Eric

Plain English. He owns the product and does not carry the code's vocabulary — never ask him to decide on a class name or a hex value; describe what he'll see and what breaks. Give one recommendation, not a menu. When he says something looks wrong, believe him and go look at it in the rendered browser before arguing. Show him modules, not the door.
