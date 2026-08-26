// Schema 1.1 — the Hermes daily handoff.
//
// Each test here is a numbered rule from that handoff, and the numbers are kept
// so a rule and its test can be read side by side.
import { describe, it, expect } from 'vitest';
import {
  briefStatusFor, isIgnoredAgent, normalizeAgentName, validateCoachBrief,
} from '../../shared/coachBrief.js';

const payload = (over: Record<string, unknown> = {}) => ({
  schemaVersion: '1.1',
  run: {
    runId: 'run-abc', trigger: 'daily', teamId: 'costigan',
    startDate: '2026-08-17', endDate: '2026-08-23',
    generatedAt: '2026-08-24T12:00:00.000Z', status: 'complete',
  },
  agents: [{
    agentName: 'Kara',
    opportunities: [{
      findingIndex: 0,
      findingIds: ['fnd_aaa'],
      patternKey: 'lead_e',
      explanation: 'Ends calls without booking a time.',
      coachingMove: 'Ask for a specific day and hour before hanging up.',
    }],
  }],
  findings: [{
    findingIndex: 0, findingId: 'fnd_aaa', agentName: 'Kara',
    leadName: 'Example Lead', leadUrl: 'https://app.followupboss.com/2/people/view/123',
    occurredAt: '2026-08-20T09:00:00-07:00', channel: 'call',
    quote: 'Exact supporting evidence.',
  }],
  ...over,
});

describe('rule 1 — daily publishes, hand-run reports stay hidden', () => {
  it('publishes a daily run once its team resolves', () => {
    // The change that lets Hermes move from weekly to every morning.
    expect(briefStatusFor('daily', true)).toBe('published');
    expect(briefStatusFor('weekly', true)).toBe('published');
  });

  it('never publishes a personal or manual run', () => {
    // The deployment gate: a synthetic personal payload must round-trip and
    // stay invisible before the unattended schedule is switched on. A client's
    // Coach tab is not somebody's scratch pad.
    for (const trigger of ['personal', 'manual', 'test', '']) {
      expect(briefStatusFor(trigger, true), trigger).toBe('held');
    }
  });

  it('holds anything whose team has not resolved, whatever the trigger', () => {
    for (const trigger of ['daily', 'weekly', 'personal']) {
      expect(briefStatusFor(trigger, false), trigger).toBe('held');
    }
  });
});

describe('schema 1.1 payload', () => {
  it('accepts the handoff shape', () => {
    const v = validateCoachBrief(payload());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.brief.schemaVersion).toBe('1.1');
    expect(v.brief.run.trigger).toBe('daily');
  });

  it('carries the durable finding identity through', () => {
    // findingIndex only means something inside one report; a rolling window
    // re-sends the same call every day with a different index.
    const v = validateCoachBrief(payload());
    if (!v.ok) throw new Error('should validate');
    expect(v.brief.findings[0].findingId).toBe('fnd_aaa');
  });

  it('carries the explanation, pattern key and coaching move', () => {
    // The analysis now supplies what this Worker previously had to infer from
    // the wording of a label.
    const v = validateCoachBrief(payload());
    if (!v.ok) throw new Error('should validate');
    const opp = v.brief.agents[0].opportunityPoints[0];
    expect(opp.explanation).toBe('Ends calls without booking a time.');
    expect(opp.patternKey).toBe('lead_e');
    expect(opp.findingIds).toEqual(['fnd_aaa']);
    expect(opp.coachingMove).toContain('specific day');
  });

  it('carries the 1.2 evidence fields through instead of stripping them', () => {
    // The stored payload IS the raw history. The first 1.2 batch arrived with
    // sourceQuote / isFirstContact / sourceQuality, and a validator that drops
    // unknown fields would have destroyed the evidence at the door.
    const v = validateCoachBrief(payload({
      schemaVersion: '1.2',
      agents: [{
        agentName: 'Kara',
        opportunities: [{
          findingIds: ['fnd_aaa'],
          patternKey: 'lead_e',
          isFirstContact: true,
          explanation: 'Ends calls without booking a time.',
          coachingMove: 'Ask for a specific day and hour before hanging up.',
          sourceQuote: 'I will send you some listings this week.',
          sourceChannel: 'call',
          sourceQuality: 'verbatim',
          durationSeconds: 214,
        }],
      }],
    }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const opp = v.brief.agents[0].opportunityPoints[0];
    expect(opp.isFirstContact).toBe(true);
    expect(opp.sourceQuote).toBe('I will send you some listings this week.');
    expect(opp.sourceChannel).toBe('call');
    expect(opp.sourceQuality).toBe('verbatim');
    expect(opp.durationSeconds).toBe(214);
  });

  it('keeps isFirstContact: unknown as unknown, never a guess', () => {
    const v = validateCoachBrief(payload({
      agents: [{
        agentName: 'Kara',
        opportunities: [{
          findingIds: ['fnd_aaa'], patternKey: 'next_steps',
          explanation: 'Later conversation ended with no time attempt.',
          isFirstContact: 'unknown',
        }],
      }],
    }));
    if (!v.ok) throw new Error('should validate');
    expect(v.brief.agents[0].opportunityPoints[0].isFirstContact).toBe('unknown');
  });

  it('still accepts a 1.0 payload with no opportunity objects', () => {
    const v = validateCoachBrief(payload({
      schemaVersion: '1.0',
      agents: [{ agentName: 'Kara', opportunities: ['A plain string point'] }],
      findings: [],
    }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.brief.agents[0].opportunityPoints).toEqual([]);
    expect(v.brief.agents[0].opportunities[0].text).toBe('A plain string point');
  });

  it('ignores an opportunity with no explanation rather than inventing one', () => {
    const v = validateCoachBrief(payload({
      agents: [{ agentName: 'Kara', opportunities: [{ findingIds: ['x'], patternKey: 'k' }] }],
    }));
    if (!v.ok) throw new Error('should validate');
    expect(v.brief.agents[0].opportunityPoints).toEqual([]);
  });

  it('rejects a payload missing a run id, so the retry loop stops', () => {
    const bad = payload();
    delete (bad.run as any).runId;
    const v = validateCoachBrief(bad);
    expect(v.ok).toBe(false);
  });
});

describe('rule 11 — the universal admin profile is not a person to coach', () => {
  it('ignores it however it is spelled', () => {
    // No agent card, no trend, and critically no unmatched-agent warning: a
    // warning here would be a standing false alarm on every report forever.
    for (const n of ['Eric and Adam', 'eric and adam', 'Eric  and  Adam', 'ERIC AND ADAM']) {
      expect(isIgnoredAgent(n), n).toBe(true);
    }
  });

  it('does not ignore a real person with a similar name', () => {
    for (const n of ['Eric Ingram', 'Adam Walters', 'Eric and Adams Realty']) {
      expect(isIgnoredAgent(n), n).toBe(false);
    }
  });

  it('normalises the way the matcher does', () => {
    expect(normalizeAgentName('Eric and Adam')).toBe('eric and adam');
  });
});
