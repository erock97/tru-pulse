// The leader-facing plan lane. The reference sentence is Eric's own ask,
// verbatim: "Sit down with Joseph this week, coach him on the value of being
// specific when setting meeting times" — the habit, not the incident.
import { describe, expect, it } from 'vitest';
import { buildAgentPlan, coachOn, type AgentPattern } from './coachPlan';

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
  it('names the sit-down, the habit, and the record', () => {
    const [p] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    expect(p.text).toBe(
      'Sit down with Joseph this week — coach them on being specific when setting meeting times. 3 times since Aug 18.',
    );
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

  it('never guesses a pronoun from a name', () => {
    // A wrong guess in a coaching directive lands in front of the person.
    const [p] = buildAgentPlan([pat()], 'agent-1', 'Joseph Darlington');
    expect(p.text).toContain('coach them on');
    expect(p.text).not.toMatch(/\bcoach (him|her)\b/);
  });
});

describe('what qualifies and in what order', () => {
  it('is worst first: recurring, then count', () => {
    const plan = buildAgentPlan([
      pat({ patternKey: 'objection', occurrences: 1, recurring: false }),
      pat({ patternKey: 'call_first', occurrences: 2, recurring: true }),
      pat({ patternKey: 'lead_e', occurrences: 5, recurring: true }),
    ], 'agent-1', 'Joseph Darlington');
    expect(plan.map((p) => p.text.includes('meeting times'))[0]).toBe(true);
    expect(plan[2].text).toContain('working an objection');
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
    expect(coachOn('lead_e')).toBe('being specific when setting meeting times');
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
