# TRU HQ — business site migration

**Date:** 2026-08-09
**Status:** design, awaiting review
**Repo:** `erock97/tru-pulse`, working dir `landing/`, base branch `landing-cinematic`

---

## 1. Why

A LinkedIn post drove real inbound traffic. Eric and his business partner have decided to
route the whole business — coaching, consulting, and software — through TRU HQ. `truhq.co`
today is a software landing page: it sells three SaaS tiers, and every button on it drops a
stranger at a login screen they cannot pass.

`terrasonconsulting.com` is the real business site. It is hosted and paid for by a third party
who is expected to take it down. Terrason Consulting Group remains the legal entity **for
now** and is expected to be replaced within roughly two weeks of this date.

This project moves the Terrason site's substance onto `truhq.co` under the TRU brand, adds the
legal and compliance layer TRU currently has none of, and stops the third-party hosting bill.

**Direction of travel: Terrason content → TRU HQ.** TRU is the destination and the surviving
brand. Nothing moves the other way.

The full source content is archived at
[`docs/terrason-site-archive.md`](../../terrason-site-archive.md) — all eight pages verbatim
plus the June 2026 pricing flier — captured before the old host can remove it.

## 2. Decisions locked in the 2026-08-09 interview

| Question | Decision |
|---|---|
| Consulting vs software | **Consulting first, software included.** The headline sells fractional sales management. Pulse / Coach / Rep appear as tooling included in an engagement, never as a separately priced product. |
| Brand vs legal entity | **TRU is the brand and the surviving identity.** The legal entity is Terrason Consulting Group today and changes within ~2 weeks. Entity name appears *only* where law requires it, and only via a single constant. |
| Case-study metrics | **Directional, not measured.** Carry the work performed; drop every numeric outcome claim. |
| Old domain | Eric controls `terrasonconsulting.com` and its mailboxes; the third party only hosts files. No redirect work in scope. |
| Marketing email | **Build for it now, send later.** Unticked opt-in on the form, consent recorded. No campaigns until a real list tool exists. |
| Phone / SMS | **Do not collect a phone number.** No telephone-consent exposure. |
| Primary call to action | **Apply, or book a call.** The free accountability audit is not the hook. |
| Public pricing | **No dollar figures.** Tiers, team-size bands, and what is included only. |

## 3. Brand and entity naming rule

Two separate things that must never be conflated:

- **The brand** is TRU / TRU HQ. It appears in the logo, nav, headlines, body copy, page
  titles, and the footer wordmark. Anyone reading the site sees only TRU.
- **The legal entity** is whatever is registered. It appears in exactly four places: the
  copyright line, the privacy policy, the terms of service, and the refund policy — because
  contracts and consumer-protection notices must name the contracting party.

Every entity-dependent value lives in **one file**, `web/src/config/business.ts`:

```ts
export const BUSINESS = {
  brand:            'TRU',
  legalEntity:      'Terrason Consulting Group',   // CHANGES ~Aug 2026
  legalAddress:     ['3008 228th St SE', 'Bothell, WA 98021'],
  contactEmail:     'Admin@terrasonconsulting.com',
  governingState:   'Washington',
  governingVenue:   'Snohomish County, Washington',
  policiesUpdated:  'August 2026',
  applyNotifyTo:    ['eric@terrasonconsulting.com', 'Adamt@terrasonconsulting.com'],
  calendly:         'https://calendly.com/adamt-terrasonconsulting',
} as const;
```

No page hardcodes any of these. When the new entity is registered, changing this file updates
the whole site.

**Unfinished-state guard.** The file carries a `PENDING_ENTITY_CHANGE = true` flag and the
build script fails loudly if any of the entity fields still hold a Terrason value *and* the
flag has been cleared — so the site can't ship half-renamed, and can't ship with a stale name
after Eric says the change is done.

**Recommendation, not blocking:** move the public contact address to `hello@truhq.co` before
the entity change so the legal contact matches the brand. It is a one-line change in this file.

## 4. Page inventory

| Path | Purpose | Source |
|---|---|---|
| `/` | Home — the business, the problem, the services, who it's for, the tooling, one CTA | Terrason `/` + TRU product section |
| `/services` | Seven services, four tiers by team size, how an engagement works | Terrason `/services` + pricing flier structure |
| `/work` | Three case studies, de-numbered | Terrason `/work` |
| `/apply` | The application form | Terrason `/apply` + new consent layer |
| `/privacy` | Privacy policy | Terrason `/privacy`, rewritten for the real vendor stack |
| `/terms` | Terms of service | Terrason `/terms` |
| `/refund-policy` | Refund & cancellation policy | Terrason `/refund-policy` |

**Dropped:** `/insights`. It has shipped nothing since May and promises content "in early
summer." An empty room hurts more than a missing one.

**Unchanged:** `app.truhq.co` and everything behind the login. Out of scope entirely.

## 5. Content map

### 5.1 Home

Section order, top to bottom:

1. **Cinematic intro** — unchanged. Existing reveal video, skip button, reduced-motion path.
2. **Hero** — Terrason's positioning in TRU's type treatment.
   Eyebrow: `REAL ESTATE SALES OPERATIONS`.
   Headline: *The operating system behind high-performing real estate teams.*
   Subhead: the "off the owner's plate" paragraph, verbatim from the archive.
   Buttons: **Apply to work with us** → `/apply` · **Book a call** → Calendly.
   The current micro-line "Read-only. Connects to Follow Up Boss. Nothing stored." is
   **removed** — it is a software claim on a consulting hero, and it must not appear anywhere
   it isn't literally true.
3. **The problem** — "You don't have a lead problem…" plus the five arrow items, verbatim.
4. **What we do** — the seven services, condensed to a card each. *See §9, open question 1.*
5. **Who it's for** — Team owners / Sales leaders / Agents, verbatim.
6. **The tooling** — the existing Pulse / Coach / Rep three-card block, reframed. Kick line
   changes from "One system. Not three apps" to something that reads as *included in your
   engagement*. No prices. The "AI call practice & ALMS grading (coming)" bullet is deleted —
   unreleased features do not get advertised.
7. **Closing CTA** — "Build the operating system your team deserves," 30-minute call, no pitch.
8. **Footer** — new. See §7.4.

The audit dashboard card (the animated count-up) is **kept** as a visual proof of the tooling,
inside section 6, with its existing "sample data" labeling made explicit rather than a
small-print aside.

### 5.2 Services

Straight port of the archive: seven numbered services with their full descriptions, the four
tiers, the "why teams hire us" list, "who we work best with," the Investment paragraph, and
the five-step How to engage. Two changes:

- The Investment paragraph keeps "monthly retainer scoped to the tier," adds the per-deal
  payout in words — *a payout on every closed deal, scaled to your market's home values, so
  our upside is tied to your results* — and carries **no numbers**.
- Tier cards gain their team-size band as the card's eyebrow: Up to 10 agents · 10 to 20 ·
  20 to 40 · 40+. Plus the rule from the flier: *your tier is set by active agent count, not
  preference; teams move up at the next billing cycle.*

### 5.3 Work

Same three cards, same layout. The metric eyebrow (`+147% conversion · 90 days`) is replaced
by a neutral scope label (`Brokerage · 24 → 60 agents`). Body copy keeps what was *done* and
drops what it *produced*. `$14M GCI` and `$8.2M added GCI` come out.

A results disclaimer sits directly beneath the three cards — see §6.2.

### 5.4 Apply

Fields carried over exactly: full name, work email, role (four options), team size (five
bands), biggest bottleneck. **No phone field.** Consent layer per §6.3.

## 6. Legal and compliance

This is the part TRU has none of today. `truhq.co` currently publishes no policy, no company
name, no address, and no contact route.

### 6.1 The three policies

Ported near-whole from the archive — they are well-drafted — with these edits:

- Every "Terrason Consulting Group" → `BUSINESS.legalEntity`. Every address, email, state, and
  venue → the corresponding constant.
- Every "terrasonconsulting.com" → `truhq.co`.
- **Privacy policy vendor list rewritten to the truth.** The old policy names Vercel, Vercel
  Web Analytics, and Google Apps Script. The new site uses Cloudflare Pages, Cloudflare Web
  Analytics, Supabase, Calendly, and Stripe. A policy describing the wrong processors is worse
  than no policy — it is an affirmative misstatement.
- The "Sales Process Audit Checklist" is named in three places across the old privacy and
  refund policies. **The new site offers no free download**, so those references become
  generic — "free resources we may offer from time to time" in the refund policy, and the
  privacy policy's *Information we collect* drops "audit" and names only the application form.
  A policy must not describe a deliverable that does not exist.
- `Last updated` → `BUSINESS.policiesUpdated`.
- The cookie section keeps its claim only because Cloudflare Web Analytics is genuinely
  cookieless. **If analytics ever changes, this claim and the no-cookie-banner decision both
  have to change with it.**

Terms and refund policy port with entity, venue, and domain substitution only. Their
substance — the RESPA and licensing-law disclaimer, the not-advice clause, the 30-day
cancellation, the chargeback clause — is sound and stays.

### 6.2 Results disclaimer (new)

Beneath the case studies and anywhere an outcome is described:

> Client examples describe work performed for real engagements. They are illustrative, not a
> prediction or guarantee of results. Outcomes depend on your market, your team, your lead
> spend, and your execution.

### 6.3 Form consent (new)

Under the submit button, two distinct things that must not be merged:

1. **Required notice**, not a checkbox — submitting is the action:
   > By submitting, you agree to our [Terms](/terms) and [Privacy Policy](/privacy). We'll use
   > this to respond to your application. We never sell your information.
2. **Optional marketing opt-in**, a checkbox that is **unticked by default** and never a
   condition of submitting:
   > Send me occasional notes on real estate sales operations. Unsubscribe any time.

The stored record captures the checkbox value, an ISO timestamp, and the exact consent wording
shown at the time — so consent is provable later, which is the whole point of collecting it.

**No marketing email may be sent until** a list tool with a working one-click unsubscribe is in
place and the sender's physical mailing address appears in every message footer. That is a
launch-blocking rule for *sending*, not for shipping the site.

### 6.4 Footer (new, every page)

TRU wordmark · the tagline · `© {year} {legalEntity}` · the mailing address · the contact email
· links to Privacy, Terms, and Refund & Cancellation. This is where the entity name lives in
public, and it is the single largest gap on `truhq.co` today.

### 6.5 Accessibility

Terrason has a skip-to-content link on every page; TRU has none. Baseline for launch: a skip
link, a single `<h1>` per page, real landmark elements, `alt` text on every image, visible
keyboard focus, and colour contrast checked against the gold-on-dark palette. The existing
`prefers-reduced-motion` handling in the intro and hero is already correct and stays.

### 6.6 Claims hygiene

Three things come off the current site because they are claims, not copy:
`$349 / $649 / $999` pricing · `AI call practice & ALMS grading (coming)` ·
`Read-only. Connects to Follow Up Boss. Nothing stored.`
Nothing that describes an unbuilt feature or an unverified behaviour ships.

## 7. Technical design

### 7.1 The constraint

`web/` is one Vite bundle serving both the marketing site (`truhq.co`) and the logged-in
product (`app.truhq.co`). `App.tsx` routes the product on hash fragments (`#/pulse`, `#/rep`,
`#/login`). The marketing site is a single `Landing.tsx`.

**Hash routes are wrong for this job.** `#/services` is not a distinct URL to a search engine,
and a privacy-policy link pasted into a contract or a Stripe account needs to be a real,
stable, shareable address.

### 7.2 The approach: public paths resolved before auth

A new `PublicSite` component owns the seven marketing routes and reads `window.location.pathname`.
`App.tsx` gains exactly one addition, at the very top of the component, before any Supabase
call or session check:

```tsx
const publicPath = matchPublicRoute(window.location.pathname);
if (publicPath) return <PublicSite route={publicPath} />;
```

Consequences, and why this is the safe shape:

- The product continues to live at `/` plus a hash. **Not one line of existing routing logic
  changes.** The hash branch is unreachable from a public path and vice versa.
- A logged-in user who clicks the privacy link gets the policy, not the dashboard — correct.
- Nothing depends on session state, so a marketing page renders with no network round-trip and
  no auth flash.
- Cloudflare Pages needs a `_redirects` SPA fallback (`/* /index.html 200`) so deep links
  resolve. `app.truhq.co` is unaffected because it is only ever entered at `/`.

`Landing.tsx` becomes the home route's body. Its intro/scroll/count-up effects move with it
unchanged.

### 7.3 Application form handling

`POST /apply` on the existing Cloudflare Worker (`worker/src/`):

- Validates and length-caps every field; rejects anything oversized.
- Writes to a new `applications` table in Supabase. **Row-level security denies all client
  reads and writes** — only the Worker's service role touches it, matching how `team_secrets`
  is already handled in this codebase.
- Emails `BUSINESS.applyNotifyTo` — Eric and Adam — with the submission.
- Honeypot field plus a per-IP rate limit. No CAPTCHA: a third-party CAPTCHA would put a
  tracking vendor on the page and break the no-cookie-banner position.
- Returns a plain success state; on failure the form surfaces the Calendly link so a lead is
  never lost to a 500.

Storing submissions is what makes the seven-year retention promise and the deletion right in
the privacy policy actually honourable — today there would be nothing to delete or produce.

### 7.4 Head, indexing, analytics

- Per-route `<title>`, meta description, canonical URL, and Open Graph / Twitter card tags.
  The tab currently reads **"TRU Pulse"** on the marketing site — wrong brand, wrong page.
- `robots.txt` and a `sitemap.xml` covering the seven public paths.
- `Organization` structured data in the footer carrying the entity name and address.
- Analytics moves to **Cloudflare Web Analytics** — cookieless, same privacy posture as the
  Vercel product the old policy described, and it is what keeps §6.1's cookie claim true.

### 7.5 Not breaking the product

- Work happens on `feat/business-site` cut from `landing-cinematic`. `landing-cinematic` is
  not committed to directly.
- Two uncommitted files (`.tru-brain-project.json`, `tru-interior-redesign-plan.md`) are dealt
  with before branching, not swept along.
- The Worker change is additive: one new route, one new table. No existing endpoint, sync job,
  cron, or table is touched.
- Verification before anything is called done — §8.

## 8. Verification

Eric's explicit ask: check the work thoroughly, because plenty in the background can break.

**The product must be provably unbroken.** After every change, on a preview deploy:

1. Logged-out `/` renders the marketing home; the intro plays; skip works.
2. `#/login` still reaches the login screen. Sign-in succeeds.
3. Signed in: the HQ home renders, and Pulse, Rep, Prospect, and Studio each open.
4. Onboarding renders for an org-less account; the agent-course path still resolves.
5. The impersonation banner and its exit button still work.
6. A password-recovery / invite link still lands on set-password.
7. `app.truhq.co` is byte-for-byte behaviourally identical to before.

**The marketing site:**

8. All seven paths load directly (typed into the bar, not navigated to) and on hard refresh.
9. Every internal link and every footer link resolves. No dead route, no `#`-only anchor.
10. The form submits; a row lands in Supabase; both notification emails arrive; the opt-in
    checkbox state and consent text are stored correctly in both the ticked and unticked case.
11. The form's failure path shows the Calendly fallback.
12. RLS proven: an anonymous client and a signed-in non-admin client both fail to read
    `applications`.
13. No dollar figure appears anywhere in the built output. Grep the bundle for `$3,750`,
    `$5,250`, `$6,750`, `$349`, `$649`, `$999`, `$8.2M`, `$14M`, `147%`, `3.1×`.
14. No "Terrason" string appears outside `business.ts` and the archive doc. Grep to prove it.
15. Every page: one `<h1>`, a skip link, a correct title, and a footer.
16. Keyboard-only pass through the form. Reduced-motion pass on the home page.
17. Mobile: the square intro reveal path still triggers under 760px.
18. Lighthouse on the home and services pages before/after, for regressions only.

## 9. Review outcome — 2026-08-09

Spec approved by Eric. Resolutions:

1. **Seven services on the home page.** Confirmed — matches the services page and the flier.
2. **Four packages, confirmed.** Essentials · Performance · Performance+ · Mega Team. The
   canonical source is *Terrason Pricing Flier (1).pdf* in Eric's Google Drive
   (`1PDBKJDI9suAoqOC9lYeJ9MMh64HkJLoo`, 2026-06-24), transcribed at the end of the archive
   doc. Tier names, team-size bands, and the seven included services come from there. Dollar
   figures do not ship.
3. **Governing law: Washington, Snohomish County. Locked** — stays put through the entity
   change, so `governingState` / `governingVenue` are stable even when `legalEntity` changes.
4. **Contact address.** `Admin@terrasonconsulting.com` ships unless a `truhq.co` mailbox goes
   live first. One constant either way.

## 10. Out of scope

Redirecting or preserving `terrasonconsulting.com`. Anything behind `app.truhq.co`. Redesigning
the visual system, the animations, or the brand. Building a newsletter or sending any
marketing email. Publishing pricing. Registering the new entity or drafting the client
services agreement.
