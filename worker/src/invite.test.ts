import { describe, expect, it } from 'vitest';
import { inviteEmailHtml, inviteEmailSubject } from './invite.js';

describe('leader invite email (Coach / intake path — unchanged)', () => {
  it('keeps the existing set-password subject and HQ frame', () => {
    expect(inviteEmailSubject('Acme Realty')).toBe('Set your password for Acme Realty on TRU HQ');
    const html = inviteEmailHtml({
      name: 'Dana Lee', orgName: 'Acme Realty', link: 'https://app.truhq.co/#invite',
    });
    expect(html).toContain('Set your password');
    expect(html).toContain('Acme Realty');
    expect(html).toContain('https://app.truhq.co/#invite');
  });
});

describe('agent invite email', () => {
  const html = inviteEmailHtml({
    name: 'Jordan Rivera',
    orgName: 'Sample Realty',
    link: 'https://app.truhq.co/#invite',
    kind: 'agent',
  });

  it('asks them to set a login and password for their HQ', () => {
    expect(inviteEmailSubject('Sample Realty', 'agent')).toMatch(/password/i);
    expect(inviteEmailSubject('Sample Realty', 'agent')).toMatch(/HQ/i);
    expect(html).toContain('Set your password');
    expect(html).toContain('https://app.truhq.co/#invite');
    expect(html.toLowerCase()).toMatch(/training/);
    expect(html).toMatch(/Coach/);
  });

  it('does not say Pulse or that they are joining a leader dashboard', () => {
    expect(html).not.toMatch(/Pulse/);
    expect(html.toLowerCase()).not.toMatch(/leader dashboard/);
    expect(html.toLowerCase()).not.toMatch(/whole team in one place/);
  });
});
