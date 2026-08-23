// Public marketing paths that render outside the logged-in product.
//
// The legal three (/privacy, /terms, /refund-policy) are NOT optional. They are
// linked from the footer, a payment processor expects them to resolve, and
// truhq.co has been serving them from a branch that never merged. Dropping them
// from this list is how they vanish from the internet.
//
// "/" is listed so PublicSite can render the marketing home, but
// matchPublicRoute never claims it. The product lives at "/" plus a hash
// route. A match on root would show every customer the marketing page
// instead of HQ. App renders the marketing home itself, inside its
// existing signed-out branch.
//
// A "#/" hash is an app route and also yields. A bare "#anchor" is an
// in-page link on a marketing page and is fine.
//
// Anything else - /engagement, a guessed URL - is 'not-found'.
// Returning null used to drop those into App, which signed-out renders
// as the marketing home. Dead paths must not look like a broken deep link.

export const PUBLIC_ROUTES = [
  '/', '/services', '/work', '/about', '/apply',
  '/privacy', '/terms', '/refund-policy',
] as const;
export const NOT_FOUND = 'not-found' as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];
export type PublicSubRoute = Exclude<PublicRoute, '/'>;
export type PublicMatch = PublicSubRoute | typeof NOT_FOUND;
export type PublicView = PublicRoute | typeof NOT_FOUND;

const SUB_ROUTES = PUBLIC_ROUTES.filter((r): r is PublicSubRoute => r !== '/');

export function matchPublicRoute(pathname: string, hash: string): PublicMatch | null {
  if (/^#\//.test(hash)) return null;
  let p = (pathname || '/').toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '/' || p === '') return null;
  return (SUB_ROUTES as readonly string[]).includes(p) ? (p as PublicSubRoute) : NOT_FOUND;
}

/* ---------------------------------------------------------------------------
   WHICH SITE IS THIS?

   truhq.co and app.truhq.co are two Cloudflare Pages projects serving the same
   bundle, and `matchPublicRoute` deliberately never claims "/" because on the
   app host the root is the product.

   That leaves the marketing site with no home page. On this branch, a signed-out
   visitor to "/" gets the login form, because App's signed-out face is the door
   and that is correct FOR THE APP HOST. truhq.co has only ever shown its
   marketing home because it is built from a branch where App had not been
   changed yet. Rebuild it from main and the front page of the business becomes
   a sign-in box, silently, with no error to notice. Same shape of trap as the
   legal pages, one level up.

   So the host decides. app.truhq.co keeps exactly the behaviour it has; the
   marketing hosts get their home page back.

   `?site` forces marketing mode on any host, which is the only way to review
   the marketing home on localhost or on an app preview deployment. It reads a
   query flag rather than a build variable because both properties are built by
   the same `npm run build`.
   --------------------------------------------------------------------------- */
const MARKETING_HOSTS = ['truhq.co', 'www.truhq.co'];

export function isMarketingHost(host: string, search = ''): boolean {
  // URLSearchParams rather than a hand-written pattern. The first version of
  // this line carried a literal backspace byte where a `\b` was meant to be,
  // so the regex looked correct in every grep and matched nothing at all.
  try {
    if (new URLSearchParams(search).has('site')) return true;
  } catch {
    /* a malformed query string simply is not the flag */
  }
  const h = (host || '').toLowerCase().replace(/:\d+$/, '');
  // CONTAINS, not startsWith. A Pages preview alias is
  // `<branch>.<project>.pages.dev`, so the project name sits in the middle:
  // `feat-landing.tru-landing.pages.dev`. The first version of this checked
  // the start, which meant every preview of the marketing site rendered the
  // login screen instead - caught on the first deploy, by the preview itself.
  // `app.truhq.co` contains none of it, so the app host is unaffected.
  return MARKETING_HOSTS.includes(h) || h.includes('tru-landing');
}

/** The route to render, once the host has been taken into account. Returns null
 *  when the product should handle it. */
export function resolveView(
  pathname: string,
  hash: string,
  host: string,
  search = '',
): PublicMatch | '/' | null {
  const matched = matchPublicRoute(pathname, hash);
  if (matched) return matched;
  // An app hash route wins on any host: /#/pulse is the product, wherever it
  // is typed.
  if (/^#\//.test(hash)) return null;
  const p = (pathname || '/').toLowerCase().replace(/\/+$/, '');
  if ((p === '' || p === '/') && isMarketingHost(host, search)) return '/';
  return null;
}
