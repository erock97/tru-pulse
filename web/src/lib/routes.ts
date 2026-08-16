// Public marketing paths that render outside the logged-in product.
//
// "/" is listed so PublicSite can render the marketing home, but
// matchPublicRoute never claims it. The product lives at "/" plus a hash
// route. A match on root would show every customer the marketing page
// instead of HQ. App renders the marketing home itself, inside its
// existing signed-out branch.
//
// A "#/" hash is an app route and also yields. A bare "#anchor" is an
// in-page link on a marketing page and is fine.

export const PUBLIC_ROUTES = ['/', '/services', '/about'] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];
export type PublicSubRoute = Exclude<PublicRoute, '/'>;

const SUB_ROUTES = PUBLIC_ROUTES.filter((r): r is PublicSubRoute => r !== '/');

export function matchPublicRoute(pathname: string, hash: string): PublicSubRoute | null {
  if (/^#\//.test(hash)) return null;
  let p = (pathname || '/').toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '/' || p === '') return null;
  return (SUB_ROUTES as readonly string[]).includes(p) ? (p as PublicSubRoute) : null;
}
