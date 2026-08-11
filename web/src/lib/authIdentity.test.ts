import { describe, it, expect } from 'vitest';
import { userIdOf, identityChanged } from './authIdentity';

describe('userIdOf', () => {
  it('reads the id out of a session', () => {
    expect(userIdOf({ user: { id: 'u1' } })).toBe('u1');
  });
  it('treats a signed-out session as no user', () => {
    expect(userIdOf(null)).toBeNull();
    expect(userIdOf(undefined)).toBeNull();
    expect(userIdOf({} as never)).toBeNull();
  });
});

describe('identityChanged', () => {
  // The whole point: a token refresh hands us a NEW session object for the
  // SAME person. That must not count as a change, or the app tears itself down.
  it('is false when the same user comes back with a fresh token', () => {
    expect(identityChanged('u1', 'u1')).toBe(false);
  });
  it('is true on first resolution, when we knew nothing yet', () => {
    expect(identityChanged(undefined, 'u1')).toBe(true);
    expect(identityChanged(undefined, null)).toBe(true);
  });
  it('is true when a different user signs in', () => {
    expect(identityChanged('u1', 'u2')).toBe(true);
  });
  it('is true on sign-out and on sign-in', () => {
    expect(identityChanged('u1', null)).toBe(true);
    expect(identityChanged(null, 'u1')).toBe(true);
  });
  it('is false when signed out and still signed out', () => {
    expect(identityChanged(null, null)).toBe(false);
  });
});
