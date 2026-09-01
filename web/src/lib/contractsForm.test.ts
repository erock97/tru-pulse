import { describe, it, expect } from 'vitest';
import {
  applyDerivedBlanks, assembleRecipients, CLIENT_BOOK_KEY, defaultValue, humanizeKey,
  missingRequiredPlaceholders, parseFieldLines, parseRecipientLines, readClientBook,
  recallClient, rememberClient, retainerForPlan, roleIsFixed,
  type BookStorage, type RoleShape,
} from './contractsForm';

const role = (overrides: Partial<RoleShape>): RoleShape => ({
  roleKey: 'client',
  optional: false,
  label: 'Client signer',
  role: 'signer',
  routingOrder: 1,
  fixedName: null,
  fixedEmail: null,
  ...overrides,
});

describe('retainerForPlan', () => {
  it('carries the plan sheet: the plan decides the retainer', () => {
    expect(retainerForPlan('Essentials')).toBe('$3,750');
    expect(retainerForPlan('Performance')).toBe('$5,250');
    expect(retainerForPlan('Performance+')).toBe('$6,750');
  });

  it('Embedded is custom-priced — an empty retainer, not a missing plan', () => {
    expect(retainerForPlan('Embedded')).toBe('');
  });

  it('an unknown plan is null, so a typed-over retainer is never clobbered', () => {
    expect(retainerForPlan('Bespoke')).toBeNull();
  });
});

describe('applyDerivedBlanks', () => {
  it('fills the blanks the form already knows from other boxes', () => {
    const values = applyDerivedBlanks(
      { effective_date: 'August 31, 2026' },
      { client: 'Costigan Group', people: { client: { name: 'Jack Costigan' } } },
    );
    expect(values.client_name).toBe('Costigan Group');
    expect(values.team_name).toBe('Costigan Group');
    expect(values.client_signer_name).toBe('Jack Costigan');
    // What was already there survives.
    expect(values.effective_date).toBe('August 31, 2026');
  });

  it('an empty derivation never clobbers a typed value', () => {
    const values = applyDerivedBlanks(
      { client_signer_name: 'Typed By Hand' },
      { client: 'Costigan Group', people: {} },
    );
    expect(values.client_signer_name).toBe('Typed By Hand');
  });

  it('derives the second signer name only when a second signer exists', () => {
    const withSecond = applyDerivedBlanks({}, {
      client: 'X', people: { client_2: { name: 'Second Signer' } },
    });
    expect(withSecond.client_signer_2_name).toBe('Second Signer');
    const without = applyDerivedBlanks({}, { client: 'X', people: {} });
    expect(without.client_signer_2_name).toBeUndefined();
  });

  it('returns a new object rather than mutating the form values', () => {
    const original = {};
    const out = applyDerivedBlanks(original, { client: 'X', people: {} });
    expect(out).not.toBe(original);
    expect(original).toEqual({});
  });
});

describe('missingRequiredPlaceholders', () => {
  const placeholders = [
    { key: 'effective_date', required: true },
    { key: 'monthly_retainer', required: true },
    { key: 'current_emphasis', required: false },
    { key: 'client_signer_2_name', required: true },
    { key: 'client_signer_2_title', required: true },
  ];

  it('names the required blanks that are still empty', () => {
    const missing = missingRequiredPlaceholders(placeholders, { effective_date: 'July 1' }, true);
    expect(missing.map((p) => p.key)).toEqual([
      'monthly_retainer', 'client_signer_2_name', 'client_signer_2_title',
    ]);
  });

  it('whitespace does not count as filled', () => {
    const missing = missingRequiredPlaceholders(placeholders, { monthly_retainer: '   ' }, true);
    expect(missing.map((p) => p.key)).toContain('monthly_retainer');
  });

  it('skips the whole client_signer_2 family when no second signer was added', () => {
    // That signature block stays blank on purpose; requiring its blanks would
    // block every one-signer contract.
    const missing = missingRequiredPlaceholders(placeholders, { effective_date: 'x', monthly_retainer: 'y' }, false);
    expect(missing).toEqual([]);
  });

  it('optional blanks never block, filled or not', () => {
    const missing = missingRequiredPlaceholders(
      [{ key: 'current_emphasis', required: false }], {}, false,
    );
    expect(missing).toEqual([]);
  });
});

describe('assembleRecipients', () => {
  const roles: RoleShape[] = [
    role({ roleKey: 'client', label: 'Client signer', routingOrder: 1 }),
    role({ roleKey: 'client_2', label: 'Second client signer', optional: true, routingOrder: 1 }),
    role({ roleKey: 'eric', label: 'Terrason', routingOrder: 2, fixedName: 'Eric G', fixedEmail: 'eric@terrasonconsulting.com' }),
  ];

  it('builds recipients from the open roles, trimmed, never the fixed ones', () => {
    const out = assembleRecipients(roles, { client: { name: ' Jack ', email: ' jack@x.com ' } }, []);
    expect(out).toEqual({ ok: true, recipients: [{ name: 'Jack', email: 'jack@x.com', role: 'signer' }] });
  });

  it('an optional role only participates once it was added', () => {
    const people = {
      client: { name: 'Jack', email: 'jack@x.com' },
      client_2: { name: 'Jill', email: 'jill@x.com' },
    };
    const without = assembleRecipients(roles, people, []);
    expect(without.ok && without.recipients).toHaveLength(1);
    const withSecond = assembleRecipients(roles, people, ['client_2']);
    expect(withSecond.ok && withSecond.recipients).toEqual([
      { name: 'Jack', email: 'jack@x.com', role: 'signer' },
      { name: 'Jill', email: 'jill@x.com', role: 'signer' },
    ]);
  });

  it('names the role that is missing a person, in its own label', () => {
    const out = assembleRecipients(roles, { client: { name: 'Jack' } }, []);
    expect(out).toEqual({ ok: false, error: 'Client signer needs a name and an email.' });
  });

  it('an added-but-empty second signer blocks with its label too', () => {
    const out = assembleRecipients(roles, { client: { name: 'Jack', email: 'jack@x.com' } }, ['client_2']);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('Second client signer');
  });

  it('roleIsFixed marks our own side, which the form never asks for', () => {
    expect(roleIsFixed(roles[2])).toBe(true);
    expect(roleIsFixed(roles[0])).toBe(false);
  });
});

describe('the client book', () => {
  function memoryStorage(): BookStorage & { data: Record<string, string> } {
    const data: Record<string, string> = {};
    return {
      data,
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => { data[key] = value; },
    };
  }

  it('round-trips an entry, keyed case-insensitively by client name', () => {
    const storage = memoryStorage();
    rememberClient({
      client: 'Costigan Group',
      team: 'Costigan',
      values: { monthly_retainer: '$5,250' },
      people: { client: { name: 'Jack', email: 'jack@x.com' } },
    }, storage);
    const book = readClientBook(storage);
    const entry = recallClient(book, '  costigan group ');
    expect(entry?.team).toBe('Costigan');
    expect(entry?.values?.monthly_retainer).toBe('$5,250');
    expect(entry?.people?.client).toEqual({ name: 'Jack', email: 'jack@x.com' });
    expect(entry?.savedAt).toBeTruthy();
  });

  it('uses the exact key TRU OS used, so nothing remembered there is lost', () => {
    expect(CLIENT_BOOK_KEY).toBe('tru.contracts.clientbook.v1');
    const storage = memoryStorage();
    rememberClient({ client: 'X' }, storage);
    expect(Object.keys(storage.data)).toEqual(['tru.contracts.clientbook.v1']);
  });

  it('a nameless entry is not saved, and corrupt storage reads as empty', () => {
    const storage = memoryStorage();
    rememberClient({ client: '   ' }, storage);
    expect(storage.data).toEqual({});
    storage.data[CLIENT_BOOK_KEY] = 'not json {';
    expect(readClientBook(storage)).toEqual({});
  });

  it('recalling a client nobody typed before is null, not an entry', () => {
    expect(recallClient({}, 'Nobody')).toBeNull();
  });

  it('survives storage that throws (private mode, blocked, node)', () => {
    const throwing: BookStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readClientBook(throwing)).toEqual({});
    expect(() => rememberClient({ client: 'X' }, throwing)).not.toThrow();
    // No storage at all (the node default) is the same non-event.
    expect(readClientBook(null)).toEqual({});
    expect(() => rememberClient({ client: 'X' }, null)).not.toThrow();
  });
});

describe('the manual tab line formats', () => {
  it('reads "Key: Value" lines, keeping colons inside the value', () => {
    expect(parseFieldLines('Fee: $5,000\nSchedule: net 30: no exceptions\n\nno colon line')).toEqual({
      Fee: '$5,000',
      Schedule: 'net 30: no exceptions',
    });
  });

  it('reads "Name | email | role" recipient lines, defaulting to signer', () => {
    expect(parseRecipientLines('Jack | jack@x.com | CC\nJill|jill@x.com\n \n')).toEqual([
      { name: 'Jack', email: 'jack@x.com', role: 'cc' },
      { name: 'Jill', email: 'jill@x.com', role: 'signer' },
    ]);
  });
});

describe('humanizing the blanks', () => {
  it('turns a stored key into words a person reads', () => {
    expect(humanizeKey('monthly_retainer')).toBe('Monthly retainer');
    expect(humanizeKey('client_signer_2_name')).toBe('Client signer 2 name');
  });

  it('defaults the blanks that are the same on almost every contract', () => {
    expect(defaultValue('effective_date', new Date(2026, 7, 31))).toBe('August 31, 2026');
    expect(defaultValue('client_state')).toBe('New Jersey');
    expect(defaultValue('client_type')).toBe('limited liability company');
    expect(defaultValue('anything_else')).toBe('');
  });
});
