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
