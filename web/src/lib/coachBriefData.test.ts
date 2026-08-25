// Reading a STORED coaching report.
//
// The distinction this file exists to hold on to: what reaches `toView` is a
// payload written by whatever validator was live the day it was ingested, not
// one built by today's. TypeScript describes today's shape and cannot see that,
// so every field added since is simply absent from every row written before it.
//
// That is not hypothetical. On 2026-08-25 the reader started using
// `opportunityPoints`, a field schema 1.1 introduced that morning. The previous
// week's 111 stored agent entries did not have it, so picking an earlier week
// in the Coach tab threw on undefined and the entire brief section rendered
// nothing at all — not a bad week, no week.
import { describe, expect, it } from 'vitest';
import { toView } from './coachBriefData';
import type { BriefReportRow } from './coachBriefData';

/** A report exactly as it sat in the database BEFORE schema 1.1 existed. */
function storedBeforeV11(): BriefReportRow {
  return {
    id: 'rep-old',
    team_id: 'team-1',
    week_start: '2026-08-17',
    week_end: '2026-08-23',
    generated_at: '2026-08-24T12:00:00.000Z',
    agent_links: { 'Cara Benak': 'agent-1' },
    payload: {
      schemaVersion: '1.0',
      run: { runId: 'r1', trigger: 'weekly', teamId: 'costigan',
             startDate: '2026-08-17', endDate: '2026-08-23' },
      agents: [{
        agentName: 'Cara Benak',
        metrics: { reviewedContacts: 9, substantiveContacts: 9 },
        doingRight: [],
        opportunities: [{ text: 'Ends texts without offering a time.', findingIndexes: [0] }],
        objections: [],
        coachingActions: [],
        // NOTE: no opportunityPoints. That is the whole point of this fixture.
      }],
      findings: [{
        findingIndex: 0, agentName: 'Cara Benak', leadName: 'Nick',
        occurredAt: '2026-08-19T14:00:00Z', channel: 'text', quote: 'Want me to send some over?',
      }],
    },
  } as unknown as BriefReportRow;
}

describe('a week stored before schema 1.1', () => {
  it('still renders instead of taking the whole section down', () => {
    const view = toView(storedBeforeV11());
    expect(view).not.toBeNull();
    expect(view!.agents).toHaveLength(1);
  });

  it('shows the coaching point it always showed', () => {
    const view = toView(storedBeforeV11());
    expect(view!.agents[0].opportunities[0].text).toBe('Ends texts without offering a time.');
  });

  it('keeps its evidence', () => {
    const view = toView(storedBeforeV11());
    expect(view!.agents[0].opportunities[0].evidence[0].quote).toBe('Want me to send some over?');
  });
});

describe('a report missing lists a later version added', () => {
  it('survives an agent with no lists at all', () => {
    // Not a shape we send. It is a shape the database could already hold, and
    // one throw here costs the leader every week rather than one field.
    const row = storedBeforeV11();
    (row.payload as any).agents = [{ agentName: 'Cara Benak' }];
    const view = toView(row);
    expect(view!.agents[0]).toMatchObject({
      doingRight: [], opportunities: [], objections: [], coachingActions: [],
    });
  });

  it('survives a report with no findings', () => {
    const row = storedBeforeV11();
    delete (row.payload as any).findings;
    expect(toView(row)!.agents[0].opportunities[0].evidence).toEqual([]);
  });

  it('survives a report with no agents', () => {
    const row = storedBeforeV11();
    delete (row.payload as any).agents;
    expect(toView(row)!.agents).toEqual([]);
  });

  it('returns null only when there is no payload', () => {
    const row = storedBeforeV11();
    (row as any).payload = null;
    expect(toView(row)).toBeNull();
  });
});

describe('a week stored after schema 1.1', () => {
  it('reads the coaching point out of the new shape', () => {
    const row = storedBeforeV11();
    (row.payload as any).schemaVersion = '1.1';
    (row.payload as any).agents[0].opportunities = [];
    (row.payload as any).agents[0].opportunityPoints = [{
      findingIds: ['fnd_a'],
      patternKey: 'lead_e',
      explanation: 'Ends texts without offering a time.',
      coachingMove: 'Offer two times and ask her to pick one.',
    }];
    (row.payload as any).findings[0].findingId = 'fnd_a';

    const point = toView(row)!.agents[0].opportunities[0];
    expect(point.text).toBe('Ends texts without offering a time.');
    expect(point.coach).toBe('Offer two times and ask her to pick one.');
    expect(point.evidence[0].quote).toBe('Want me to send some over?');
  });
});
