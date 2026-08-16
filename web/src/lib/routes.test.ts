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

  it('returns null for anything unknown — Work and legal stay off this branch', () => {
    expect(matchPublicRoute('/work', '')).toBeNull();
    expect(matchPublicRoute('/insights', '')).toBeNull();
    expect(matchPublicRoute('/privacy', '')).toBeNull();
  });

  it('lists root first so PublicSite can render the marketing home, then the sub-routes on this branch', () => {
    expect(PUBLIC_ROUTES).toEqual(['/', '/services', '/about', '/apply']);
  });
});
