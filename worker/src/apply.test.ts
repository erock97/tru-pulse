import { describe, it, expect } from 'vitest';
import { validateApplication } from './apply.js';

const good = {
  fullName: 'Dana Reyes', email: 'dana@example.com', role: 'Team leader',
  teamSize: '6–20', bottleneck: 'Leads sit unworked for days.',
  marketingOptIn: false, consentText: 'By submitting, you agree…',
  consentAt: '2026-08-09T18:00:00.000Z', sourcePath: '/apply', website: '',
};

describe('validateApplication', () => {
  it('accepts a well-formed submission', () => {
    const r = validateApplication(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('dana@example.com');
  });

  it('rejects a filled honeypot with its own distinct reason', () => {
    // Distinct so the route can answer 200 without storing — a bot that gets a
    // 422 learns which field gave it away.
    const r = validateApplication({ ...good, website: 'http://spam.example' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('honeypot');
  });

  it('requires every visible field', () => {
    for (const k of ['fullName', 'email', 'role', 'teamSize', 'bottleneck'] as const) {
      expect(validateApplication({ ...good, [k]: '' }).ok, `${k} empty`).toBe(false);
      expect(validateApplication({ ...good, [k]: '   ' }).ok, `${k} blank`).toBe(false);
    }
  });

  it('rejects a malformed email', () => {
    for (const e of ['nope', 'a@', '@b.com', 'a b@c.com']) {
      expect(validateApplication({ ...good, email: e }).ok, e).toBe(false);
    }
  });

  it('lowercases and trims the email', () => {
    const r = validateApplication({ ...good, email: '  Dana@Example.COM ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('dana@example.com');
  });

  it('caps every field so a giant body cannot be posted', () => {
    expect(validateApplication({ ...good, bottleneck: 'x'.repeat(5001) }).ok).toBe(false);
    expect(validateApplication({ ...good, fullName: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateApplication({ ...good, consentText: 'x'.repeat(2001) }).ok).toBe(false);
  });

  it('trims whitespace and defaults the opt-in to false when absent', () => {
    const r = validateApplication({ ...good, fullName: '  Dana  ', marketingOptIn: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.fullName).toBe('Dana');
      expect(r.value.marketingOptIn).toBe(false);
    }
  });

  it('coerces the opt-in to a real boolean', () => {
    const yes = validateApplication({ ...good, marketingOptIn: 'yes' });
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(yes.value.marketingOptIn).toBe(true);

    const no = validateApplication({ ...good, marketingOptIn: 0 });
    expect(no.ok).toBe(true);
    if (no.ok) expect(no.value.marketingOptIn).toBe(false);
  });

  it('requires consent metadata', () => {
    // Without these two, an opt-in cannot be proven later, which is the whole
    // reason for recording it.
    expect(validateApplication({ ...good, consentText: '' }).ok).toBe(false);
    expect(validateApplication({ ...good, consentAt: '' }).ok).toBe(false);
    expect(validateApplication({ ...good, consentAt: 'not-a-date' }).ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    for (const b of [null, undefined, 'x', 42, []]) {
      expect(validateApplication(b).ok).toBe(false);
    }
  });

  it('never returns a phone field, even if one is posted', () => {
    const r = validateApplication({ ...good, phone: '555-0100' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value)).not.toContain('phone');
  });
});
