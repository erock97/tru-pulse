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
