// The Follow Up Boss client carries every tenant's API key and decides how much of
// their history we actually pull. Untested until now; these cover the SSRF guard on
// cursor pagination, the retry/backoff contract, the cursor walk + window stop, and
// the per-person contact counts the "worked" rule is built on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fubGetUrl, pullPeople, countOutgoingTexts, countCalls, pullPonds } from './fub.js';

const KEY = 'fka_test_key';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

let calls: string[];
beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Stub fetch with a handler; every requested URL is recorded in `calls`. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    return handler(url, init);
  }));
}

describe('fubGetUrl — credential containment', () => {
  it('refuses to send the tenant key anywhere but api.followupboss.com', async () => {
    stubFetch(() => jsonResponse({ ok: true }));
    for (const evil of [
      'https://evil.example.com/v1/people',
      'https://api.followupboss.com.evil.example.com/v1/people',
      'http://api.followupboss.com/v1/people', // downgraded to plaintext
    ]) {
      const r = await fubGetUrl(KEY, evil);
      expect(r.status).toBe(400);
    }
    // Nothing was ever dialled — the key never left the Worker.
    expect(calls).toEqual([]);
  });

  it('rejects a malformed url without throwing', async () => {
    stubFetch(() => jsonResponse({}));
    expect((await fubGetUrl(KEY, 'not-a-url')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('allows a genuine FUB cursor link', async () => {
    stubFetch(() => jsonResponse({ people: [] }));
    const r = await fubGetUrl(KEY, 'https://api.followupboss.com/v1/people?next=abc');
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

describe('pullPeople — cursor pagination', () => {
  it('walks nextLink across pages and returns every person', async () => {
    const page = (ids: number[], next?: string) => jsonResponse({
      people: ids.map((id) => ({ id, created: '2026-08-01T00:00:00Z' })),
      _metadata: next ? { nextLink: next } : {},
    });
    const full = Array.from({ length: 100 }, (_, i) => i);
    let n = 0;
    stubFetch(() => {
      n++;
      if (n === 1) return page(full, 'https://api.followupboss.com/v1/people?next=2');
      if (n === 2) return page(full.map((i) => i + 100), 'https://api.followupboss.com/v1/people?next=3');
      return page([9999]); // short page ends the walk
    });
    const people = await pullPeople(KEY, Date.parse('2020-01-01T00:00:00Z'));
    expect(people).toHaveLength(201);
    expect(people[people.length - 1].id).toBe(9999);
  });

  it('stops once a page predates the window, but keeps that page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i, created: '2020-01-01T00:00:00Z' }));
    stubFetch(() => jsonResponse({ people: full, _metadata: { nextLink: 'https://api.followupboss.com/v1/people?next=2' } }));
    const people = await pullPeople(KEY, Date.parse('2026-01-01T00:00:00Z'));
    expect(people).toHaveLength(100);
    expect(calls).toHaveLength(1); // never asked for page 2
  });

  it('stops cleanly when FUB stops returning a cursor', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i, created: '2026-08-01T00:00:00Z' }));
    stubFetch(() => jsonResponse({ people: full, _metadata: {} }));
    const people = await pullPeople(KEY, Date.parse('2020-01-01T00:00:00Z'));
    expect(people).toHaveLength(100);
    expect(calls).toHaveLength(1);
  });

  it('returns what it has when FUB errors mid-walk rather than throwing', async () => {
    let n = 0;
    stubFetch(() => {
      n++;
      if (n === 1) {
        return jsonResponse({
          people: Array.from({ length: 100 }, (_, i) => ({ id: i, created: '2026-08-01T00:00:00Z' })),
          _metadata: { nextLink: 'https://api.followupboss.com/v1/people?next=2' },
        });
      }
      return jsonResponse({ error: 'boom' }, 500);
    });
    const people = await pullPeople(KEY, Date.parse('2020-01-01T00:00:00Z'));
    expect(people).toHaveLength(100);
  });
});

describe('fubGet — rate-limit retry', () => {
  it('honors Retry-After on a 429 and then succeeds', async () => {
    let n = 0;
    stubFetch(() => {
      n++;
      if (n === 1) return jsonResponse({}, 429, { 'Retry-After': '2' });
      return jsonResponse({ ponds: [{ id: 5, name: 'Overflow' }] });
    });
    const promise = pullPonds(KEY);
    await vi.advanceTimersByTimeAsync(2500);
    const ponds = await promise;
    expect(n).toBe(2);
    expect(ponds.get(5)).toBe('Overflow');
  });

  it('gives up after 4 attempts instead of looping forever', async () => {
    stubFetch(() => jsonResponse({}, 503));
    const promise = countCalls(KEY, 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await promise).toBe(0);
    expect(calls).toHaveLength(4);
  });
});

describe('per-person contact counts (the "worked" rule inputs)', () => {
  it('counts only non-incoming texts', async () => {
    stubFetch(() => jsonResponse({
      textmessages: [
        { isIncoming: true }, { isIncoming: false }, { isIncoming: false }, {},
      ],
    }));
    // isIncoming !== true → the two explicit outgoing plus the one with no flag.
    expect(await countOutgoingTexts(KEY, 42)).toBe(3);
  });

  it('reads either casing FUB has used for the text collection', async () => {
    stubFetch(() => jsonResponse({ textMessages: [{ isIncoming: false }] }));
    expect(await countOutgoingTexts(KEY, 42)).toBe(1);
  });

  it('counts calls in either direction, falling back to the reported total', async () => {
    stubFetch(() => jsonResponse({ calls: [{ id: 1 }, { id: 2 }] }));
    expect(await countCalls(KEY, 42)).toBe(2);

    stubFetch(() => jsonResponse({ calls: [], _metadata: { total: 7 } }));
    expect(await countCalls(KEY, 42)).toBe(7);
  });

  it('never invents contact out of an error response', async () => {
    stubFetch(() => jsonResponse({ error: 'nope' }, 401));
    expect(await countOutgoingTexts(KEY, 42)).toBe(0);
    expect(await countCalls(KEY, 42)).toBe(0);
  });
});
