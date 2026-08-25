// The daily brief, built from the stored patterns rather than the morning's
// report. The scenario throughout is the one that actually happens: Hermes
// re-sends the same seven days every morning, so almost everything the store
// holds on Tuesday is something the broker was already told on Monday.
import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../db.js';
import {
  renderPatternBrief, rankPatterns, teamLine, labelFor, isGsm7,
  previewCoachBriefs, markBriefed,
  type BriefPattern,
} from './coachBrief.js';

const p = (over: Partial<BriefPattern> = {}): BriefPattern => ({
  agentName: 'Cara Benak',
  patternKey: 'lead_e',
  thisWeek: 1,
  recurring: false,
  ...over,
});

describe('what a broker is told', () => {
  it('names the agent, the habit and how often', () => {
    const out = renderPatternBrief({
      teamName: 'Costigan', dateLabel: 'Mon Aug 25',
      patterns: [p({ agentName: 'Cara Benak', thisWeek: 3, recurring: true })],
    });
    expect(out.body).toContain('Cara: no time set to talk again, 3 this week');
  });

  it('leaves the count off a single occurrence', () => {
    // "1 this week" is four wasted characters and reads as a tally rather than
    // a thing that happened.
    const out = renderPatternBrief({
      teamName: 'Costigan', dateLabel: 'Mon Aug 25', patterns: [p({ thisWeek: 1 })],
    });
    expect(out.body).toContain('Cara: no time set to talk again\n');
    expect(out.body).not.toContain('1 this week');
  });

  it('never names an agent twice', () => {
    // Three habits belonging to one person is still one conversation to have.
    const out = renderPatternBrief({
      teamName: 'Costigan', dateLabel: 'Mon Aug 25',
      patterns: [
        p({ patternKey: 'lead_e', thisWeek: 3 }),
        p({ patternKey: 'call_first', thisWeek: 2 }),
        p({ patternKey: 'objection', thisWeek: 1 }),
      ],
    });
    expect(out.named).toEqual(['Cara']);
    expect(out.needing).toBe(1);
  });

  it('stops at three names and counts the rest', () => {
    const patterns = ['Ana', 'Ben', 'Cal', 'Dee', 'Eve'].map((n) =>
      p({ agentName: `${n} Smith`, thisWeek: 2 }));
    const out = renderPatternBrief({
      teamName: 'Costigan', dateLabel: 'Mon Aug 25', patterns,
    });
    expect(out.named).toHaveLength(3);
    expect(out.body).toContain('+2 more in the app');
  });

  it('says so plainly when nothing has moved', () => {
    // The common case by Wednesday. The caller sends nothing; a daily
    // "nothing to report" text is how a channel teaches people to ignore it.
    const out = renderPatternBrief({
      teamName: 'Costigan', dateLabel: 'Wed Aug 27', patterns: [],
    });
    expect(out.needing).toBe(0);
    expect(out.body).toContain('Nothing new in the calls since yesterday');
  });

  it('fits in a text, in plain characters, on real team-sized input', () => {
    // One curly quote or em-dash halves every segment from 160 characters to
    // 70. This is the test that keeps that regression out permanently.
    const patterns = Array.from({ length: 40 }, (_, i) =>
      p({ agentName: `Agent${i} Verylongsurname`, thisWeek: 4, recurring: true }));
    const out = renderPatternBrief({
      teamName: 'Signature Realty', dateLabel: 'Mon Aug 25', patterns,
    });
    expect(isGsm7(out.body)).toBe(true);
    expect(out.segments).toBeLessThanOrEqual(4);
    expect(out.body.length).toBeLessThanOrEqual(612);
  });
});

describe('worst first', () => {
  it('puts a habit above a one-off', () => {
    const ranked = rankPatterns([
      p({ agentName: 'Ann One', thisWeek: 1, recurring: false }),
      p({ agentName: 'Bob Two', thisWeek: 1, recurring: true }),
    ]);
    expect(ranked[0].agentName).toBe('Bob Two');
  });

  it('orders two habits by how often they happened', () => {
    const ranked = rankPatterns([
      p({ agentName: 'Ann One', thisWeek: 2, recurring: true }),
      p({ agentName: 'Bob Two', thisWeek: 5, recurring: true }),
    ]);
    expect(ranked[0].agentName).toBe('Bob Two');
  });

  it('is stable when everything else ties', () => {
    // Otherwise the same morning renders differently on a retry, and a broker
    // reading two copies sees two different briefs.
    const input = [p({ agentName: 'Zoe Last' }), p({ agentName: 'Amy First' })];
    expect(rankPatterns(input)[0].agentName).toBe('Amy First');
    expect(rankPatterns([...input].reverse())[0].agentName).toBe('Amy First');
  });
});

describe('the team-wide line', () => {
  it('states a habit three agents share', () => {
    const line = teamLine([
      p({ agentName: 'Ann One', patternKey: 'call_first' }),
      p({ agentName: 'Bob Two', patternKey: 'call_first' }),
      p({ agentName: 'Cal Three', patternKey: 'call_first' }),
    ]);
    expect(line.line).toBe('3 of 3 agents: texting when the buyer asked for a call.');
  });

  it('stays silent when only two share it', () => {
    // Two people doing the same thing is a coincidence a broker handles by
    // talking to both. Calling it a team pattern devalues the phrase.
    const line = teamLine([
      p({ agentName: 'Ann One', patternKey: 'call_first' }),
      p({ agentName: 'Bob Two', patternKey: 'call_first' }),
      p({ agentName: 'Cal Three', patternKey: 'objection' }),
    ]);
    expect(line.line).toBeNull();
  });

  it('picks the most widespread habit when several qualify', () => {
    const line = teamLine([
      ...['A', 'B', 'C'].map((n) => p({ agentName: `${n} X`, patternKey: 'objection' })),
      ...['A', 'B', 'C', 'D'].map((n) => p({ agentName: `${n} X`, patternKey: 'lead_e' })),
    ]);
    expect(line.patternKey).toBe('lead_e');
    expect(line.agents).toBe(4);
  });
});

describe('a category we have not seen before', () => {
  it('reads its own name rather than vanishing', () => {
    // Hermes owns the taxonomy and can add to it. Dropping a whole category
    // because we had not heard of it would be silent, which is the worst kind
    // of wrong here.
    expect(labelFor('rapport_building')).toBe('rapport building');
  });

  it('keeps a known category in plain words', () => {
    expect(labelFor('premature_representation')).toBe('promising what they can only ask for');
  });
});

// ── Reading the store ────────────────────────────────────────────────────────

function row(over: Record<string, any> = {}) {
  return {
    id: over.id ?? 'pat-1',
    team_id: 'team-1',
    agent_id: 'a1',
    agent_name: 'Cara Benak',
    pattern_key: 'lead_e',
    explanation: 'Ends texts without offering a time.',
    occurrences: 3,
    occurrences_this_window: 3,
    is_current: true,
    is_recurring: true,
    brief_worthy: true,
    window_start: '2026-08-18',
    window_end: '2026-08-24',
    last_update: '2026-08-25T12:00:00.000Z',
    ...over,
  };
}

function storeStub(rows: any[], roster: any[] = [{ id: 'a1', role: 'agent' }]) {
  const updates: Array<{ query: string; patch: any }> = [];
  const db = {
    select: vi.fn(async (table: string, query: string) => {
      if (table === 'coach_patterns_live') {
        if (query.includes('id=in.')) {
          return rows.map((r) => ({ id: r.id, occurrences: r.occurrences }));
        }
        return rows;
      }
      if (table === 'teams') return [{ id: 'team-1', name: 'Costigan' }];
      if (table === 'agents') return roster;
      return [];
    }),
    update: vi.fn(async (_t: string, query: string, patch: any) => {
      updates.push({ query, patch });
    }),
  } as unknown as Db;
  return { db, updates };
}

describe('the same thing, every morning for a week', () => {
  it('says a habit once and stays quiet the next day', async () => {
    // Monday: new pattern, three occurrences. It gets said.
    const monday = storeStub([row()]);
    const [first] = await previewCoachBriefs(monday.db, 'Mon Aug 25');
    expect(first.needing).toBe(1);
    expect(first.body).toContain('Cara: no time set to talk again, 3 this week');

    await markBriefed(monday.db, first.patternIds);
    expect(monday.updates[0].patch).toMatchObject({ briefed_occurrences: 3 });

    // Tuesday: Hermes re-sends the identical week, so the store is unchanged
    // and the database says this is no longer worth saying.
    const tuesday = storeStub([row({ brief_worthy: false })]);
    const [second] = await previewCoachBriefs(tuesday.db, 'Tue Aug 26');
    expect(second.needing).toBe(0);
    expect(second.body).toContain('Nothing new');
  });

  it('brings a habit back when it happens again', async () => {
    const s = storeStub([row({ brief_worthy: true, occurrences: 4, occurrences_this_window: 4 })]);
    const [brief] = await previewCoachBriefs(s.db, 'Tue Aug 26');
    expect(brief.body).toContain('4 this week');
  });

  it('still reports how much is standing behind the quiet', async () => {
    // "Nothing new" must not read as "nothing wrong". The count of what is
    // current is what tells a broker the app is still worth opening.
    const s = storeStub([row({ brief_worthy: false }), row({ id: 'pat-2', brief_worthy: false })]);
    const [brief] = await previewCoachBriefs(s.db, 'Tue Aug 26');
    expect(brief.needing).toBe(0);
    expect(brief.currentPatterns).toBe(2);
    expect(brief.analysisWindow).toBe('2026-08-18 to 2026-08-24');
  });
});

describe('a preview must not consume the send', () => {
  it('writes nothing', async () => {
    const s = storeStub([row()]);
    await previewCoachBriefs(s.db, 'Mon Aug 25');
    expect(s.db.update).not.toHaveBeenCalled();
    expect(s.updates).toEqual([]);
  });

  it('marks nothing when a brief spoke for nothing', async () => {
    const s = storeStub([row({ brief_worthy: false })]);
    const [brief] = await previewCoachBriefs(s.db, 'Tue Aug 26');
    expect(await markBriefed(s.db, brief.patternIds)).toBe(0);
    expect(s.db.update).not.toHaveBeenCalled();
  });
});

describe('who gets coached', () => {
  it('leaves out the broker and the team lead', async () => {
    const s = storeStub(
      [row({ id: 'pat-1', agent_id: 'a1', agent_name: 'Cara Benak' }),
       row({ id: 'pat-2', agent_id: 'a2', agent_name: 'Michelle Pais' })],
      [{ id: 'a1', role: 'agent' }, { id: 'a2', role: 'admin' }],
    );
    const [brief] = await previewCoachBriefs(s.db, 'Mon Aug 25');
    expect(brief.named).toEqual(['Cara']);
    expect(brief.currentPatterns).toBe(1);
  });
});
