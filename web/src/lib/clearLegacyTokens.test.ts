import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearLegacyTokens } from './clearLegacyTokens';

// These tests run in node, where there is no localStorage — the rest of this suite is
// pure functions. A small stand-in beats switching the whole suite to a DOM environment
// for one module. Object.keys() over it must work, since that is how the real code finds
// the keys to delete.
function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  const api = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); Object.assign(api, { [k]: v }); },
    removeItem: (k: string) => { store.delete(k); delete (api as Record<string, unknown>)[k]; },
    clear: () => { for (const k of store.keys()) delete (api as Record<string, unknown>)[k]; store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  return api as unknown as Storage;
}

// The keys are matched by shape rather than by project id, so the tests that matter are
// the boundary ones: it must catch any project's token, and must not touch the app's
// own saved work (unsent 1:1 drafts, the theme choice).
describe('clearLegacyTokens', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeLocalStorage()); });

  it('removes a pre-cutover Supabase token for any project', () => {
    localStorage.setItem('sb-yeyoteredgunhvhqmais-auth-token', '{"access_token":"x"}');
    localStorage.setItem('sb-someotherproject-auth-token', '{"access_token":"y"}');
    clearLegacyTokens();
    expect(localStorage.getItem('sb-yeyoteredgunhvhqmais-auth-token')).toBeNull();
    expect(localStorage.getItem('sb-someotherproject-auth-token')).toBeNull();
  });

  it('removes the stashed owner token that acting-as used to leave behind', () => {
    localStorage.setItem('hq_admin_return', '{"at":"owner","rt":"refresh"}');
    clearLegacyTokens();
    expect(localStorage.getItem('hq_admin_return')).toBeNull();
  });

  it('leaves the user\'s own saved work alone', () => {
    localStorage.setItem('pulse:1on1draft:abc', 'a half-written 1:1');
    localStorage.setItem('tru-hq-theme', 'dark');
    // Near-misses that must survive: neither is a credential.
    localStorage.setItem('sb-not-a-token', 'keep');
    localStorage.setItem('auth-token', 'keep');
    clearLegacyTokens();
    expect(localStorage.getItem('pulse:1on1draft:abc')).toBe('a half-written 1:1');
    expect(localStorage.getItem('tru-hq-theme')).toBe('dark');
    expect(localStorage.getItem('sb-not-a-token')).toBe('keep');
    expect(localStorage.getItem('auth-token')).toBe('keep');
  });

  it('is safe to call when there is nothing to clear', () => {
    expect(() => clearLegacyTokens()).not.toThrow();
    expect(localStorage.length).toBe(0);
  });
});
