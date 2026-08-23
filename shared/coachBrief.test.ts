import { describe, expect, it } from 'vitest';
import {
  briefStatusFor,
  findingsByIndex,
  matchAgents,
  normalizeAgentName,
  pointEvidence,
  validateCoachBrief,
} from './coachBrief';

const goodPayload = () => ({
  schemaVersion: '1.0',
  run: {
    runId: 'costigan-2026-08-16-to-2026-08-22',
    trigger: 'weekly',
    teamId: 'costigan',
    teamName: 'Jack Costigan',
    startDate: '2026-08-16',
    endDate: '2026-08-22',
    generatedAt: '2026-08-23T12:00:00Z',
    status: 'complete',
  },
  agents: [
    {
      agentName: 'Adam Walters',
      metrics: { reviewedContacts: 29, substantiveContacts: 4, callFirst: 10, textFirst: 12, noOutreach: 2, unclassified: 5 },
      doingRight: [{ text: 'Calls first on new leads', coach: 'Keep it up', findingIndexes: [0] }],
      opportunities: ['Set the appointment on call one'],
      objections: [],
      coachingActions: [{ text: 'Roleplay the either/or close', findingIndexes: [1] }],
    },
  ],
  findings: [
    {
      findingIndex: 0,
      agentName: 'Adam Walters',
      leadName: 'Example Lead',
      leadUrl: 'https://app.followupboss.com/2/people/view/123',
      occurredAt: '2026-08-18T09:00:00-07:00',
      channel: 'call',
      quote: 'Exact evidence supporting the coaching point',
    },
    { findingIndex: 1, agentName: 'Adam Walters', quote: 'Second piece of evidence' },
  ],
});

describe('validateCoachBrief', () => {
  it('accepts the handoff-shaped payload and keeps its structure', () => {
    const v = validateCoachBrief(goodPayload());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.brief.run.runId).toBe('costigan-2026-08-16-to-2026-08-22');
    expect(v.brief.run.teamId).toBe('costigan');
    expect(v.brief.agents).toHaveLength(1);
    expect(v.brief.agents[0].doingRight[0].coach).toBe('Keep it up');
    expect(v.brief.findings).toHaveLength(2);
  });

  it('coerces plain-string coaching points into points with no evidence', () => {
    const v = validateCoachBrief(goodPayload());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.brief.agents[0].opportunities).toEqual([
      { text: 'Set the appointment on call one', findingIndexes: [] },
    ]);
  });

  it('rejects a payload missing its run id, with a clear error', () => {
    const p = goodPayload() as any;
    delete p.run.runId;
    const v = validateCoachBrief(p);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(' ')).toContain('runId');
  });

  it('rejects malformed dates', () => {
    const p = goodPayload() as any;
    p.run.startDate = '08/16/2026';
    const v = validateCoachBrief(p);
    expect(v.ok).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(validateCoachBrief(null).ok).toBe(false);
    expect(validateCoachBrief([]).ok).toBe(false);
    expect(validateCoachBrief('{}').ok).toBe(false);
  });

  it('defaults an absent trigger to weekly and tolerates missing findings[]', () => {
    const p = goodPayload() as any;
    delete p.run.trigger;
    delete p.findings;
    const v = validateCoachBrief(p);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.brief.run.trigger).toBe('weekly');
    expect(v.brief.findings).toEqual([]);
  });

  it('accepts an empty agents[] — a thin week is data, not an error', () => {
    const p = goodPayload() as any;
    p.agents = [];
    const v = validateCoachBrief(p);
    expect(v.ok).toBe(true);
  });
});

describe('briefStatusFor', () => {
  it('publishes only scheduled weekly runs whose team resolved', () => {
    expect(briefStatusFor('weekly', true)).toBe('published');
    expect(briefStatusFor('weekly', false)).toBe('held');
    expect(briefStatusFor('personal', true)).toBe('held');
    expect(briefStatusFor('on-demand', true)).toBe('held');
  });
});

describe('agent matching', () => {
  const roster = [
    { id: 'id-adam', name: 'Adam Walters' },
    { id: 'id-maria', name: 'María López' },
    { id: 'id-jw-1', name: 'John Wood' },
    { id: 'id-jw-2', name: 'John  Wood ' },
  ];

  it('normalizes case, spacing, punctuation and accents', () => {
    expect(normalizeAgentName('  MARÍA  lópez ')).toBe(normalizeAgentName('Maria Lopez'));
    expect(normalizeAgentName("O'Brien, Pat")).toBe('o brien pat');
  });

  it('links exact and accent-insensitive matches', () => {
    const r = matchAgents(['adam walters', 'Maria Lopez'], roster);
    expect(r.links).toEqual({ 'adam walters': 'id-adam', 'Maria Lopez': 'id-maria' });
    expect(r.unmatched).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });

  it('never guesses: ambiguous names stay unlinked and are reported', () => {
    const r = matchAgents(['John Wood'], roster);
    expect(r.links).toEqual({});
    expect(r.ambiguous).toEqual(['John Wood']);
  });

  it('reports names with no roster match', () => {
    const r = matchAgents(['Somebody New'], roster);
    expect(r.links).toEqual({});
    expect(r.unmatched).toEqual(['Somebody New']);
  });
});

describe('evidence resolution', () => {
  it('resolves a point back to its findings and skips dangling indexes', () => {
    const v = validateCoachBrief(goodPayload());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const byIndex = findingsByIndex(v.brief);
    const evidence = pointEvidence(
      { text: 'x', findingIndexes: [1, 99] },
      byIndex,
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].quote).toBe('Second piece of evidence');
  });
});
