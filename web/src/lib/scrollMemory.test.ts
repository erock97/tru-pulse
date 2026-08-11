import { describe, it, expect } from 'vitest';
import { scrollKey, saveScroll, readScroll, type ScrollStore } from './scrollMemory';

/** A stand-in for sessionStorage — the node test env has no window. */
function fakeStore(): ScrollStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

describe('scrollKey', () => {
  it('is namespaced per agent', () => {
    expect(scrollKey('a1')).toBe('pulse:1on1scroll:a1');
    expect(scrollKey('a1')).not.toBe(scrollKey('a2'));
  });
});

describe('saveScroll / readScroll', () => {
  it('round-trips an offset', () => {
    const s = fakeStore();
    saveScroll(s, scrollKey('a1'), 420);
    expect(readScroll(s, scrollKey('a1'))).toBe(420);
  });

  it('returns null for an agent never scrolled', () => {
    expect(readScroll(fakeStore(), scrollKey('a1'))).toBeNull();
  });

  it('keeps each agent separate', () => {
    const s = fakeStore();
    saveScroll(s, scrollKey('a1'), 100);
    saveScroll(s, scrollKey('a2'), 900);
    expect(readScroll(s, scrollKey('a1'))).toBe(100);
    expect(readScroll(s, scrollKey('a2'))).toBe(900);
  });

  it('rejects a stored value that is not a usable number', () => {
    const s = fakeStore();
    s.map.set(scrollKey('a1'), 'not-a-number');
    expect(readScroll(s, scrollKey('a1'))).toBeNull();
    s.map.set(scrollKey('a2'), '-5');
    expect(readScroll(s, scrollKey('a2'))).toBeNull();
  });

  it('is a no-op without a store, instead of throwing', () => {
    expect(() => saveScroll(null, scrollKey('a1'), 10)).not.toThrow();
    expect(readScroll(null, scrollKey('a1'))).toBeNull();
  });

  it('survives a store that throws (private mode / quota)', () => {
    const hostile: ScrollStore = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(() => saveScroll(hostile, scrollKey('a1'), 10)).not.toThrow();
    expect(readScroll(hostile, scrollKey('a1'))).toBeNull();
  });
});
