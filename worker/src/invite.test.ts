import { afterEach, describe, expect, it, vi } from 'vitest';
import { inviteEmailHtml, inviteEmailSubject, mintAuthLink } from './invite.js';
import type { Env } from './env.js';

afterEach(() => vi.unstubAllGlobals());

describe('cookie-auth invitation handoff', () => {
  const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' } as Env;
  it.each(['invite', 'recovery'] as const)('%s opens the app before consuming the one-time token', async (kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      properties: { hashed_token: 'one-time-hash', verification_type: kind,
        action_link: `https://test.supabase.co/auth/v1/verify?token=one-time-hash&type=${kind}` },
      user: { id: 'mock-user' },
    })));
    const result = await mintAuthLink(env, 'mock@example.com', kind);
    const link = new URL(result.link);
    expect(link.origin).toBe('https://app.truhq.co');
    const hash = new URLSearchParams(link.hash.slice(1));
    expect(hash.get('token_hash')).toBe('one-time-hash');
    expect(hash.get('type')).toBe(kind);
    expect(result.userId).toBe('mock-user');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses the old action-link fallback when the hash is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ action_link: 'https://test.supabase.co/auth/v1/verify' })));
    await expect(mintAuthLink(env, 'mock@example.com', 'invite')).rejects.toThrow('could not mint');
  });
  it('supports a configured test origin and the flat Auth API response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hashed_token: 'a+b/c=', id: 'mock-user' })));
    const result = await mintAuthLink({ ...env, APP_ORIGIN: 'http://localhost:4178' }, 'mock@example.com', 'recovery');
    const url = new URL(result.link);
    expect(url.origin).toBe('http://localhost:4178');
    expect(url.search).toBe('');
    expect(new URLSearchParams(url.hash.slice(1)).get('token_hash')).toBe('a+b/c=');
  });
});

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
    email: 'jordan@sample.com',
  });

  it('asks them to set a login and password for their HQ', () => {
    expect(inviteEmailSubject('Sample Realty', 'agent')).toMatch(/password/i);
    expect(inviteEmailSubject('Sample Realty', 'agent')).toMatch(/HQ/i);
    expect(html).toContain('Set your password');
    expect(html).toContain('https://app.truhq.co/#invite');
    expect(html.toLowerCase()).toMatch(/training/);
    expect(html).toMatch(/Coach/);
  });

  it('names the invite email so they cannot register a different address', () => {
    expect(html).toContain('jordan@sample.com');
    expect(html.toLowerCase()).toMatch(/different one will not connect/);
  });

  it('does not say Pulse or that they are joining a leader dashboard', () => {
    expect(html).not.toMatch(/Pulse/);
    expect(html.toLowerCase()).not.toMatch(/leader dashboard/);
    expect(html.toLowerCase()).not.toMatch(/whole team in one place/);
  });
});
