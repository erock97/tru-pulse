// The phone relay. The failure that matters here is not "the text did not
// arrive" — that is visible. It is "the text arrived twice", and "the text
// never arrived and nothing said so".
import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import {
  buildAndClaim, toTaskerText, acknowledge, relayAuthorised, relayTokenFrom,
  normalisePhone, maskPhone, localDate, handleRelayRoutes, isId, NOTHING,
} from './relay.js';

const NOW = new Date('2026-08-25T13:45:00.000Z');   // 9:45am Eastern

/** A store holding one team whose brief has something new to say. */
function stub(over: {
  recipients?: any[];
  patternRows?: any[];
  /** Simulate the day's key already being taken. */
  alreadyClaimed?: boolean;
} = {}) {
  const inserted: any[] = [];
  const updates: Array<{ table: string; query: string; patch: any }> = [];

  const patternRows = over.patternRows ?? [{
    id: '11111111-1111-4111-8111-111111111111', team_id: 'team-1', agent_id: 'a1', agent_name: 'Cara Benak',
    pattern_key: 'lead_e', explanation: 'Ends texts without a time.',
    occurrences: 3, occurrences_this_window: 3,
    is_current: true, is_recurring: true, brief_worthy: true,
    window_start: '2026-08-18', window_end: '2026-08-24',
    last_update: '2026-08-25T12:00:00.000Z',
  }];

  const db = {
    select: vi.fn(async (table: string, query: string) => {
      if (table === 'coach_patterns_live') {
        if (query.includes('id=in.')) {
          return patternRows.map((r) => ({ id: r.id, occurrences: r.occurrences }));
        }
        return patternRows;
      }
      if (table === 'teams') return [{ id: 'team-1', name: 'Costigan' }];
      if (table === 'agents') return [{ id: 'a1', role: 'agent' }];
      if (table === 'brief_recipients') {
        return over.recipients
          ?? [{ team_id: 'team-1', kind: 'coach_daily', phone: '15551234567' }];
      }
      if (table === 'brief_sends') {
        return inserted
          .filter((r) => query.includes(r.id))
          .map((r) => ({ id: r.id, pattern_ids: r.pattern_ids }));
      }
      return [];
    }),
    insert: vi.fn(async (table: string, row: any) => {
      if (table === 'brief_sends') {
        if (over.alreadyClaimed || inserted.some((r) => r.idempotency_key === row.idempotency_key)) {
          throw new Error('duplicate key value violates unique constraint "brief_sends_idempotency_key_key"');
        }
        const saved = { id: `0000000${inserted.length + 1}-0000-4000-8000-000000000000`, ...row };
        inserted.push(saved);
        return saved;
      }
      return row;
    }),
    update: vi.fn(async (table: string, query: string, patch: any) => {
      updates.push({ table, query, patch });
    }),
    upsert: vi.fn(async () => undefined),
  } as unknown as Db;

  return { db, inserted, updates };
}

describe('the same morning, polled twice', () => {
  it('hands the brief over once', async () => {
    const s = stub();
    const first = await buildAndClaim(s.db, NOW);
    expect(first.queued).toHaveLength(1);
    expect(first.queued[0].team).toBe('Costigan');

    // Tasker retries on a flaky connection, or a second phone polls.
    const second = await buildAndClaim(s.db, NOW);
    expect(second.queued).toHaveLength(0);
    expect(second.skipped).toEqual([{ team: 'Costigan', reason: 'already sent today' }]);
  });

  it('claims by the insert, not by looking first', async () => {
    // Two polls arriving together both pass any read-then-write check. The
    // unique key is the only thing that actually decides.
    const s = stub();
    const [a, b] = await Promise.all([
      buildAndClaim(s.db, NOW),
      buildAndClaim(s.db, NOW),
    ]);
    expect(a.queued.length + b.queued.length).toBe(1);
    expect(s.inserted).toHaveLength(1);
  });

  it('keys the claim on the recipient s own date', async () => {
    const s = stub();
    await buildAndClaim(s.db, NOW);
    expect(s.inserted[0].idempotency_key).toBe('team-1:coach_daily:2026-08-25');
  });
});

describe('a claim that never reached anybody', () => {
  it('leaves the habits unmarked until the phone confirms', async () => {
    // The whole point of separating these. If claiming also marked the habits
    // as told, a text that failed to send would take its subject matter with
    // it and nobody would ever hear about it again.
    const s = stub();
    await buildAndClaim(s.db, NOW);
    const markedPatterns = s.updates.filter((u) => u.table === 'coach_patterns');
    expect(markedPatterns).toEqual([]);
  });

  it('marks them once the phone acknowledges', async () => {
    const s = stub();
    const { queued } = await buildAndClaim(s.db, NOW);
    const out = await acknowledge(s.db, queued.map((q) => q.sendId), NOW);
    expect(out.acked).toBe(1);
    expect(out.patternsMarked).toBe(1);
    const marked = s.updates.find((u) => u.table === 'coach_patterns');
    expect(marked?.patch).toMatchObject({ briefed_occurrences: 3 });
  });

  it('ignores an acknowledgement for something never claimed', async () => {
    const s = stub();
    expect(await acknowledge(s.db, ['99999999-9999-4999-8999-999999999999'], NOW))
      .toEqual({ acked: 0, patternsMarked: 0 });
  });
});

describe('reasons a team is quiet', () => {
  it('sends nothing when there is nobody to send to', async () => {
    const s = stub({ recipients: [] });
    const out = await buildAndClaim(s.db, NOW);
    expect(out.queued).toHaveLength(0);
    expect(out.skipped[0].reason).toBe('no recipient set');
  });

  it('sends nothing when nothing has moved since yesterday', async () => {
    const s = stub({
      patternRows: [{
        id: '11111111-1111-4111-8111-111111111111', team_id: 'team-1', agent_id: 'a1', agent_name: 'Cara Benak',
        pattern_key: 'lead_e', occurrences: 3, occurrences_this_window: 3,
        is_current: true, is_recurring: true, brief_worthy: false,
        window_start: '2026-08-18', window_end: '2026-08-24',
        last_update: '2026-08-25T12:00:00.000Z',
      }],
    });
    const out = await buildAndClaim(s.db, NOW);
    expect(out.queued).toHaveLength(0);
    expect(out.skipped[0].reason).toBe('nothing new since yesterday');
    // And it took no claim, so a report arriving later today can still send.
    expect(s.inserted).toHaveLength(0);
  });

  it('refuses to text stale coaching as if it were today s', async () => {
    // Hermes runs daily. Two days of silence means the laptop did not run, and
    // presenting last week's thinking as this morning's is worse than quiet.
    const s = stub({
      patternRows: [{
        id: '11111111-1111-4111-8111-111111111111', team_id: 'team-1', agent_id: 'a1', agent_name: 'Cara Benak',
        pattern_key: 'lead_e', occurrences: 3, occurrences_this_window: 3,
        is_current: true, is_recurring: true, brief_worthy: true,
        window_start: '2026-08-11', window_end: '2026-08-17',
        last_update: '2026-08-20T12:00:00.000Z',
      }],
    });
    const out = await buildAndClaim(s.db, NOW);
    expect(out.queued).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/analysis is \d+h old/);
  });

  it('names every reason rather than just going silent', async () => {
    // A quiet morning and a broken relay look identical from the outside
    // unless the skip says which it was.
    const s = stub({ recipients: [] });
    const out = await buildAndClaim(s.db, NOW);
    expect(out.skipped).toEqual([{ team: 'Costigan', reason: 'no recipient set' }]);
  });
});

describe('a look must not consume the send', () => {
  it('takes no claim when peeking', async () => {
    const s = stub();
    const peeked = await buildAndClaim(s.db, NOW, { peek: true });
    expect(peeked.queued).toHaveLength(1);
    expect(s.inserted).toHaveLength(0);

    // The real poll still gets it.
    const real = await buildAndClaim(s.db, NOW);
    expect(real.queued).toHaveLength(1);
  });
});

describe('the wire format Tasker already parses', () => {
  it('is digits, separator, message', async () => {
    const s = stub();
    const { queued } = await buildAndClaim(s.db, NOW);
    const text = toTaskerText(queued);
    expect(text.startsWith('15551234567~~~TRU Coach')).toBe(true);
  });

  it('joins several teams with the record separator', () => {
    const text = toTaskerText([
      { teamId: 't1', team: 'A', recipient: '15550000001', body: 'one', segments: 1, patternIds: [], sendId: 's1' },
      { teamId: 't2', team: 'B', recipient: '15550000001', body: 'two', segments: 1, patternIds: [], sendId: 's2' },
    ]);
    expect(text).toBe('15550000001~~~one@@@NEXT@@@15550000001~~~two');
  });

  it('says EMPTY rather than nothing at all', () => {
    // Tasker splits whatever it receives. A blank body becomes one empty
    // record and it texts a blank message.
    expect(toTaskerText([])).toBe(NOTHING);
  });
});

describe('the door', () => {
  const env = { RELAY_TOKEN: 'sekret' } as Env;

  it('is closed when no token is configured', () => {
    // An unset secret must never mean "let everybody in", which is how an
    // unfinished deploy becomes a public endpoint.
    expect(relayAuthorised('anything', {} as Env)).toBe(false);
    expect(relayAuthorised(null, {} as Env)).toBe(false);
  });

  it('refuses a wrong or missing token', () => {
    expect(relayAuthorised(null, env)).toBe(false);
    expect(relayAuthorised('sekrit', env)).toBe(false);
    expect(relayAuthorised('sekret', env)).toBe(true);
  });

  it('answers 401 before doing any work', async () => {
    const s = stub();
    const url = new URL('https://api.truhq.co/relay/queue?token=wrong&format=text');
    const res = await handleRelayRoutes(new Request(url), env, s.db, url, NOW);
    expect(res?.status).toBe(401);
    expect(s.db.select).not.toHaveBeenCalled();
  });

  it('leaves other paths alone', async () => {
    const url = new URL('https://api.truhq.co/admin/coach-health');
    const s = stub();
    expect(await handleRelayRoutes(new Request(url), env, s.db, url, NOW)).toBeNull();
  });

  it('never puts a full number in the JSON view', async () => {
    const s = stub();
    const url = new URL('https://api.truhq.co/relay/queue?token=sekret&peek=1');
    const res = await handleRelayRoutes(new Request(url), env, s.db, url, NOW);
    const body = await res!.text();
    expect(body).not.toContain('15551234567');
    expect(body).toContain('...4567');
  });
});

describe('phone numbers', () => {
  it('accepts ten digits and the eleven-digit form', () => {
    expect(normalisePhone('(555) 123-4567')).toBe('15551234567');
    expect(normalisePhone('+1 555 123 4567')).toBe('15551234567');
  });

  it('refuses anything else rather than guessing', () => {
    expect(normalisePhone('555-1234')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('447700900000')).toBeNull();
  });

  it('shows only the last four', () => {
    expect(maskPhone('15551234567')).toBe('...4567');
  });
});

describe('which day it is', () => {
  it('uses the recipient s date, not UTC', () => {
    // 00:30 UTC is still the previous evening in New York. Keying the claim on
    // UTC would open a second claim window in the middle of the night.
    expect(localDate(new Date('2026-08-26T00:30:00.000Z'))).toBe('2026-08-25');
    expect(localDate(new Date('2026-08-25T13:45:00.000Z'))).toBe('2026-08-25');
  });
});


describe('ids that reach a database filter', () => {
  // `id=in.(${ids})` is built by concatenation and is followed by a write, so
  // an unchecked id is not a failed query -- it is a changed row.
  it('rejects anything that is not a row id', () => {
    expect(isId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isId('send-1')).toBe(false);
    expect(isId('')).toBe(false);
    expect(isId(null)).toBe(false);
    expect(isId(42)).toBe(false);
  });

  it('rejects an id carrying its own filter', () => {
    // The actual attack: close the bracket, append a wider condition.
    expect(isId('11111111-1111-4111-8111-111111111111)&status=eq.sent&x=in.(1')).toBe(false);
  });

  it('answers 400 and touches nothing', async () => {
    const s = stub();
    const url = new URL('https://api.truhq.co/relay/ack?token=sekret');
    const res = await handleRelayRoutes(
      new Request(url, { method: 'POST', body: JSON.stringify({ sendIds: [')&status=eq.sent'] }) }),
      { RELAY_TOKEN: 'sekret' } as Env, s.db, url, NOW);
    expect(res?.status).toBe(400);
    expect(s.db.update).not.toHaveBeenCalled();
  });

  it('refuses the whole request rather than acting on the good half', async () => {
    // Filtering the bad id out quietly would turn an attack into a partial
    // success, and hide that somebody tried.
    const s = stub();
    const { queued } = await buildAndClaim(s.db, NOW);
    const url = new URL('https://api.truhq.co/relay/ack?token=sekret');
    const res = await handleRelayRoutes(
      new Request(url, { method: 'POST',
        body: JSON.stringify({ sendIds: [queued[0].sendId, 'not-an-id'] }) }),
      { RELAY_TOKEN: 'sekret' } as Env, s.db, url, NOW);
    expect(res?.status).toBe(400);
    expect(s.db.update).not.toHaveBeenCalled();
  });
});

describe('where the token is allowed to travel', () => {
  // A query string is written to request logs, kept in history, and readable
  // over a shoulder in a Tasker profile. A header is none of those.
  const url = new URL('https://api.truhq.co/relay/queue?token=from-query');

  it('prefers an Authorization header', () => {
    const req = new Request(url, { headers: { authorization: 'Bearer from-header' } });
    expect(relayTokenFrom(req, url)).toBe('from-header');
  });

  it('accepts a plain relay header too', () => {
    const req = new Request(url, { headers: { 'x-relay-token': 'from-header' } });
    expect(relayTokenFrom(req, url)).toBe('from-header');
  });

  it('still accepts the query form the phone already sends', () => {
    // Dropping it would mean the endpoint only works after somebody
    // successfully edits a header on a phone, which is not a working endpoint.
    expect(relayTokenFrom(new Request(url), url)).toBe('from-query');
  });

  it('does not mistake another scheme for a bearer token', () => {
    const req = new Request(url, { headers: { authorization: 'Basic abc123' } });
    expect(relayTokenFrom(req, url)).toBe('from-query');
  });
});
