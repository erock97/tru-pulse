import { describe, it, expect } from 'vitest';
import {
  toE164US, formatUS, lastFour, classifyInbound, isSmsReachable,
  SMS_CONSENT_TEXT, SMS_CONSENT_VERSION,
} from './smsConsent.js';

describe('toE164US', () => {
  it('accepts the shapes people actually type', () => {
    // 555-0100..0199 is the real reserved fictional range. The familiar
    // "555-123-4567" is NOT a dialable number — its exchange code starts with 1 —
    // and this function is right to reject it.
    for (const s of [
      '5555550123', '555 555 0123', '(555) 555-0123', '555.555.0123',
      '15555550123', '1 (555) 555-0123', '+15555550123', '+1 555 555 0123',
    ]) {
      expect(toE164US(s)).toBe('+15555550123');
    }
  });

  it('rejects lengths that cannot be a US number', () => {
    expect(toE164US('')).toBeNull();
    expect(toE164US('555555012')).toBeNull();   // 9
    expect(toE164US('55555501234')).toBeNull(); // 11 not starting with 1
    expect(toE164US('abc')).toBeNull();
  });

  it('rejects non-NANP country codes rather than mangling them', () => {
    expect(toE164US('+44 20 7946 0958')).toBeNull();
  });

  it('rejects fat-finger numbers that are the right length but not dialable', () => {
    // Area code may not start with 0 or 1 — this is the one that would otherwise
    // sit in the consent ledger looking like a real record.
    expect(toE164US('1234567890')).toBeNull();
    expect(toE164US('0234567890')).toBeNull();
    // Exchange code may not either — 555-023-0123 and the familiar but bogus
    // 555-123-4567 both fail here, which is the point.
    expect(toE164US('5550230123')).toBeNull();
    expect(toE164US('5551234567')).toBeNull();
  });
});

describe('formatUS / lastFour', () => {
  it('renders a stored number back for a human', () => {
    expect(formatUS('+15555550123')).toBe('(555) 555-0123');
  });
  it('passes anything it does not recognise through untouched', () => {
    expect(formatUS('+442079460958')).toBe('+442079460958');
  });
  it('gives the last four for confirmation', () => {
    expect(lastFour('+15555550123')).toBe('0123');
  });
});

describe('classifyInbound', () => {
  it('honours every CTIA stop keyword, however it is typed', () => {
    for (const s of ['STOP', 'stop', ' Stop ', 'Stop.', 'UNSUBSCRIBE', 'quit', 'CANCEL', 'end']) {
      expect(classifyInbound(s)).toBe('stop');
    }
  });
  it('recognises start and help', () => {
    expect(classifyInbound('start')).toBe('start');
    expect(classifyInbound('HELP')).toBe('help');
    expect(classifyInbound('info')).toBe('help');
  });
  it('leaves ordinary replies alone', () => {
    expect(classifyInbound('Done')).toBeNull();
    expect(classifyInbound('stop by the office at 3')).toBeNull();
  });
});

describe('isSmsReachable', () => {
  const base = { sms_phone: '+15555550123', sms_consent_at: '2026-08-01T00:00:00Z', sms_opt_out_at: null };

  it('needs both a number and a consent', () => {
    expect(isSmsReachable(base)).toBe(true);
    expect(isSmsReachable({ ...base, sms_phone: null })).toBe(false);
    expect(isSmsReachable({ ...base, sms_consent_at: null })).toBe(false);
  });

  it('a later opt-out wins', () => {
    expect(isSmsReachable({ ...base, sms_opt_out_at: '2026-08-02T00:00:00Z' })).toBe(false);
  });

  it('an opt-out followed by a fresh opt-in is reachable again', () => {
    expect(isSmsReachable({
      ...base, sms_opt_out_at: '2026-08-02T00:00:00Z', sms_consent_at: '2026-08-03T00:00:00Z',
    })).toBe(true);
  });

  it('an opt-out at the same instant as the consent is NOT reachable', () => {
    // Ties go to silence. If we cannot tell which came first, we do not text.
    expect(isSmsReachable({ ...base, sms_opt_out_at: base.sms_consent_at })).toBe(false);
  });
});

describe('the consent record', () => {
  it('states sender, frequency, cost and how to stop', () => {
    // These clauses are what an A2P reviewer looks for. A copy edit that drops one
    // should fail here rather than at campaign review six weeks later.
    expect(SMS_CONSENT_TEXT).toContain('TRU HQ');
    expect(SMS_CONSENT_TEXT).toContain('frequency varies');
    expect(SMS_CONSENT_TEXT).toContain('rates may apply');
    expect(SMS_CONSENT_TEXT).toContain('STOP');
    expect(SMS_CONSENT_TEXT).toContain('HELP');
  });

  it('is versioned', () => {
    expect(SMS_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
