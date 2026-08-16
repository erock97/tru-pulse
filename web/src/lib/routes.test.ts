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

  it('returns not-found for unknown paths so they cannot fall through to Home', () => {
    expect(matchPublicRoute('/work', '')).toBe('not-found');
    expect(matchPublicRoute('/insights', '')).toBe('not-found');
    expect(matchPublicRoute('/privacy', '')).toBe('not-found');
    expect(matchPublicRoute('/terms', '')).toBe('not-found');
    expect(matchPublicRoute('/refund-policy', '')).toBe('not-found');
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

  it('lists root first so PublicSite can render the marketing home, then the sub-routes on this branch', () => {
    expect(PUBLIC_ROUTES).toEqual(['/', '/services', '/about', '/apply']);
  });
});
