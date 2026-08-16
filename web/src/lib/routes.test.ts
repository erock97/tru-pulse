import { describe, expect, it } from 'vitest';
import { matchPublicRoute, PUBLIC_ROUTES } from './routes';

describe('matchPublicRoute', () => {
  it('matches /about and ignores a trailing slash or case', () => {
    expect(matchPublicRoute('/about', '')).toBe('/about');
    expect(matchPublicRoute('/about/', '')).toBe('/about');
    expect(matchPublicRoute('/About', '')).toBe('/about');
  });

  it('never claims the root path — that is the product', () => {
    expect(matchPublicRoute('/', '')).toBeNull();
    expect(matchPublicRoute('', '')).toBeNull();
    expect(matchPublicRoute('/', '#/pulse')).toBeNull();
  });

  it('yields to the product when an app hash route is present', () => {
    expect(matchPublicRoute('/about', '#/pulse')).toBeNull();
    expect(matchPublicRoute('/about', '#/login')).toBeNull();
  });

  it('still matches when the hash is an in-page anchor', () => {
    expect(matchPublicRoute('/about', '#cta')).toBe('/about');
  });

  it('returns null for anything unknown', () => {
    expect(matchPublicRoute('/services', '')).toBeNull();
    expect(matchPublicRoute('/insights', '')).toBeNull();
  });

  it('exposes only the about path until the rest of the marketing site lands on main', () => {
    expect(PUBLIC_ROUTES).toEqual(['/about']);
  });
});
