// The leader-facing plan lane. Every category label here is TRU doctrine, not
// wording — lead_* are the four LEAD steps. See docs/SALES_DOCTRINE.md before
// changing a string, and never guess what a pattern key means.
import { describe, expect, it } from 'vitest';
import { buildAgentPlan, coachOn, record, rateLine, type AgentPattern } from './coachPlan';

const pat = (over: Partial<AgentPattern> = {}): AgentPattern => ({
  agentId: 'agent-1',
  agentName: 'Joseph Darlington',
  patternKey: 'lead_e',
  explanation: 'Asked Ashley to catch up without offering a time.',
  coachingMove: 'Ask Ashley to choose between two specific times instead of a general catch-up.',
  firstSeen: '2026-08-18T12:00:00Z',
  latestEvidence: '2026-08-24T12:00:00Z',
  occurrences: 3,
  thisWindow: 3,
  current: true,
  recurring: true,
  findings: [{
    lead_name: 'Ashley Calcano', channel: 'text',
    occurred_at: '2026-08-18T15:00:00Z',
    quote: 'Would you like to catch up soon and discuss your plans?',
  }],
  ...over,
});

describe('the sentence a leader acts on', () => {
  it('reads like Eric wrote it: what happened, how often, then the sit-down', () => {
    // The shape of his model directive -- observation, rate or count, the
    // conversation to have, and what it is ABOUT. Not "tell agent to call
    // first before texting", which is the failure this was written against.
    const [p] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    expect(p.text).toBe(
      'Asked Ashley to catch up without offering a time. 3 times since Aug 18. '
      + 'Worth sitting down with Joseph this week to talk through extending the '
      + 'invitation early, with a this-or-that choice — and why it matters, not '
      + 'just that we ask for it.',
    );
    expect(p.kicker).toBe('extending the invitation early, with a this-or-that choice');
  });

  it('always says what the conversation is about, even with no story', () => {
    const [p] = buildAgentPlan([pat({ explanation: null })], 'agent-1', 'Joseph Darlington');
    expect(p.text).toContain('talk through extending the invitation early');
    expect(p.text).toContain('why it matters');
  });

  it('never reduces to a shorthand instruction', () => {
    // The register test. Meeting-notes shorthand is what AI defaults to and
    // what a team leader abandons the report over.
    const [p] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    expect(p.text.length).toBeGreaterThan(80);
    expect(p.text).not.toMatch(/^(Tell|Have|Ask) (the )?agent/i);
  });

  it('keeps the concrete drill as the sub-line', () => {
    const [p] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    expect(p.coach).toContain('two specific times');
  });

  it('says once means once', () => {
    const [p] = buildAgentPlan(
      [pat({ occurrences: 1, recurring: false })], 'agent-1', 'Joseph Darlington');
    expect(p.text).toContain('Came up once this week.');
    expect(p.text).not.toMatch(/\d times/);
  });

  it('never says "since" a date only days old', () => {
    // Day one of the store, every first-seen was today, and "3 times since
    // Aug 25" ON Aug 25 says nothing. The date earns its place at a week out.
    const now = new Date('2026-08-25T20:00:00Z');
    expect(record(pat({ firstSeen: '2026-08-25T12:00:00Z' }), now)).toBe('3 times this week.');
    expect(record(pat({ firstSeen: '2026-08-10T12:00:00Z' }), now)).toBe('3 times since Aug 10.');
  });

  it('never guesses a pronoun from a name', () => {
    // A wrong guess in a coaching directive lands in front of the person.
    const [withStory] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    const [fallback] = buildAgentPlan([pat({ explanation: null })], 'agent-1', 'Joseph Darlington');
    for (const t of [withStory.text, fallback.text]) {
      expect(t).not.toMatch(/\b(him|her|his|hers)\b/);
    }
  });
});

describe('what qualifies and in what order', () => {
  it('is worst first: recurring, then count', () => {
    const plan = buildAgentPlan([
      pat({ patternKey: 'objection', occurrences: 1, recurring: false }),
      pat({ patternKey: 'call_first', occurrences: 2, recurring: true }),
      pat({ patternKey: 'lead_e', occurrences: 5, recurring: true }),
    ], 'agent-1', 'Joseph Darlington');
    expect(plan[0].kicker).toBe('extending the invitation early, with a this-or-that choice');
    expect(plan[2].kicker).toBe('working through the hard moment instead of retreating from it');
  });

  it('leaves out a habit whose evidence has aged out', () => {
    // That belongs in the trend area, not in this week's sit-down list.
    const plan = buildAgentPlan(
      [pat({ current: false })], 'agent-1', 'Joseph Darlington');
    expect(plan).toEqual([]);
  });

  it('leaves out the other agents', () => {
    const plan = buildAgentPlan([
      pat(),
      pat({ agentId: 'agent-2', agentName: 'Cara Benak', patternKey: 'call_first' }),
    ], 'agent-1', 'Joseph Darlington');
    expect(plan).toHaveLength(1);
  });

  it('matches by name when the id link is missing', () => {
    const plan = buildAgentPlan(
      [pat({ agentId: null })], 'agent-1', 'joseph darlington');
    expect(plan).toHaveLength(1);
  });
});

describe('the taxonomy', () => {
  it('speaks every known category as a coaching subject', () => {
    expect(coachOn('lead_e')).toBe('extending the invitation early, with a this-or-that choice');
    expect(coachOn('premature_representation')).toBe('promising only what they can actually deliver');
  });

  it('lets an unknown category through in its own words', () => {
    // Hermes owns the taxonomy; silently dropping a new category is the
    // failure nobody would notice.
    expect(coachOn('rapport_building')).toBe('rapport building');
  });
});

describe('evidence', () => {
  it('carries the conversations, capped upstream, quoted verbatim', () => {
    const [p] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    expect(p.evidence[0].leadName).toBe('Ashley Calcano');
    expect(p.evidence[0].quote).toContain('catch up soon');
  });

  it('drops a finding with no quote rather than rendering an empty card', () => {
    const [p] = buildAgentPlan([pat({
      findings: [{ lead_name: 'X', channel: 'call', occurred_at: null, quote: null }],
    })], 'agent-1', 'Joseph Darlington');
    expect(p.evidence).toEqual([]);
  });
});


describe('the rate — the part that makes it arguable-with', () => {
  // "He frequently makes about one phone call attempt on average, and the bulk
  // of his communication is done through text." A leader can repeat a
  // proportion to an agent; "texts too much" starts an argument.
  const M = { callFirst: 1, textFirst: 11, noOutreach: 0 };

  it('states the split on a channel habit', () => {
    expect(rateLine('call_first', M))
      .toBe('11 of 12 first touches this week were texts; 1 was a call.');
  });

  it('says none when there were none', () => {
    expect(rateLine('call_first', { callFirst: 0, textFirst: 9 }))
      .toBe('Every one of 9 first touches this week was a text — not a single call.');
  });

  it('stays silent when the agent is in fact calling', () => {
    // Never attach a rate that undercuts its own finding.
    expect(rateLine('call_first', { callFirst: 8, textFirst: 2 })).toBeNull();
  });

  it('will not call two touches a tendency', () => {
    expect(rateLine('call_first', { callFirst: 0, textFirst: 2 })).toBeNull();
  });

  it('does not attach a channel rate to an unrelated habit', () => {
    // A rate on the wrong finding is worse than no rate.
    expect(rateLine('premature_financing', M)).toBeNull();
  });

  it('reports untouched leads where that is the story', () => {
    expect(rateLine('next_steps', { callFirst: 2, textFirst: 4, noOutreach: 3 }))
      .toBe('3 of 9 new leads got no outreach at all this week.');
  });

  it('says nothing at all without metrics', () => {
    expect(rateLine('call_first', undefined)).toBeNull();
  });

  it('lands in the directive when it applies', () => {
    const [p] = buildAgentPlan(
      [pat({ patternKey: 'call_first' })], 'agent-1', 'Joseph Darlington', M);
    expect(p.text).toContain('11 of 12 first touches this week were texts');
  });
});
