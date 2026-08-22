import { describe, expect, it } from 'vitest';
import { matchPublicRoute, PUBLIC_ROUTES } from './routes';

describe('matchPublicRoute', () => {
  it('matches /about, /services, and /apply and ignores a trailing slash or case', () => {
    expect(matchPublicRoute('/about', '')).toBe('/about');
    expect(matchPublicRoute('/about/', '')).toBe('/about');
    expect(matchPublicRoute('/About', '')).toBe('/about');
    expect(matchPublicRoute('/services', '')).toBe('/services');
    expect(matchPublicRoute('/services/', '')).toBe('/services');
    expect(matchPublicRoute('/Services', '')).toBe('/services');
    expect(matchPublicRoute('/apply', '')).toBe('/apply');
    expect(matchPublicRoute('/apply/', '')).toBe('/apply');
    expect(matchPublicRoute('/Apply', '')).toBe('/apply');
  });

  it('never claims the root path — logged-in HQ stays at /', () => {
    expect(matchPublicRoute('/', '')).toBeNull();
    expect(matchPublicRoute('', '')).toBeNull();
    expect(matchPublicRoute('/', '#/pulse')).toBeNull();
  });

  it('yields to the product when an app hash route is present', () => {
    expect(matchPublicRoute('/about', '#/pulse')).toBeNull();
    expect(matchPublicRoute('/services', '#/login')).toBeNull();
  });

  it('still matches when the hash is an in-page anchor', () => {
    expect(matchPublicRoute('/about', '#cta')).toBe('/about');
    expect(matchPublicRoute('/services', '#packages')).toBe('/services');
  });

  /* The legal three resolve, and that is load-bearing rather than cosmetic:
     they are linked from the footer, a payment processor expects them to exist,
     and truhq.co had been serving them from a branch that never merged. This
     test previously asserted the OPPOSITE — that /privacy was not-found — which
     is exactly the state that would have deleted them from the internet the
     first time the site was rebuilt from main. */
  it('resolves the legal pages and Work', () => {
    expect(matchPublicRoute('/privacy', '')).toBe('/privacy');
    expect(matchPublicRoute('/terms', '')).toBe('/terms');
    expect(matchPublicRoute('/refund-policy', '')).toBe('/refund-policy');
    expect(matchPublicRoute('/refund-policy/', '')).toBe('/refund-policy');
    expect(matchPublicRoute('/Privacy', '')).toBe('/privacy');
    expect(matchPublicRoute('/work', '')).toBe('/work');
  });

  it('returns not-found for unknown paths so they cannot fall through to Home', () => {
    expect(matchPublicRoute('/insights', '')).toBe('not-found');
    expect(matchPublicRoute('/engagement', '')).toBe('not-found');
    expect(matchPublicRoute('/engagement/', '')).toBe('not-found');
    expect(matchPublicRoute('/this-is-not-a-page', '')).toBe('not-found');
    expect(matchPublicRoute('/tru-rep', '')).toBe('not-found');
    expect(matchPublicRoute('/training', '')).toBe('not-found');
    expect(matchPublicRoute('/tru-pulse', '')).toBe('not-found');
  });

  it('still yields to the product when an app hash sits on an unknown path', () => {
    expect(matchPublicRoute('/engagement', '#/login')).toBeNull();
    expect(matchPublicRoute('/this-is-not-a-page', '#/rep')).toBeNull();
  });

  it('treats a bare in-page hash on an unknown path as not-found, not Home', () => {
    expect(matchPublicRoute('/engagement', '#cta')).toBe('not-found');
  });

  it('lists root first so PublicSite can render the marketing home, then every sub-route', () => {
    expect(PUBLIC_ROUTES).toEqual([
      '/', '/services', '/work', '/about', '/apply',
      '/privacy', '/terms', '/refund-policy',
    ]);
  });

  /* Every route in the list must have a page behind it. The failure this guards
     against is silent: add a path here, forget the branch in PublicSite, and the
     route resolves to a blank main element rather than to a 404. */
  it('keeps a page wired for every public route', async () => {
    const { META } = await import('../site/PublicSite');
    for (const r of PUBLIC_ROUTES) {
      expect(META[r], `no META for ${r}`).toBeTruthy();
      expect(META[r].title, `no title for ${r}`).toBeTruthy();
    }
  });
});
