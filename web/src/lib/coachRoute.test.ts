import { describe, it, expect } from 'vitest';
import { coachProfileRoute, coachRoute, parseCoachAgentId, parseCoachView, isCoachRoute } from './coachRoute';

describe('coachRoute', () => {
  it('builds the roster route when no agent is open', () => {
    expect(coachRoute(null)).toBe('/coach');
  });
  it('builds a per-agent route', () => {
    expect(coachRoute('a1')).toBe('/coach/a1');
  });
  it('escapes an id so it cannot break out of the path', () => {
    expect(coachRoute('a/b?c')).toBe('/coach/a%2Fb%3Fc');
  });
});

describe('parseCoachAgentId', () => {
  it('finds the agent id', () => {
    expect(parseCoachAgentId('/coach/a1')).toBe('a1');
  });
  it('decodes an escaped id', () => {
    expect(parseCoachAgentId('/coach/a%2Fb%3Fc')).toBe('a/b?c');
  });
  it('returns null on the bare roster route', () => {
    expect(parseCoachAgentId('/coach')).toBeNull();
    expect(parseCoachAgentId('/coach/')).toBeNull();
  });
  it('returns null for other routes', () => {
    expect(parseCoachAgentId('/pulse')).toBeNull();
    expect(parseCoachAgentId('/')).toBeNull();
    // Must not match a sibling route that merely starts with the same letters.
    expect(parseCoachAgentId('/coaching')).toBeNull();
  });
  it('ignores a query string', () => {
    expect(parseCoachAgentId('/coach/a1?x=1')).toBe('a1');
  });
});

describe('profile view routes', () => {
  it('builds the profile route', () => {
    expect(coachProfileRoute('a1')).toBe('/coach/a1/profile');
  });
  it('the profile route still names its agent', () => {
    expect(parseCoachAgentId('/coach/a1/profile')).toBe('a1');
    expect(parseCoachAgentId('/coach/a%2Fb%3Fc/profile')).toBe('a/b?c');
  });
  it('tells the sheet from the profile', () => {
    expect(parseCoachView('/coach/a1')).toBe('sheet');
    expect(parseCoachView('/coach/a1/profile')).toBe('profile');
    expect(parseCoachView('/coach/a1/profile?x=1')).toBe('profile');
  });
  it('a bare /coach/profile is an agent named profile, not a view', () => {
    // An agent id is a uuid in real data; this guards the parser's edges.
    expect(parseCoachAgentId('/coach/profile')).toBe('profile');
  });
});

describe('isCoachRoute', () => {
  it('accepts the roster and the drill-in', () => {
    expect(isCoachRoute('/coach')).toBe(true);
    expect(isCoachRoute('/coach/a1')).toBe(true);
  });
  it('rejects everything else, including near-misses', () => {
    expect(isCoachRoute('/coaching')).toBe(false);
    expect(isCoachRoute('/pulse')).toBe(false);
  });
});
