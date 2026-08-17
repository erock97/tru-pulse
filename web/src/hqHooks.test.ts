import { describe, expect, it } from 'vitest';
import { forceHqDarkTheme, HQ_THEME_KEY } from './hqHooks';

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

function fakeRoot(theme: string | null = 'warm') {
  const attrs: Record<string, string> = {};
  if (theme) attrs['data-theme'] = theme;
  return {
    attrs,
    removeAttribute: (name: string) => { delete attrs[name]; },
  };
}

describe('forceHqDarkTheme', () => {
  it('rewrites a stale Warm preference to Dark and clears data-theme', () => {
    const store = fakeStore({ [HQ_THEME_KEY]: 'warm' });
    const root = fakeRoot('warm');
    forceHqDarkTheme(store, root);
    expect(store.getItem(HQ_THEME_KEY)).toBe('dark');
    expect(root.attrs['data-theme']).toBeUndefined();
  });

  it('leaves an existing Dark preference alone', () => {
    const store = fakeStore({ [HQ_THEME_KEY]: 'dark' });
    const root = fakeRoot(null);
    forceHqDarkTheme(store, root);
    expect(store.getItem(HQ_THEME_KEY)).toBe('dark');
  });

  it('is safe when storage and document are missing', () => {
    expect(() => forceHqDarkTheme(null, null)).not.toThrow();
  });
});
