// The marketing site's real URLs. The PRODUCT lives at "/" plus a hash route
// (#/pulse, #/rep, …) and must never be intercepted, so:
//
//   1. matchPublicRoute never claims "/" — the home page is rendered by App's
//      existing logged-out branch, which leaves logged-in users alone.
//   2. Any "#/"-style hash means the product is being addressed; yield to it.
//      A bare "#anchor" is an in-page link on a marketing page and is fine.

export const PUBLIC_ROUTES = [
  '/', '/services', '/work', '/about', '/apply', '/privacy', '/terms', '/refund-policy',
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
