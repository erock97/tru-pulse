// Public marketing paths that render outside the logged-in product.
//
// "/" is the product (login / dashboard). Never claim it here — a match on
// root would show every customer the marketing page instead of HQ.
// A "#/" hash is an app route and also yields. A bare "#anchor" is an
// in-page link on a marketing page and is fine.

export const PUBLIC_ROUTES = ['/about'] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

export function matchPublicRoute(pathname: string, hash: string): PublicRoute | null {
  if (/^#\//.test(hash)) return null;
  let p = (pathname || '/').toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '/' || p === '') return null;
  return (PUBLIC_ROUTES as readonly string[]).includes(p) ? (p as PublicRoute) : null;
}
