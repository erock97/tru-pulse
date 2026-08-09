# TRU HQ Business Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `truhq.co` from a software landing page into the TRU business site — consulting-first positioning ported from Terrason, four packages by team size with no prices, an application form, and the full legal layer the site has none of today — without altering one line of the logged-in product's behaviour.

**Architecture:** `web/` is a single Vite bundle serving both the marketing site (`truhq.co`) and the product (`app.truhq.co`). The product routes on hash fragments (`#/pulse`). Marketing pages get real paths (`/services`) resolved by a new `PublicSite` component that `App.tsx` consults at exactly two surgical touch points — before any auth logic for the six sub-paths, and inside the existing logged-out branch for the home page. The root path `/` deliberately does **not** short-circuit, so a logged-in user at `app.truhq.co/` still gets their dashboard. The application form posts to a new public route on the existing Cloudflare Worker, which writes to a deny-all Supabase table and notifies via Resend (already wired for the weekly brief).

**Tech Stack:** React 18 · Vite 5 · TypeScript 5.7 · Cloudflare Pages + Workers · Supabase (Postgres + RLS) · Resend · Vitest

**Spec:** [`docs/superpowers/specs/2026-08-09-truhq-business-site-design.md`](../specs/2026-08-09-truhq-business-site-design.md)
**Source content:** [`docs/terrason-site-archive.md`](../../terrason-site-archive.md) — all Terrason copy, verbatim, committed. When a task says "port verbatim from the archive," that file is the authority. Do not paraphrase it and do not re-fetch the live site.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Direction of travel:** Terrason content → TRU HQ. TRU is the surviving brand. Nothing moves the other way.
- **No dollar figures anywhere in shipped output.** Not `$3,750`, `$5,250`, `$6,750`, `$349`, `$649`, `$999`, `$8.2M`, `$14M`. Not `147%`, not `3.1×`.
- **No "Terrason" string anywhere outside `web/src/config/business.ts` and the archive doc.**
- **Never edit the product's routing.** `App.tsx` gets exactly the two additions described in Task 4. The hash-route branches, session logic, admin/agent resolution, impersonation banner, and `SetPassword` path are untouched.
- **Never edit an existing Worker route, table, cron, or sync path.** Task 10 is purely additive.
- **Do not change the visual system.** No new fonts, colours, spacing scale, or animations. Reuse the existing classes in `web/src/pages/Landing.css` (`.wrap`, `.panel`, `.band`, `.kick`, `.h2`, `.sub`, `.reveal`, `.d1`–`.d3`, `.cta`, `.pea`, `.tier`, `.tname`, `.td`, `.badge`, `.note`). Add classes only where a genuinely new element exists.
- **No claim ships that isn't literally true.** No unreleased features, no unverifiable metrics, no privacy claim the stack doesn't honour.
- **Branch:** all work on `feat/business-site`, cut from `landing-cinematic`. Never commit to `landing-cinematic`.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`).
- **Every task ends green:** `cd web && npm run typecheck` passes, and `npm test` passes once Task 1 introduces it.

---

### Task 1: Branch, business config, and the unfinished-state guard

Everything entity-dependent lives in one file so the entity change in ~2 weeks is a single edit. The guard makes it impossible to ship a half-renamed site, or to ship a stale name after Eric says the rename is done.

**Files:**
- Create: `web/src/config/business.ts`
- Create: `web/scripts/verify-business-config.mjs`
- Create: `web/src/config/business.test.ts`
- Modify: `web/package.json` (add vitest, `test` script, extend `build`)

**Interfaces:**
- Consumes: nothing.
- Produces: `BUSINESS` (frozen const object) and `PENDING_ENTITY_CHANGE: boolean`, imported by Tasks 3, 5, 6, 7, 8, 9, 12.

- [ ] **Step 1: Cut the branch and deal with the untracked files**

Two untracked files sit in the working tree (`.tru-brain-project.json`, `tru-interior-redesign-plan.md`). They are unrelated to this work and must not be swept into a commit.

```bash
cd /c/Users/ericg/Desktop/truhq/landing
git status --short
printf '\n.tru-brain-project.json\n' >> .gitignore
git checkout -b feat/business-site
git add .gitignore && git commit -m "chore: ignore local tru-brain project file"
```

Leave `tru-interior-redesign-plan.md` untracked and untouched — it is not ours to delete.

- [ ] **Step 2: Add vitest to the web package**

`web/` currently has no test runner. Add one; the Worker already uses vitest 2.1 so match it.

```bash
cd web && npm install -D vitest@^2.1.0
```

Then edit `web/package.json` so `scripts` reads:

```json
  "scripts": {
    "dev": "vite",
    "build": "node scripts/verify-business-config.mjs && vite build && node scripts/verify-public-assets.mjs",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Write the failing test**

Create `web/src/config/business.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUSINESS, PENDING_ENTITY_CHANGE } from './business';

describe('BUSINESS config', () => {
  it('brands the site TRU, not the legal entity', () => {
    expect(BUSINESS.brand).toBe('TRU');
    expect(BUSINESS.siteUrl).toBe('https://truhq.co');
  });

  it('carries every value the legal pages interpolate', () => {
    for (const key of [
      'legalEntity', 'contactEmail', 'governingState', 'governingVenue', 'policiesUpdated',
    ] as const) {
      expect(BUSINESS[key], `${key} must not be empty`).toBeTruthy();
    }
    expect(BUSINESS.legalAddress.length).toBeGreaterThan(0);
  });

  it('locks the governing venue to Snohomish County through the entity change', () => {
    expect(BUSINESS.governingState).toBe('Washington');
    expect(BUSINESS.governingVenue).toBe('Snohomish County, Washington');
  });

  it('flags that the legal entity is still the outgoing one', () => {
    // Flips to false only when the new entity is registered and filled in.
    expect(PENDING_ENTITY_CHANGE).toBe(true);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd web && npm test`
Expected: FAIL — `Failed to resolve import "./business"`.

- [ ] **Step 5: Write the config**

Create `web/src/config/business.ts`:

```ts
// Every entity-dependent value on the public site lives here and nowhere else.
//
// TRU is the brand and the surviving identity. The legal entity below is the
// OUTGOING one — it is expected to be replaced around August 2026. When the new
// entity is registered: update the fields, set PENDING_ENTITY_CHANGE to false,
// and `npm run build` will verify no stale name survived.
//
// The brand appears everywhere a human reads. The legal entity appears in exactly
// four places, because the contracting party must be named: the footer copyright,
// the privacy policy, the terms of service, and the refund policy.

export const BUSINESS = {
  brand: 'TRU',
  brandFull: 'TRU HQ',
  tagline: 'The operating system for real estate team leaders',

  legalEntity: 'Terrason Consulting Group',
  legalAddress: ['3008 228th St SE', 'Bothell, WA 98021'],
  contactEmail: 'Admin@terrasonconsulting.com',

  // Locked — stays put through the entity change (confirmed 2026-08-09).
  governingState: 'Washington',
  governingVenue: 'Snohomish County, Washington',

  policiesUpdated: 'August 2026',

  siteUrl: 'https://truhq.co',
  appUrl: 'https://app.truhq.co',
  calendly: 'https://calendly.com/adamt-terrasonconsulting',
} as const;

// True while `legalEntity` still names the outgoing company. The build guard
// refuses to ship a stale name once this is false.
export const PENDING_ENTITY_CHANGE = true;
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `cd web && npm test`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the build guard**

Create `web/scripts/verify-business-config.mjs`:

```js
// Refuses to build a half-renamed site.
//
// While PENDING_ENTITY_CHANGE is true, the outgoing entity name is expected and
// allowed. Once it is set to false — meaning "the new entity is registered and
// filled in" — any surviving mention of the old one is a bug that would put the
// wrong contracting party on the privacy policy, so the build fails loudly.
import { readFileSync } from 'node:fs';

const path = new URL('../src/config/business.ts', import.meta.url);
const src = readFileSync(path, 'utf8');

const pending = /PENDING_ENTITY_CHANGE\s*=\s*true/.test(src);
const stale = [...src.matchAll(/^.*terrason.*$/gim)].map((m) => m[0].trim());

if (!pending && stale.length) {
  console.error('\n  Business config still names the outgoing entity, but');
  console.error('  PENDING_ENTITY_CHANGE is false. Fix these lines:\n');
  for (const line of stale) console.error(`    ${line}`);
  console.error('\n  Then rebuild.\n');
  process.exit(1);
}

if (pending) {
  console.warn('  business.ts: legal entity change still pending — shipping the outgoing name.');
}
```

- [ ] **Step 8: Prove the guard works in both directions**

```bash
cd web
npm run build                                     # passes, prints the pending warning
sed -i 's/PENDING_ENTITY_CHANGE = true/PENDING_ENTITY_CHANGE = false/' src/config/business.ts
npm run build                                     # MUST fail, listing the stale lines
sed -i 's/PENDING_ENTITY_CHANGE = false/PENDING_ENTITY_CHANGE = true/' src/config/business.ts
npm run build                                     # passes again
git diff --exit-code src/config/business.ts       # confirms the file is back to normal
```

Expected: second build exits non-zero and names the offending lines; third build succeeds; `git diff` is clean.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/src/config/business.ts \
        web/src/config/business.test.ts web/scripts/verify-business-config.mjs
git commit -m "feat: single-source the business identity with a rename guard"
```

---

### Task 2: Public route matching

The one piece of real logic on the marketing side, and the one place a mistake would break the product. It gets tests first.

**Files:**
- Create: `web/src/lib/routes.ts`
- Create: `web/src/lib/routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PUBLIC_ROUTES: readonly PublicRoute[]` — the seven paths, `'/'` first.
  - `type PublicRoute = '/' | '/services' | '/work' | '/apply' | '/privacy' | '/terms' | '/refund-policy'`
  - `matchPublicRoute(pathname: string, hash: string): Exclude<PublicRoute, '/'> | null` — used by Task 4 in `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchPublicRoute, PUBLIC_ROUTES } from './routes';

describe('matchPublicRoute', () => {
  it('matches every public sub-path', () => {
    for (const p of ['/services', '/work', '/apply', '/privacy', '/terms', '/refund-policy']) {
      expect(matchPublicRoute(p, '')).toBe(p);
    }
  });

  it('tolerates a trailing slash and mixed case', () => {
    expect(matchPublicRoute('/services/', '')).toBe('/services');
    expect(matchPublicRoute('/Privacy', '')).toBe('/privacy');
    expect(matchPublicRoute('/REFUND-POLICY/', '')).toBe('/refund-policy');
  });

  // THE CRITICAL CASE. The product lives at "/" plus a hash. If root ever
  // short-circuited to the marketing site, every logged-in user at
  // app.truhq.co would get the marketing home instead of their dashboard.
  it('never claims the root path', () => {
    expect(matchPublicRoute('/', '')).toBeNull();
    expect(matchPublicRoute('', '')).toBeNull();
    expect(matchPublicRoute('/', '#/pulse')).toBeNull();
  });

  it('yields to the product whenever an app hash route is present', () => {
    for (const h of ['#/pulse', '#/rep', '#/prospect', '#/studio', '#/login', '#/learn']) {
      expect(matchPublicRoute('/services', h)).toBeNull();
    }
  });

  it('still matches when the hash is an in-page anchor, not an app route', () => {
    // Landing.tsx links to #audit, #loop, #cta — these must not be mistaken
    // for product routes.
    expect(matchPublicRoute('/services', '#cta')).toBe('/services');
    expect(matchPublicRoute('/work', '#top')).toBe('/work');
  });

  it('returns null for anything unknown', () => {
    for (const p of ['/insights', '/pricing', '/services/extra', '/assets/x.png', '/apply.php']) {
      expect(matchPublicRoute(p, '')).toBeNull();
    }
  });

  it('exposes all seven routes with root first', () => {
    expect(PUBLIC_ROUTES).toHaveLength(7);
    expect(PUBLIC_ROUTES[0]).toBe('/');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test`
Expected: FAIL — `Failed to resolve import "./routes"`.

- [ ] **Step 3: Write the matcher**

Create `web/src/lib/routes.ts`:

```ts
// The marketing site's real URLs. The PRODUCT lives at "/" plus a hash route
// (#/pulse, #/rep, …) and must never be intercepted, so:
//
//   1. matchPublicRoute never claims "/" — the home page is rendered by App's
//      existing logged-out branch, which leaves logged-in users alone.
//   2. Any "#/"-style hash means the product is being addressed; yield to it.
//      A bare "#anchor" is an in-page link on a marketing page and is fine.

export const PUBLIC_ROUTES = [
  '/', '/services', '/work', '/apply', '/privacy', '/terms', '/refund-policy',
] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];
export type PublicSubRoute = Exclude<PublicRoute, '/'>;

const SUB_ROUTES = PUBLIC_ROUTES.filter((r): r is PublicSubRoute => r !== '/');

export function matchPublicRoute(pathname: string, hash: string): PublicSubRoute | null {
  if (/^#\//.test(hash)) return null;              // an app route — hands off
  let p = (pathname || '/').toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, '');     // trailing slash, but keep "/"
  if (p === '/' || p === '') return null;          // root belongs to the product
  return (SUB_ROUTES as readonly string[]).includes(p) ? (p as PublicSubRoute) : null;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npm test`
Expected: PASS — 7 tests in `routes.test.ts`, 4 in `business.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/routes.ts web/src/lib/routes.test.ts
git commit -m "feat: public route matching that never intercepts the product"
```

---

### Task 3: Marketing chrome — header, footer, skip link, per-page head

The shared frame every marketing page sits in. The footer is the single largest compliance gap on `truhq.co` today: no company name, no address, no contact, no policy links.

**Files:**
- Create: `web/src/lib/head.ts`
- Create: `web/src/site/SiteHeader.tsx`
- Create: `web/src/site/SiteFooter.tsx`
- Create: `web/src/site/PublicSite.tsx`
- Create: `web/src/site/site.css`

**Interfaces:**
- Consumes: `BUSINESS` (Task 1), `PublicRoute` (Task 2).
- Produces:
  - `applyHead(meta: PageMeta): void` where `PageMeta = { title: string; description: string; path: PublicRoute }`
  - `<SiteHeader current={PublicRoute} />`, `<SiteFooter />`
  - `<PublicSite route={PublicRoute} />` — the only component Task 4 imports into `App.tsx`. Task 5 supplies `Home`, Task 6 `Services`, Task 7 `Work`, Task 8 the legal pages, Task 9 `Apply`.

- [ ] **Step 1: Write the head helper**

Create `web/src/lib/head.ts`:

```ts
// Per-route document head. The site is a SPA, so title/description/canonical/OG
// are set imperatively on navigation. Without this every page would inherit the
// bundle's static <title>, which currently reads "TRU Pulse" — wrong brand,
// wrong page, on every marketing URL.
import { BUSINESS } from '../config/business';
import type { PublicRoute } from './routes';

export type PageMeta = { title: string; description: string; path: PublicRoute };

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

export function applyHead({ title, description, path }: PageMeta): void {
  const url = BUSINESS.siteUrl + (path === '/' ? '' : path);
  document.title = title;

  upsertMeta('meta[name="description"]', { name: 'description', content: description });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: BUSINESS.brandFull });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
}
```

- [ ] **Step 2: Write the header**

Create `web/src/site/SiteHeader.tsx`. Reuses the existing `.nav`, `.wrap`, `.brand`, `.nlinks`, `.nright`, `.login`, `.cta`, `.pea` classes from `Landing.css` — no new visual language.

```tsx
import { useEffect } from 'react';
import { BUSINESS } from '../config/business';
import type { PublicRoute } from '../lib/routes';

export default function SiteHeader({ current }: { current: PublicRoute }) {
  useEffect(() => {
    const nav = document.getElementById('nav');
    const onScroll = () => {
      if (!nav) return;
      if (window.scrollY > 40) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const link = (href: PublicRoute, label: string) => (
    <a href={href} aria-current={current === href ? 'page' : undefined}>{label}</a>
  );

  return (
    <nav className="nav" id="nav"><div className="wrap">
      <a className="brand" href="/" aria-label={`${BUSINESS.brandFull} home`}>T<span className="r">RU</span></a>
      <div className="nlinks">
        {link('/services', 'Services')}
        {link('/work', 'Work')}
        {link('/apply', 'Apply')}
      </div>
      <div className="nright">
        <a href={`${BUSINESS.appUrl}`} className="login">Client log in</a>
        <a href="/apply" className="cta">
          Apply to work with us
          <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
        </a>
      </div>
    </div></nav>
  );
}
```

- [ ] **Step 3: Write the footer**

Create `web/src/site/SiteFooter.tsx`. This is the compliance-critical component: entity name, mailing address, contact email, and all three policy links, on every page.

```tsx
import { BUSINESS } from '../config/business';

export default function SiteFooter() {
  const year = new Date().getFullYear();
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BUSINESS.brandFull,
    legalName: BUSINESS.legalEntity,
    url: BUSINESS.siteUrl,
    email: BUSINESS.contactEmail,
    address: {
      '@type': 'PostalAddress',
      streetAddress: BUSINESS.legalAddress[0],
      addressLocality: 'Bothell',
      addressRegion: 'WA',
      postalCode: '98021',
      addressCountry: 'US',
    },
  };

  return (
    <footer className="sitefoot">
      <div className="wrap">
        <div className="sitefoot-brand">
          <a className="brand" href="/">T<span className="r">RU</span></a>
          <span className="m">{BUSINESS.tagline}</span>
        </div>

        <address className="sitefoot-addr">
          {BUSINESS.legalAddress.map((line) => <span key={line}>{line}</span>)}
          <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>
        </address>

        <nav className="sitefoot-legal" aria-label="Legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/refund-policy">Refund &amp; Cancellation</a>
        </nav>

        <p className="sitefoot-copy">© {year} {BUSINESS.legalEntity}. All rights reserved.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
    </footer>
  );
}
```

- [ ] **Step 4: Write the footer and skip-link styles**

Create `web/src/site/site.css`. Only genuinely new elements get new classes; colours come from the existing custom properties in `Landing.css`.

```css
/* Keyboard users must be able to jump the nav. Terrason had this on every page;
   TRU had none. Visible only when focused. */
.skiplink {
  position: absolute; left: -9999px; top: 0; z-index: 999;
  background: var(--gold, #e0a340); color: #17120b;
  padding: .7rem 1.1rem; border-radius: 0 0 8px 0;
  font-weight: 800; font-size: .85rem; text-decoration: none;
}
.skiplink:focus { left: 0; }

.sitefoot { border-top: 1px solid rgba(255,255,255,.09); padding: 3.2rem 0 2.4rem; margin-top: 4rem; }
.sitefoot .wrap { display: grid; gap: 1.5rem; }
.sitefoot-brand { display: flex; align-items: baseline; gap: .9rem; flex-wrap: wrap; }
.sitefoot-brand .m { color: var(--faint, #8d8578); font-size: .84rem; }
.sitefoot-addr { display: flex; flex-direction: column; gap: .2rem; font-style: normal;
                 color: var(--faint, #8d8578); font-size: .82rem; }
.sitefoot-addr a { color: inherit; }
.sitefoot-legal { display: flex; gap: 1.4rem; flex-wrap: wrap; font-size: .82rem; }
.sitefoot-legal a { color: var(--faint, #8d8578); text-decoration: none; }
.sitefoot-legal a:hover, .sitefoot-legal a:focus-visible { color: var(--gold, #e0a340); text-decoration: underline; }
.sitefoot-copy { color: var(--faint, #8d8578); font-size: .76rem; margin: 0; }

/* Long-form legal pages. Readable measure, nothing decorative. */
.legal { max-width: 46rem; padding: 8rem 0 2rem; }
.legal h1 { font-size: clamp(2rem, 4vw, 2.9rem); margin: 0 0 .4rem; }
.legal .updated { color: var(--faint, #8d8578); font-size: .8rem;
                  text-transform: uppercase; letter-spacing: .08em; margin-bottom: 2.4rem; }
.legal h2 { font-size: 1.15rem; margin: 2.4rem 0 .7rem; }
.legal p, .legal li { line-height: 1.75; font-size: .95rem; }
.legal ul { padding-left: 1.2rem; display: grid; gap: .45rem; }
.legal a { color: var(--gold, #e0a340); }

/* Every element focusable by keyboard shows it. */
a:focus-visible, button:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--gold, #e0a340); outline-offset: 3px;
}
```

- [ ] **Step 5: Write the shell**

Create `web/src/site/PublicSite.tsx`. Page bodies land in later tasks; this task stubs them so the shell is independently testable.

```tsx
import { useEffect } from 'react';
import type { PublicRoute } from '../lib/routes';
import { applyHead, type PageMeta } from '../lib/head';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import './site.css';
import '../pages/Landing.css';

export const META: Record<PublicRoute, Omit<PageMeta, 'path'>> = {
  '/': {
    title: 'TRU — Fractional sales management for real estate teams',
    description:
      'We take sales management off the team owner’s plate — agent accountability, pipeline oversight, Zillow Flex conversion, and the daily operating rhythm — without adding a full-time hire.',
  },
  '/services': {
    title: 'Services & engagement model — TRU',
    description:
      'Seven things we own for you, four packages scaled to your team size, and exactly how an engagement starts.',
  },
  '/work': {
    title: 'Work — TRU',
    description: 'What changes when the operating system actually runs. Three engagements, and what we built in each.',
  },
  '/apply': {
    title: 'Apply to work with us — TRU',
    description: 'Five short questions about your team. We review every application personally and reply within two business days.',
  },
  '/privacy': { title: 'Privacy Policy — TRU', description: 'What we collect, how we use it, and the choices you have.' },
  '/terms': { title: 'Terms of Service — TRU', description: 'The terms governing your use of truhq.co.' },
  '/refund-policy': { title: 'Refund & Cancellation Policy — TRU', description: 'How cancellations, pauses, and refunds work.' },
};

export default function PublicSite({ route }: { route: PublicRoute }) {
  useEffect(() => {
    applyHead({ ...META[route], path: route });
    if (route !== '/') window.scrollTo(0, 0);
  }, [route]);

  return (
    <div className="truland">
      <a className="skiplink" href="#main">Skip to content</a>
      <SiteHeader current={route} />
      <main id="main">
        {/* Page bodies arrive in Tasks 5–9. */}
      </main>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd web && npm run typecheck && npm test`
Expected: both pass. Nothing renders `PublicSite` yet — that is Task 4.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/head.ts web/src/site/
git commit -m "feat: marketing chrome — header, compliant footer, skip link, per-route head"
```

---

### Task 4: Wire the public site into the app without touching product routing

The highest-risk task in the plan. Two additions to `App.tsx`, nothing else, and the product proven unbroken before the commit lands.

**Files:**
- Modify: `web/src/main.tsx` (the sub-path switch — see the deviation note below)
- Modify: `web/src/App.tsx` (the logged-out branch, plus a product tab-title effect)
- Create: `web/public/_redirects`
- Modify: `web/index.html:6`

> **Deviation, applied 2026-08-09.** This task originally put the sub-path
> short-circuit at the top of `App()`, above `useHashRoute()`. That is a hooks-order
> violation — an early `return` before the hook calls — and it would still have run
> the Supabase session effects on marketing pages. The switch moved to `main.tsx`
> instead, choosing between `<PublicSite>` and `<App>` before `App` ever mounts.
> Same behaviour, no conditional hooks, and genuinely zero auth work on a policy
> page. `App.tsx` is left with a single change: `<PublicSite route="/" />` in place
> of `<Landing>` in the existing signed-out branch.
>
> One knock-on: giving `index.html` the marketing title made the *product's* browser
> tab read the marketing headline. `App.tsx` gained a small effect that restores
> `TRU HQ` whenever a product screen is what's showing, skipped when the signed-out
> marketing home renders so it cannot fight `applyHead`.

**Interfaces:**
- Consumes: `matchPublicRoute` (Task 2), `PublicSite` (Task 3).
- Produces: deep links resolve; `<PublicSite route="/" />` replaces `<Landing onEnter={…} />` as the logged-out home.

- [ ] **Step 1: Read the two touch points before editing**

Run: `sed -n '30,36p;108,116p' web/src/App.tsx`

Confirm line 33 is `const route = useHashRoute();` and lines 111–114 are the `if (!session)` branch ending in `return <Landing onEnter={…} />;`. If they have moved, find them by content, not by line number.

- [ ] **Step 2: Add the import and the sub-path short-circuit**

In `web/src/App.tsx`, add to the imports:

```tsx
import { matchPublicRoute } from './lib/routes';
import PublicSite from './site/PublicSite';
```

Then insert as the **first statement inside `export default function App()`**, above `const route = useHashRoute();`:

```tsx
  // The marketing site owns six real paths. Resolved before any session work so a
  // policy or services page renders instantly, for signed-in and signed-out
  // visitors alike, with no auth round-trip and no flash.
  //
  // Deliberately NOT "/": the product lives at "/" plus a hash, so claiming root
  // here would show every logged-in user the marketing page instead of their
  // dashboard. Root is handled in the logged-out branch below.
  const publicRoute = matchPublicRoute(window.location.pathname, window.location.hash);
  if (publicRoute) return <PublicSite route={publicRoute} />;
```

- [ ] **Step 3: Swap the logged-out home**

Replace only the `return <Landing …>` line inside the existing `if (!session) {` block:

```tsx
  if (!session) {
    if (route === '/login') return <Login />;
    return <PublicSite route="/" />;
  }
```

Delete the now-unused `import Landing from './pages/Landing';`. Everything else in `App.tsx` — the hash `shell()`, `isDemo`, `recovery`, `admin`, `agent`, and the impersonation banner — stays exactly as it is.

- [ ] **Step 4: Add the SPA fallback so deep links resolve**

Create `web/public/_redirects`:

```
/*    /index.html   200
```

Without this, Cloudflare Pages 404s on `/services` typed directly into the address bar. `app.truhq.co` is unaffected — it is only ever entered at `/`.

- [ ] **Step 5: Fix the document title fallback**

In `web/index.html`, change line 6 from `<title>TRU Pulse</title>` to:

```html
    <title>TRU — Fractional sales management for real estate teams</title>
    <meta name="description" content="We take sales management off the team owner's plate — without adding a full-time hire." />
```

`applyHead` overwrites this per route; it only matters for the first paint and for crawlers that don't run JS.

- [ ] **Step 6: Prove the product still works**

```bash
cd web && npm run typecheck && npm test && npm run dev
```

In the browser, walk **all** of these. Every one must behave exactly as before:

| URL | Expected |
|---|---|
| `/` logged out | Marketing home (intro video plays, skip works) |
| `/#/login` | Login screen; sign-in succeeds |
| `/` logged in | **The product home — not the marketing page** |
| `/#/pulse` | Pulse dashboard |
| `/#/rep`, `/#/prospect`, `/#/studio` | Each product screen |
| `/?demo=1` | Demo shell |
| `/?demo=1#/learn` | Agent course |
| `/services`, `/work`, `/apply`, `/privacy`, `/terms`, `/refund-policy` | Header + empty main + footer |
| `/services` hard-refresh | Same (proves `_redirects`) |
| `/insights` | Falls through to the app, not a marketing page |

If the third row shows the marketing home, **stop** — `matchPublicRoute` is claiming root and Task 2's critical test is wrong.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx web/public/_redirects web/index.html
git commit -m "feat: serve the marketing site on real paths, leaving product routing untouched"
```

---

### Task 5: Home page

**Files:**
- Create: `web/src/site/pages/Home.tsx`
- Modify: `web/src/site/PublicSite.tsx` (render it)
- Reference: `web/src/pages/Landing.tsx` — the intro/scroll/count-up effects move here verbatim

**Interfaces:**
- Consumes: `BUSINESS`, the `.truland` CSS.
- Produces: `<Home />`, default export.

**Content — port verbatim from `docs/terrason-site-archive.md` § `/` unless noted.**

Section order and what changes:

| # | Section | Source | Change |
|---|---|---|---|
| 1 | Cinematic intro | `Landing.tsx:24-88` | **Unchanged.** Move the effect verbatim, including the phone-square-reveal branch and the reduced-motion path. |
| 2 | Hero | Archive `/` hero | Eyebrow `REAL ESTATE SALES OPERATIONS`. H1 *The operating system behind high-performing real estate teams.* Subhead = the "off the owner's plate" paragraph verbatim. Buttons: **Apply to work with us** → `/apply`, **Book a call** → `BUSINESS.calendly`. **Delete** the micro-line "Read-only. Connects to Follow Up Boss. Nothing stored." |
| 3 | The problem | Archive `/` § 02 | Verbatim, all five arrow items. |
| 4 | What we do | Archive `/services` § seven services | Seven cards, `01`–`07`, title + description each. Confirmed 2026-08-09: seven, not the old home's five. |
| 5 | Who it's for | Archive `/` § 06 | Verbatim, all three. |
| 6 | The tooling | `Landing.tsx:243-252` pills + `:230-239` audit card | Kick line becomes `INCLUDED IN YOUR ENGAGEMENT`. Keep the three pills. **Delete** the "AI call practice & ALMS grading (coming)" bullet wherever it appears. Audit card keeps its count-up but gains a visible caption, not fine print: `Sample data — illustrative of the accountability dashboard included in your engagement.` |
| 7 | Closing CTA | Archive `/` § 09 | *Build the operating system your team deserves.* / 30-minute strategy call, no pitch, no pressure. Button → `BUSINESS.calendly`; secondary → `/apply`. |

**Deleted outright:** the entire `#pricing` section (`Landing.tsx:254-299`) — every tier, every price, and the "Billed annually · up to 15 seats · +$25/agent" line. Pricing is Task 6's job and carries no numbers.

- [ ] **Step 1: Create the page and move the intro effect**

Create `web/src/site/pages/Home.tsx`. Copy the whole `useEffect` body from `Landing.tsx:13-175` — intro, reduced-motion, `countUp`, both IntersectionObservers, and the cleanup. Drop only the `onScroll`/`nav` block (lines 106–113), which now lives in `SiteHeader`. Keep the `wrapRef` and the `.ready` class timing.

The JSX shell:

```tsx
export default function Home() {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { /* moved verbatim from Landing.tsx */ }, []);

  return (
    <div ref={wrapRef}>
      <div id="intro" aria-hidden="true">{/* verbatim from Landing.tsx:179-185 */}</div>
      <div className="bg">{/* verbatim from Landing.tsx:186-191 */}</div>
      <div className="grain" />
      {/* sections 2–7 */}
    </div>
  );
}
```

- [ ] **Step 2: Write the hero**

```tsx
<header className="hero" id="top"><div className="wrap">
  <div>
    <span className="badge fade g1"><span className="s" />Real estate sales operations</span>
    <h1>
      <span className="line"><span>The operating system</span></span>
      <span className="line"><span className="thin">behind high-performing</span></span>
      <span className="line"><span className="say">real estate teams.
        <svg viewBox="0 0 300 12" preserveAspectRatio="none"><path d="M3 8 C 60 2, 110 11, 160 6 S 250 2, 297 7" /></svg>
      </span></span>
    </h1>
    <p className="hsub fade g2">
      We take sales management — agent accountability, pipeline oversight, Zillow Flex
      conversion, ZHL adoption, and the daily operating rhythm — off the owner&rsquo;s plate so
      you can focus on what actually grows the business: branding, recruiting, expansion, vision.
    </p>
    <div className="hcta fade g3">
      <a href="/apply" className="cta">Apply to work with us
        <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
      <a href={BUSINESS.calendly} className="cta ghost" target="_blank" rel="noopener noreferrer">
        Book a call with our team
        <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
    </div>
  </div>
  <div className="scrollcue">Scroll<i /></div>
</div></header>
```

- [ ] **Step 3: Write sections 3–7**

Follow the table above. Use `.panel.band` + `.wrap` per section, `.kick` for eyebrows, `.h2` for headings, `.sub` for the deck, and `.reveal .d1/.d2/.d3` for stagger — exactly as `Landing.tsx` does today. Copy is verbatim from the archive.

- [ ] **Step 4: Render it**

In `PublicSite.tsx`, import `Home` and render it inside `<main>` when `route === '/'`.

- [ ] **Step 5: Verify**

```bash
cd web && npm run typecheck && npm test && npm run dev
```

Check, at `/` logged out: intro plays and can be skipped; reduced-motion (DevTools → Rendering → Emulate `prefers-reduced-motion`) skips the intro and pauses the background video; the audit card counts up once on scroll; a viewport under 760px uses the square reveal; **no price, no "coming" feature, and no "Nothing stored" line appears anywhere.**

- [ ] **Step 6: Commit**

```bash
git add web/src/site/pages/Home.tsx web/src/site/PublicSite.tsx
git commit -m "feat: consulting-first home page, software reframed as included tooling"
```

---

### Task 6: Services page

**Files:**
- Create: `web/src/site/pages/Services.tsx`
- Modify: `web/src/site/PublicSite.tsx`

**Interfaces:**
- Consumes: `BUSINESS`.
- Produces: `<Services />`, default export.

**Content — archive § `/services`, verbatim, with two deliberate changes.**

Sections: hero · seven numbered services · four packages · why teams hire us (nine-item list) · who we work best with · Investment · How to engage (five steps) · CTA row (`Apply` + `See Refund & Cancellation Policy` → `/refund-policy`).

**The four packages.** Reuse the existing `.tiers` / `.tier` / `.tname` / `.td` markup. Each card carries its team-size band as the eyebrow, the package name, the description from the archive, and **no price element at all** — do not render an empty `.price` div.

```tsx
const PACKAGES = [
  { band: 'Up to 10 agents', name: 'Essentials', featured: false,
    blurb: 'Foundational sales management for teams putting their first real operating cadence in place. The full universal rhythm — leadership meetings, pipeline huddles, CRM oversight, accountability management, and performance monitoring — included.' },
  { band: '10 to 20 agents', name: 'Performance', featured: true, tag: 'Most common',
    blurb: 'Our most popular engagement — chosen by teams ready to compound their existing lead flow into closings. Deeper coaching presence, sharper accountability, and tighter management coverage across the roster.' },
  { band: '20 to 40 agents', name: 'Performance+', featured: false,
    blurb: 'For teams with larger rosters where individual coaching capacity is the binding constraint. Expanded one-on-one presence and management bandwidth so no agent gets coached on a lag.' },
  { band: '40+ agents', name: 'Mega Team', featured: false,
    blurb: 'One-on-one coaching capacity scoped to your roster. Custom commercial structure designed around the size and complexity of your operation.' },
] as const;
```

Beneath the cards, the assignment rule from the pricing flier:

> Your package is set by active agent count, not preference — so you always get the right level of support. If your team grows into the next band, we move you up at your next billing cycle.

**The Investment paragraph.** Archive text, plus the per-deal structure in words and **no numbers**:

> Engagements are structured as a monthly retainer scoped to your package and your team's specific situation, plus a payout on every closed deal, scaled to your market's home values — so our upside is tied directly to your results. Final terms depend on team size, current revenue, market context, and the level of coaching coverage you need. We'll provide a fixed-price proposal after the discovery call.
>
> Payments are processed via Stripe. Retainers are invoiced monthly. Engagements can be paused or unpaused with reasonable notice to accommodate seasonal team dynamics.

- [ ] **Step 1: Write the page** following the section list above, verbatim from the archive.
- [ ] **Step 2: Render it** from `PublicSite.tsx` when `route === '/services'`.
- [ ] **Step 3: Prove no number leaked**

```bash
cd web && npm run typecheck
grep -nE '\$[0-9]|3,750|5,250|6,750' src/site/pages/Services.tsx && echo "FAIL: price found" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add web/src/site/pages/Services.tsx web/src/site/PublicSite.tsx
git commit -m "feat: services page with four packages by team size, no pricing"
```

---

### Task 7: Work page and the results disclaimer

**Files:**
- Create: `web/src/site/pages/Work.tsx`
- Modify: `web/src/site/PublicSite.tsx`

**Interfaces:**
- Consumes: nothing beyond the shared CSS.
- Produces: `<Work />`, default export.

Eric's call on 2026-08-09: the metrics are directional, not measured. Keep what was **done**, drop what it **produced**.

- [ ] **Step 1: Write the page with de-numbered cards**

```tsx
const CASES = [
  { scope: 'Regional brokerage · 24 → 60 agents',
    title: 'Scaling headcount without losing the ops layer',
    body: 'A regional brokerage grew headcount hard over 18 months and the lead-to-close process came apart underneath it. We rebuilt lead routing, follow-up cadence, and the ISA operating model.' },
  { scope: '12-agent team · Follow Up Boss',
    title: 'A CRM rebuilt from scratch in 30 days',
    body: 'Eighteen thousand leads sat in a CRM with no functioning stage system. We rebuilt Follow Up Boss end to end and trained the team on a cadence they could actually sustain.' },
  { scope: 'Solo producer → 5-agent team',
    title: 'A working system on day one',
    body: 'A top-producing solo agent wanted to build a team and knew chaos would scale with every hire. We installed the operating model first, then onboarded the first five agents into it.' },
] as const;
```

Headline stays: *What changes when the system actually runs.* CTA: **Apply to work with us** → `/apply`.

- [ ] **Step 2: Add the results disclaimer directly beneath the cards**

```tsx
<p className="note reveal">
  Client examples describe work performed for real engagements. They are illustrative, not a
  prediction or guarantee of results. Outcomes depend on your market, your team, your lead
  spend, and your execution.
</p>
```

- [ ] **Step 3: Prove every metric is gone**

```bash
cd web
grep -nE '147|8\.2M|3\.1|\$14M|GCI|speed-to-lead' src/site/pages/Work.tsx && echo "FAIL" || echo "clean"
npm run typecheck
```

Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add web/src/site/pages/Work.tsx web/src/site/PublicSite.tsx
git commit -m "feat: work page with substantiable claims and a results disclaimer"
```

---

### Task 8: The three legal pages

**Files:**
- Create: `web/src/site/pages/Privacy.tsx`
- Create: `web/src/site/pages/Terms.tsx`
- Create: `web/src/site/pages/RefundPolicy.tsx`
- Modify: `web/src/site/PublicSite.tsx`

**Interfaces:**
- Consumes: `BUSINESS` — **every** entity name, address, email, state, venue, and date interpolates from it. No hardcoded values.
- Produces: three default-export components.

Ported from the archive (§ `/privacy`, `/terms`, `/refund-policy`) — they are well-drafted and their substance stays. Wrap each in `<article className="legal">` with a single `<h1>` and an `.updated` line reading `LAST UPDATED: {BUSINESS.policiesUpdated}`.

**Substitutions in all three:** `Terrason Consulting Group` → `{BUSINESS.legalEntity}` · `terrasonconsulting.com` → `truhq.co` · `Admin@terrasonconsulting.com` → `{BUSINESS.contactEmail}` · `Washington State` → `{BUSINESS.governingState}` · `Snohomish County` → `{BUSINESS.governingVenue}`.

**Privacy-specific rewrites — these are not cosmetic. A policy that names the wrong processors is an affirmative misstatement.**

- *Information collected automatically:* Vercel Web Analytics → **Cloudflare Web Analytics**. Keep the cookie-free claim — it is true of Cloudflare's product, and Task 12 is what keeps it true.
- *How we share:* replace the provider list with the real one — **Cloudflare** (hosting and privacy-friendly analytics), **Supabase** (database), **Resend** (transactional email), **Calendly** (scheduling), **Stripe** (client payment processing). Remove Vercel and Google Apps Script.
- *Information we collect:* the new site has one form. Drop "our audit … or contact forms"; name the application form and list exactly what it takes — name, work email, role, team size, and a description of the current bottleneck. **State plainly that no phone number is collected.**
- *How we use:* replace "the Sales Process Audit Checklist" with "the resources you request." The new site offers no free download; a policy must not describe a deliverable that does not exist.
- *Cookies:* keep the section, and add one sentence tying the claim to the implementation:

  > We use Cloudflare Web Analytics, which is cookieless by design. Because we set no tracking cookies and run no advertising or remarketing tags, this site does not present a cookie consent banner.

- *Your rights:* keep all six. The deletion and access rights are now genuinely honourable because Task 10 stores submissions in a table Eric can query.

**Refund-policy rewrite:** *Free resources* currently names the Sales Process Audit Checklist. Generalise to "Any free resources we may offer from time to time are provided at no charge. Because no payment is collected, no refund is applicable."

**Terms:** substitution only. The RESPA and state-licensing disclaimer, the not-advice clause, the AS-IS disclaimer, the liability cap, indemnification, governing law, and severability all stay as written.

- [ ] **Step 1: Write `Privacy.tsx`** with the rewrites above.
- [ ] **Step 2: Write `Terms.tsx`** — substitution only.
- [ ] **Step 3: Write `RefundPolicy.tsx`** with the free-resources generalisation.
- [ ] **Step 4: Render all three** from `PublicSite.tsx`.
- [ ] **Step 5: Prove nothing is hardcoded**

```bash
cd web
grep -rniE 'terrason|snohomish|bothell|3008|vercel|apps script' src/site/pages/Privacy.tsx src/site/pages/Terms.tsx src/site/pages/RefundPolicy.tsx \
  && echo "FAIL: hardcoded or stale value" || echo "clean"
npm run typecheck
```

Expected: `clean`. Every one of those strings must reach the page through `BUSINESS`, or be gone.

- [ ] **Step 6: Read all three rendered pages end to end**

At `/privacy`, `/terms`, `/refund-policy`: the entity name, address, email, and venue render correctly; no placeholder text; no broken interpolation (`[object Object]`, `undefined`); every internal link resolves.

- [ ] **Step 7: Commit**

```bash
git add web/src/site/pages/Privacy.tsx web/src/site/pages/Terms.tsx \
        web/src/site/pages/RefundPolicy.tsx web/src/site/PublicSite.tsx
git commit -m "feat: privacy, terms, and refund policy under the TRU brand"
```

---

### Task 9: Application form

**Files:**
- Create: `web/src/site/pages/Apply.tsx`
- Create: `web/src/site/pages/apply.css`
- Modify: `web/src/site/PublicSite.tsx`

**Interfaces:**
- Consumes: `BUSINESS`.
- Produces: `<Apply />`. POSTs to `${import.meta.env.VITE_WORKER_URL}/apply` with the body shape Task 10 validates:
  `{ fullName, email, role, teamSize, bottleneck, marketingOptIn, consentText, consentAt, sourcePath, website }`
  (`website` is the honeypot — always empty for a human.)

Fields carried from the archive exactly: full name, work email, role (4 options), team size (5 bands), biggest bottleneck. **No phone field** — confirmed 2026-08-09.

- [ ] **Step 1: Build the form with a real consent layer**

Two distinct things that must never be merged into one checkbox:

```tsx
const CONSENT_TEXT =
  'By submitting, you agree to our Terms and Privacy Policy. We will use this ' +
  'information to respond to your application. We never sell your information.';

const OPT_IN_TEXT =
  'Send me occasional notes on real estate sales operations. Unsubscribe any time.';
```

Under the submit button:

```tsx
{/* Honeypot — visually hidden, never announced, ignored by humans. */}
<div className="hp" aria-hidden="true">
  <label htmlFor="website">Website</label>
  <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
         value={website} onChange={(e) => setWebsite(e.target.value)} />
</div>

{/* Optional, UNTICKED by default, never a condition of submitting. */}
<label className="optin">
  <input type="checkbox" name="marketingOptIn"
         checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
  <span>{OPT_IN_TEXT}</span>
</label>

<button type="submit" className="cta" disabled={submitting}>
  {submitting ? 'Sending…' : 'Submit application'}
</button>

<p className="consent">
  By submitting, you agree to our <a href="/terms">Terms</a> and{' '}
  <a href="/privacy">Privacy Policy</a>. We&rsquo;ll use this information to respond to your
  application. We never sell your information.
</p>
```

Every input gets a real `<label htmlFor>`, `required` where required, and `aria-describedby` pointing at its error text. The two selects carry the archive's exact options. Required-field errors render as text, not colour alone.

- [ ] **Step 2: Submit, and never lose a lead to a 500**

```tsx
const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/apply`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fullName, email, role, teamSize, bottleneck,
    marketingOptIn,
    consentText: CONSENT_TEXT,
    consentAt: new Date().toISOString(),
    sourcePath: window.location.pathname,
    website,
  }),
});
```

On success, replace the form with a confirmation naming the two-business-day reply window and offering the Calendly link. **On any failure**, show the error *and* the Calendly link plus `BUSINESS.contactEmail`, so the lead has somewhere to go.

- [ ] **Step 3: Style the honeypot so it is invisible but not `display:none`**

In `apply.css` (bots skip `display:none` fields):

```css
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.optin { display: flex; gap: .6rem; align-items: flex-start; font-size: .86rem;
         line-height: 1.5; margin: 1.1rem 0; cursor: pointer; }
.optin input { margin-top: .25rem; flex: 0 0 auto; }
.consent { font-size: .78rem; color: var(--faint, #8d8578); line-height: 1.6; margin-top: 1rem; }
.consent a { color: var(--gold, #e0a340); }
.field-error { color: #e08a8a; font-size: .78rem; margin-top: .3rem; }
```

- [ ] **Step 4: Render it** from `PublicSite.tsx` when `route === '/apply'`.
- [ ] **Step 5: Verify by keyboard only**

Tab from the top of `/apply` to the submit button. Every control is reachable, focus is always visible, both selects operate with arrow keys, and the opt-in toggles with Space. Submit with fields empty — errors are announced and the form does not submit. Confirm the opt-in box starts **unticked** on a fresh load.

- [ ] **Step 6: Commit**

```bash
git add web/src/site/pages/Apply.tsx web/src/site/pages/apply.css web/src/site/PublicSite.tsx
git commit -m "feat: application form with separated notice and marketing opt-in"
```

---

### Task 10: Worker `/apply` endpoint

Purely additive: one new route, one new table. No existing route, table, cron, or sync path is touched.

**Files:**
- Create: `db/applications.sql`
- Create: `worker/src/apply.ts`
- Create: `worker/src/apply.test.ts`
- Modify: `worker/src/index.ts` (one new route block, before the final 404)
- Modify: `worker/src/env.ts` (one optional var)

**Interfaces:**
- Consumes: `Db` from `worker/src/db.ts` (`insert`, `select`), `Env`.
- Produces:
  - `validateApplication(body: unknown): { ok: true; value: ApplicationInput } | { ok: false; error: string }`
  - `ApplicationInput = { fullName, email, role, teamSize, bottleneck, marketingOptIn, consentText, consentAt, sourcePath }`
  - `submitApplication(env, db, input, meta): Promise<{ ok: true }>`

- [ ] **Step 1: Write the table with deny-all RLS**

Create `db/applications.sql`:

```sql
-- Public application submissions. Written ONLY by the Worker's service role.
-- RLS is enabled with ZERO policies, so anon and authenticated clients can read
-- nothing and write nothing — the same posture as team_secrets.
create table if not exists applications (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  full_name         text not null,
  email             text not null,
  role              text not null,
  team_size         text not null,
  bottleneck        text not null,
  -- Consent is stored with the exact wording shown at the time, so it is
  -- provable later. That is the entire point of collecting it.
  marketing_opt_in  boolean not null default false,
  consent_text      text not null,
  consent_at        timestamptz not null,
  source_path       text,
  ip_hash           text,          -- salted SHA-256; supports rate limiting, not identification
  user_agent        text
);

create index if not exists applications_created_idx on applications (created_at desc);
create index if not exists applications_ip_idx on applications (ip_hash, created_at desc);

alter table applications enable row level security;
revoke all on applications from anon, authenticated;
```

- [ ] **Step 2: Write the failing validation tests**

Create `worker/src/apply.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateApplication } from './apply.js';

const good = {
  fullName: 'Dana Reyes', email: 'dana@example.com', role: 'Team leader',
  teamSize: '6–20', bottleneck: 'Leads sit unworked for days.',
  marketingOptIn: false, consentText: 'By submitting, you agree…',
  consentAt: '2026-08-09T18:00:00.000Z', sourcePath: '/apply', website: '',
};

describe('validateApplication', () => {
  it('accepts a well-formed submission', () => {
    const r = validateApplication(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('dana@example.com');
  });

  it('rejects a filled honeypot as if it were valid, without storing', () => {
    const r = validateApplication({ ...good, website: 'http://spam.example' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('honeypot');
  });

  it('requires every visible field', () => {
    for (const k of ['fullName', 'email', 'role', 'teamSize', 'bottleneck'] as const) {
      expect(validateApplication({ ...good, [k]: '' }).ok, `${k} empty`).toBe(false);
      expect(validateApplication({ ...good, [k]: '   ' }).ok, `${k} blank`).toBe(false);
    }
  });

  it('rejects a malformed email', () => {
    for (const e of ['nope', 'a@', '@b.com', 'a b@c.com']) {
      expect(validateApplication({ ...good, email: e }).ok).toBe(false);
    }
  });

  it('caps every field so a giant body cannot be posted', () => {
    expect(validateApplication({ ...good, bottleneck: 'x'.repeat(5001) }).ok).toBe(false);
    expect(validateApplication({ ...good, fullName: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('trims whitespace and defaults the opt-in to false when absent', () => {
    const r = validateApplication({ ...good, fullName: '  Dana  ', marketingOptIn: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.fullName).toBe('Dana');
      expect(r.value.marketingOptIn).toBe(false);
    }
  });

  it('coerces the opt-in to a real boolean', () => {
    const r = validateApplication({ ...good, marketingOptIn: 'yes' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.marketingOptIn).toBe(true);
  });

  it('requires consent metadata', () => {
    expect(validateApplication({ ...good, consentText: '' }).ok).toBe(false);
    expect(validateApplication({ ...good, consentAt: 'not-a-date' }).ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    for (const b of [null, undefined, 'x', 42, []]) {
      expect(validateApplication(b).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd worker && npm test`
Expected: FAIL — cannot resolve `./apply.js`.

- [ ] **Step 4: Write the validator and the submit path**

Create `worker/src/apply.ts`:

```ts
// Public application intake. The only unauthenticated write path in the Worker,
// so it validates hard, caps every field, and never trusts the client.
import type { Env } from './env.js';
import type { Db } from './db.js';

export interface ApplicationInput {
  fullName: string; email: string; role: string; teamSize: string; bottleneck: string;
  marketingOptIn: boolean; consentText: string; consentAt: string; sourcePath: string | null;
}

type Result =
  | { ok: true; value: ApplicationInput }
  | { ok: false; error: string };

const LIMITS = { fullName: 200, email: 320, role: 80, teamSize: 40, bottleneck: 5000, consentText: 2000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function validateApplication(body: unknown): Result {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad body' };
  const b = body as Record<string, unknown>;

  // Honeypot: a human never sees this field. Reported as an error so the caller
  // can return a success-shaped response without storing anything.
  if (str(b.website)) return { ok: false, error: 'honeypot' };

  const fullName = str(b.fullName);
  const email = str(b.email).toLowerCase();
  const role = str(b.role);
  const teamSize = str(b.teamSize);
  const bottleneck = str(b.bottleneck);
  const consentText = str(b.consentText);
  const consentAt = str(b.consentAt);

  for (const [k, v] of Object.entries({ fullName, email, role, teamSize, bottleneck })) {
    if (!v) return { ok: false, error: `${k} is required` };
    if (v.length > (LIMITS as Record<string, number>)[k]) return { ok: false, error: `${k} is too long` };
  }
  if (!EMAIL.test(email)) return { ok: false, error: 'that email address looks wrong' };

  if (!consentText || consentText.length > LIMITS.consentText) return { ok: false, error: 'consent text missing' };
  if (!consentAt || Number.isNaN(Date.parse(consentAt))) return { ok: false, error: 'consent timestamp missing' };

  return {
    ok: true,
    value: {
      fullName, email, role, teamSize, bottleneck,
      marketingOptIn: Boolean(b.marketingOptIn),
      consentText, consentAt,
      sourcePath: str(b.sourcePath) || null,
    },
  };
}

// Salted hash — enough to rate-limit a repeat submitter, not enough to identify one.
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recentlySubmitted(database: Db, ipHash: string, max = 5): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await database.select('applications', `ip_hash=eq.${ipHash}&created_at=gte.${since}&select=id`);
  return rows.length >= max;
}

export async function notify(env: Env, input: ApplicationInput): Promise<boolean> {
  const to = (env.APPLY_NOTIFY_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.BRIEF_FROM || !to.length) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const html = `
    <h2>New application — ${esc(input.fullName)}</h2>
    <p><b>Email:</b> ${esc(input.email)}<br/>
       <b>Role:</b> ${esc(input.role)}<br/>
       <b>Team size:</b> ${esc(input.teamSize)}<br/>
       <b>Marketing opt-in:</b> ${input.marketingOptIn ? 'yes' : 'no'}</p>
    <p><b>Biggest bottleneck</b><br/>${esc(input.bottleneck).replace(/\n/g, '<br/>')}</p>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.BRIEF_FROM, to, reply_to: input.email, subject: `New application — ${input.fullName}`, html }),
  });
  return res.ok;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd worker && npm test`
Expected: PASS — 9 tests in `apply.test.ts`; the existing `prospect.test.ts` and `social.test.ts` still pass.

- [ ] **Step 6: Add the env var**

In `worker/src/env.ts`, add one line inside the interface:

```ts
  APPLY_NOTIFY_TO?: string;           // comma-separated recipients for new applications
```

- [ ] **Step 7: Wire the route**

In `worker/src/index.ts`, add the import beside the others:

```ts
import { validateApplication, hashIp, recentlySubmitted, notify } from './apply.js';
```

And insert this block immediately **before** the final `return json({ error: 'not found' }, 404);`:

```ts
    // ── Public: application intake from truhq.co/apply ──────────────────────
    // The only unauthenticated write path. Storing the submission is what makes
    // the retention and deletion promises in the privacy policy honourable.
    if (url.pathname === '/apply' && req.method === 'POST') {
      const parsed = validateApplication(await req.json().catch(() => null));
      if (!parsed.ok) {
        // A tripped honeypot gets a success-shaped reply so the bot learns nothing.
        if (parsed.error === 'honeypot') return json({ ok: true });
        return json({ error: parsed.error }, 422);
      }
      const ip = req.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
      const ipHash = await hashIp(ip, env.FUB_ENC_KEY);
      try {
        if (await recentlySubmitted(database, ipHash)) {
          return json({ error: 'too many submissions — email us instead' }, 429);
        }
        await database.insert('applications', {
          full_name: parsed.value.fullName,
          email: parsed.value.email,
          role: parsed.value.role,
          team_size: parsed.value.teamSize,
          bottleneck: parsed.value.bottleneck,
          marketing_opt_in: parsed.value.marketingOptIn,
          consent_text: parsed.value.consentText,
          consent_at: parsed.value.consentAt,
          source_path: parsed.value.sourcePath,
          ip_hash: ipHash,
          user_agent: (req.headers.get('User-Agent') ?? '').slice(0, 500),
        });
        // The lead is safely stored; a failed notification must not fail the request.
        ctx.waitUntil(notify(env, parsed.value).catch(() => {}));
        return json({ ok: true });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
```

- [ ] **Step 8: Apply the migration and verify RLS actually denies**

Apply `db/applications.sql` through the Supabase MCP connector (`apply_migration`), then prove the lockdown — this is the check that matters:

```bash
# Anonymous read must be denied or empty. Never a row.
curl -s "$SUPABASE_URL/rest/v1/applications?select=*" \
     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# Anonymous insert must be denied.
curl -s -X POST "$SUPABASE_URL/rest/v1/applications" \
     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{"full_name":"x","email":"x@y.z"}'
```

Expected: both refused (permission-denied error or empty array). If either returns data or succeeds, **stop and fix the policy before going further.**

- [ ] **Step 9: Set the secret and deploy**

```bash
cd worker
npx wrangler secret put APPLY_NOTIFY_TO   # eric@…,Adamt@…
npm run typecheck && npm test && npm run deploy
curl -s https://<worker-host>/health      # {"ok":true} — existing routes unaffected
```

- [ ] **Step 10: Commit**

```bash
git add db/applications.sql worker/src/apply.ts worker/src/apply.test.ts \
        worker/src/index.ts worker/src/env.ts
git commit -m "feat: public application intake with deny-all storage and consent capture"
```

---

### Task 11: End-to-end form verification

The form and the endpoint were built apart. This proves they work together, and that consent is captured in a way that is actually provable.

**Files:** none created. Fix-forward in `Apply.tsx` or `apply.ts` if a check fails.

- [ ] **Step 1: Submit with the opt-in left unticked**

Fill `/apply` honestly, leave the checkbox alone, submit. Confirm: the success state renders; a row appears in `applications`; `marketing_opt_in` is `false`; `consent_text` holds the exact sentence shown on screen; `consent_at` is a real timestamp within seconds of the submit.

- [ ] **Step 2: Submit with the opt-in ticked**

Confirm `marketing_opt_in` is `true` and everything else stores identically. **These two rows are the difference between a defensible email list and an indefensible one** — if the column does not reflect the checkbox, stop.

- [ ] **Step 3: Confirm the notification arrives**

Both addresses in `APPLY_NOTIFY_TO` receive the email, `reply_to` is the applicant's address, and every field appears.

- [ ] **Step 4: Confirm no phone number is collected anywhere**

```bash
cd web && grep -rniE 'phone|tel:|type="tel"|mobile' src/site/ && echo "FAIL" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 5: Confirm the failure path never loses a lead**

Point `VITE_WORKER_URL` at a dead host, rebuild, submit. The error message must appear **with** the Calendly link and the contact email. Restore the real value.

- [ ] **Step 6: Confirm the honeypot is silent**

```bash
curl -s -X POST "$WORKER_URL/apply" -H 'Content-Type: application/json' \
  -d '{"fullName":"Bot","email":"b@x.co","role":"Other","teamSize":"1 (just me)","bottleneck":"hi","consentText":"x","consentAt":"2026-08-09T00:00:00Z","website":"http://spam"}'
```

Expected: `{"ok":true}` and **no new row** in `applications`.

- [ ] **Step 7: Commit any fixes**

```bash
git commit -am "fix: application form end-to-end corrections"
```

---

### Task 12: Indexing, metadata, and cookieless analytics

**Files:**
- Create: `web/public/robots.txt`
- Create: `web/public/sitemap.xml`
- No source change for analytics — it is enabled in the Cloudflare dashboard (Step 3).

- [ ] **Step 1: Write `robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://truhq.co/sitemap.xml
```

- [ ] **Step 2: Write `sitemap.xml`** with all seven public paths (`/`, `/services`, `/work`, `/apply`, `/privacy`, `/terms`, `/refund-policy`), each with `<loc>` and `<lastmod>2026-08-09</lastmod>`. Do **not** list `app.truhq.co` or any hash route.

- [ ] **Step 3: Turn on cookieless analytics at the edge — no script tag**

Terrason ran Vercel Web Analytics. Cloudflare Web Analytics is the equivalent on this host — cookieless, no cross-site tracking — and it is what keeps the privacy policy's cookie claim and the no-consent-banner decision true.

**Enable it through the Cloudflare Pages project, not by pasting a script tag:**

> Cloudflare dashboard → the Pages project → **Settings → Analytics → Web Analytics → Enable**

Pages then injects the beacon at the edge. Nothing is added to `index.html` and no third-party `<script src>` enters the source at all.

This is deliberate. The manual snippet loads `static.cloudflareinsights.com/beacon.min.js`, an unversioned file that cannot carry a Subresource Integrity hash — Cloudflare updates it in place, so any pinned hash would silently break analytics the first time they ship a change. Rather than choose between an unpinned third-party script and a fragile hash, the edge integration removes the script tag from our supply chain entirely.

**If the edge integration is ever unavailable** and the manual tag becomes necessary, treat it as a documented exception: record in this plan why SRI is absent, and re-check the Privacy Policy's cookie section at the same time.

**Standing rule, either way:** if analytics is ever swapped for a product that sets cookies or tracks across sites, the Privacy Policy cookie section (Task 8) and the decision not to show a consent banner **both** have to change with it. That coupling is the whole reason this vendor was chosen.

- [ ] **Step 4: Confirm the beacon is live and still cookieless**

On the preview deploy, open DevTools → Network and reload. Confirm a request to `cloudflareinsights.com` fires, then check **Application → Cookies**: the site must set **no** cookies. If any cookie appears, stop — the privacy policy is now inaccurate and the no-banner decision no longer holds.

- [ ] **Step 5: Verify head tags per route**

Run `npm run dev`, then on each of the seven paths inspect `<head>`: the title matches `META`, the description is present and unique, `link[rel=canonical]` points at the right absolute URL, and the `og:` tags are populated.

- [ ] **Step 6: Commit**

```bash
git add web/public/robots.txt web/public/sitemap.xml web/index.html
git commit -m "feat: indexing metadata and cookieless analytics"
```

---

### Task 13: Full verification sweep

Eric's explicit ask: check the work thoroughly, because plenty in the background can break. Nothing ships until every line below passes. This is spec § 8 executed against a real preview deploy.

**Files:** none created. Every failure is fixed in the task that owns it, then this sweep is re-run from the top.

- [ ] **Step 1: Automated guards**

```bash
cd web && npm run typecheck && npm test && npm run build
cd ../worker && npm run typecheck && npm test
cd ../web

# No price, anywhere in the shipped bundle.
grep -rE '\$3,?750|\$5,?250|\$6,?750|\$349|\$649|\$999|\$8\.2M|\$14M|147%|3\.1×' dist/ \
  && echo "FAIL: price or metric in build" || echo "clean"

# No outgoing entity name outside the one file that owns it.
grep -rni 'terrason' src/ --exclude-dir=config \
  && echo "FAIL: entity name leaked" || echo "clean"

# No unreleased-feature or unverified-behaviour claims.
grep -rniE 'coming soon|\(coming\)|nothing stored|preview build' src/ dist/ \
  && echo "FAIL: unshippable claim" || echo "clean"
```

All three must print `clean`.

- [ ] **Step 2: The product is unbroken — the checks that matter most**

On a Cloudflare Pages preview deploy, signed in as a real account:

- [ ] `/` logged out → marketing home; intro plays; skip works
- [ ] `#/login` → login screen; sign-in succeeds
- [ ] `/` **logged in → the product home, not the marketing page**
- [ ] `#/pulse`, `#/rep`, `#/prospect`, `#/studio` each open
- [ ] Onboarding renders for an org-less account
- [ ] The agent-course path still resolves for an agent login
- [ ] The impersonation banner appears and its exit button returns the owner
- [ ] A password-recovery / invite link lands on set-password
- [ ] `app.truhq.co` behaves identically to before this branch

- [ ] **Step 3: The marketing site**

- [ ] All seven paths load when typed directly into the address bar
- [ ] All seven survive a hard refresh (proves `_redirects`)
- [ ] Every nav, footer, and in-body link resolves — no dead route, no bare `#`
- [ ] Each page has exactly one `<h1>`, a working skip link, a correct title, and the footer
- [ ] The footer shows entity name, address, contact email, and all three policy links

- [ ] **Step 4: Data and consent**

- [ ] Anonymous and signed-in non-admin clients both fail to read `applications`
- [ ] Opt-in ticked and unticked both store correctly, with consent text and timestamp
- [ ] Both notification emails arrive

- [ ] **Step 5: Accessibility and responsive**

- [ ] Keyboard-only pass through `/apply` — every control reachable, focus always visible
- [ ] `prefers-reduced-motion` on `/` skips the intro and pauses the background video
- [ ] Under 760px the square intro reveal triggers and the layout does not scroll sideways
- [ ] Lighthouse on `/` and `/services` — record scores; investigate any regression against `landing-cinematic`

- [ ] **Step 6: Record the result and open the PR**

Write the outcome of every check into the PR body — including anything that failed and how it was fixed. A sweep with unrecorded failures is not a sweep.

```bash
git push -u origin feat/business-site
gh pr create --title "TRU HQ business site: consulting-first migration + legal layer" \
  --body-file <(cat <<'EOF'
Replaces the software landing page at truhq.co with the business site, ported
from terrasonconsulting.com (archived in docs/terrason-site-archive.md before
the third-party host can take it down).

Spec: docs/superpowers/specs/2026-08-09-truhq-business-site-design.md
Plan: docs/superpowers/plans/2026-08-09-truhq-business-site.md

- Consulting-first positioning; TRU Pulse/Coach/Rep reframed as included tooling
- Four packages by team size, no dollar figures anywhere
- Privacy, terms, and refund policies under the TRU brand, entity in one constant
- Compliant footer, results disclaimer, separated form notice and marketing opt-in
- Application intake stored under deny-all RLS with provable consent
- Product routing untouched; verification results below

## Verification
<paste the completed checklist from Steps 1–5>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

---

## Self-Review

**Spec coverage.** § 3 brand/entity → Task 1. § 4 page inventory → Tasks 3–9. § 5.1 home → Task 5. § 5.2 services → Task 6. § 5.3 work → Task 7. § 5.4 apply → Task 9. § 6.1 policies → Task 8. § 6.2 results disclaimer → Task 7 Step 2. § 6.3 form consent → Task 9 Step 1 + Task 11 Steps 1–2. § 6.4 footer → Task 3 Step 3. § 6.5 accessibility → Task 3 Step 4, Task 9 Step 5, Task 13 Step 5. § 6.6 claims hygiene → Task 5 (deletions) + Task 13 Step 1 (grep). § 7.2 routing → Tasks 2 and 4. § 7.3 form handling → Task 10. § 7.4 head/indexing/analytics → Task 12. § 7.5 not breaking the product → Task 1 Step 1, Task 4 Step 6, Task 13 Step 2. § 8 verification → Task 13. No gaps.

**Placeholders.** None. Every code step carries real code; every copy step names the archive section and the exact deviations from it.

**Type consistency.** `matchPublicRoute(pathname, hash)` returns `PublicSubRoute | null` in Task 2 and is consumed that way in Task 4. `PublicRoute` (including `'/'`) types `PublicSite`, `SiteHeader`, `META`, and `PageMeta.path`. `validateApplication` returns the same discriminated union in Task 10's tests, implementation, and route handler; the `ApplicationInput` field names match the `snake_case` column names through an explicit mapping in the route block, not by accident.

**Known follow-ups, deliberately out of scope.** No marketing email may be sent until a list tool with one-click unsubscribe and a physical address in the footer is in place (spec § 6.3) — that blocks *sending*, not shipping. The contact address moves to a `truhq.co` mailbox whenever Eric creates one. `PENDING_ENTITY_CHANGE` flips when the new entity is registered.
