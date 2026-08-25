// The fixtures are real points from the reports Hermes sent on 24 Aug, because
// the behavioural/incidental split only matters against the way the analysis
// actually writes.
import { describe, it, expect } from 'vitest';
import {
  extractIssues, isBehavioural, issueKey, issueTitle, mergeSighting, stripSpecifics,
  worthRaising, type StoredIssue,
} from './coachIssues.js';

describe('a habit versus a to-do', () => {
  it('keeps points that describe how someone works', () => {
    for (const p of [
      'Call first on late leads',
      'Stop handing check-ins back to the client',
      'Book a time before hanging up',
      'Six-second calls',
      'Close with times',
      'Call new leads within five minutes',
      'Same-day text on every no-answer',
      'Stop leading with vacation',
      'Lock a specific meeting time',
    ]) expect(isBehavioural(p), p).toBe(true);
  });

  it('drops points that are one buyer on one day', () => {
    // These are real to-dos and they belong in the app. They are not patterns,
    // and putting them in a daily brief as though they were is the "Patricia
    // Chatman said she was still deciding" problem: a fact with no instruction.
    for (const p of [
      'Christina Marini August 18 call',
      'Leann voicemail',
      'Log the Mezher appointment',
      'Osborne showing time',
      'Karen follow-up lag',
      'Tina L. voicemail',
      'Waseem Sam August 20 call',
    ]) expect(isBehavioural(p), p).toBe(false);
  });

  it('strips who and when but never the verb', () => {
    expect(stripSpecifics('Christina Marini August 18 call')).toBe('call');
    expect(stripSpecifics('Call first on late leads')).toBe('Call first on late leads');
    // A leading capital is sentence case, not a name.
    expect(stripSpecifics('Book the Nashville visit')).toBe('Book the visit');
  });
});

describe('the same issue, worded differently', () => {
  it('lands on one key however the words are ordered', () => {
    expect(issueKey('Call first on late leads')).toBe(issueKey('On late leads, call first'));
  });

  it('keeps genuinely different habits apart', () => {
    // Close, but not the same. Merging them would let the brief claim a bigger
    // pattern than the evidence supports, and a number a leader cannot verify
    // is worse than two smaller ones they can.
    expect(issueKey('Call first on late leads')).not.toBe(issueKey('Call first on flagged leads'));
  });

  it('says it the way the analysis wrote it', () => {
    expect(issueTitle('Stop handing check-ins back to the client'))
      .toBe('Stop handing check-ins back to the client');
    expect(issueTitle('x'.repeat(80))).toHaveLength(60);
  });
});

describe('pulling issues out of a report', () => {
  const report = {
    agents: [{
      agentName: 'Antwoinette Sipple',
      coachingActions: [
        { text: 'Same-day text on every no-answer', findingIndexes: [0, 1, 2] },
        { text: 'Log the Mezher appointment', findingIndexes: [3] },
      ],
    }],
    findings: [
      { leadName: 'Gina Smith', occurredAt: '2026-08-20T15:00:00Z' },
      { leadName: 'Irene E', occurredAt: '2026-08-21T15:00:00Z' },
      { leadName: 'Gina Smith', occurredAt: '2026-08-22T15:00:00Z' },
      { leadName: 'Mezher', occurredAt: '2026-08-22T16:00:00Z' },
    ],
  };

  it('counts distinct buyers, not findings', () => {
    // "Three different buyers" is a far stronger thing to put to an agent than
    // "three times", and three findings on one buyer is one situation.
    const [issue] = extractIssues(report);
    expect(issue.leads.sort()).toEqual(['Gina Smith', 'Irene E']);
  });

  it('leaves the one-buyer to-do out entirely', () => {
    expect(extractIssues(report)).toHaveLength(1);
  });

  it('dates the evidence by the latest call behind it', () => {
    expect(extractIssues(report)[0].latestOccurredAt).toBe('2026-08-22T15:00:00Z');
  });
});

describe('what a new sighting does to what we already knew', () => {
  const base: StoredIssue = {
    status: 'open', times_seen: 1, distinct_leads: 2, raised_count: 0,
    occurrences: [{ reportDate: '2026-08-24', leads: ['Gina Smith', 'Irene E'], n: 2 }],
    last_raised_at: null,
  };

  it('ignores the same report arriving twice', () => {
    // Ingest is retried freely, so this has to be safe.
    const r = mergeSighting(base, {
      reportDate: '2026-08-24', leads: ['Gina Smith', 'Irene E'], latestOccurredAt: null,
    });
    expect(r.duplicate).toBe(true);
  });

  it('accumulates buyers across days without double counting', () => {
    const r = mergeSighting(base, {
      reportDate: '2026-08-25', leads: ['Gina Smith', 'Michael G'], latestOccurredAt: null,
    });
    expect(r.times_seen).toBe(2);
    expect(r.distinct_leads).toBe(3);
  });

  it('stays silent when a raised issue is merely re-reported', () => {
    // THE rule. A rolling window re-reports the same week every day, so
    // tomorrow's report WILL mention these calls again. That is not the agent
    // ignoring anyone, and treating it as such would have the brief cry wolf
    // every morning about something already dealt with.
    const raised: StoredIssue = {
      ...base, status: 'raised', raised_count: 1, last_raised_at: '2026-08-25T11:30:00Z',
    };
    const r = mergeSighting(raised, {
      reportDate: '2026-08-26', leads: ['Gina Smith'], latestOccurredAt: '2026-08-22T15:00:00Z',
    });
    expect(r.recurredAfterRaise).toBe(false);
    expect(r.status).toBe('raised');
    expect(worthRaising(r)).toBe(false);
  });

  it('wakes up when the behaviour happens again AFTER the conversation', () => {
    const raised: StoredIssue = {
      ...base, status: 'raised', raised_count: 1, last_raised_at: '2026-08-25T11:30:00Z',
    };
    const r = mergeSighting(raised, {
      reportDate: '2026-08-27', leads: ['Someone New'], latestOccurredAt: '2026-08-26T18:00:00Z',
    });
    expect(r.recurredAfterRaise).toBe(true);
    expect(r.status).toBe('recurring');
    expect(worthRaising(r)).toBe(true);
  });

  it('stays silent when the call has no date to judge by', () => {
    // Silence is the safer error when the alternative is telling a leader that
    // somebody ignored them.
    const raised: StoredIssue = {
      ...base, status: 'raised', raised_count: 1, last_raised_at: '2026-08-25T11:30:00Z',
    };
    const r = mergeSighting(raised, {
      reportDate: '2026-08-27', leads: ['Someone New'], latestOccurredAt: null,
    });
    expect(r.recurredAfterRaise).toBe(false);
  });

  it('reopens something that was resolved and came back', () => {
    const resolved: StoredIssue = { ...base, status: 'resolved' };
    const r = mergeSighting(resolved, {
      reportDate: '2026-08-30', leads: ['Gina Smith'], latestOccurredAt: '2026-08-29T12:00:00Z',
    });
    expect(r.status).toBe('open');
  });
});

describe('what earns a place in the morning', () => {
  it('needs two different buyers, not one', () => {
    expect(worthRaising({ status: 'open', distinct_leads: 1 })).toBe(false);
    expect(worthRaising({ status: 'open', distinct_leads: 2 })).toBe(true);
  });

  it('never repeats something already raised', () => {
    expect(worthRaising({ status: 'raised', distinct_leads: 9 })).toBe(false);
  });

  it('always says something that recurred, however small', () => {
    expect(worthRaising({ status: 'recurring', distinct_leads: 1 })).toBe(true);
  });

  it('stays quiet once somebody has actually had the conversation', () => {
    expect(worthRaising({ status: 'contacted', distinct_leads: 5 })).toBe(false);
    expect(worthRaising({ status: 'resolved', distinct_leads: 5 })).toBe(false);
  });
});
