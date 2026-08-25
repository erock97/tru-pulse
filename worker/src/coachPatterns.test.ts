// Rules 3-10 of the Hermes daily handoff. The scenario throughout is the one
// that actually happens: a rolling seven-day window re-sending the same call
// every morning for a week.
import { describe, it, expect, vi } from 'vitest';
import type { Db } from './db.js';
import { absorbReport, coachViewFor } from './coachPatterns.js';
import { validateCoachBrief } from '../../shared/coachBrief.js';

const TEAM = { id: 'team-1', org_id: 'org-1' };

/** A report naming one habit backed by the given findings. */
function report(over: {
  runId?: string; start?: string; end?: string;
  agent?: string; patternKey?: string;
  findings?: Array<{ id: string; at: string; lead?: string }>;
} = {}) {
  const findings = over.findings ?? [{ id: 'fnd_a', at: '2026-08-20T09:00:00Z', lead: 'Lead A' }];
  const raw = {
    schemaVersion: '1.1',
    run: {
      runId: over.runId ?? 'run-1', trigger: 'daily', teamId: 'costigan',
      startDate: over.start ?? '2026-08-17', endDate: over.end ?? '2026-08-23',
      generatedAt: '2026-08-24T12:00:00.000Z',
    },
    agents: [{
      agentName: over.agent ?? 'Kara',
      opportunities: [{
        findingIds: findings.map((f) => f.id),
        patternKey: over.patternKey ?? 'next_steps',
        explanation: 'Ends calls without booking a time.',
        coachingMove: 'Ask for a day and hour before hanging up.',
      }],
    }],
    findings: findings.map((f, i) => ({
      findingIndex: i, findingId: f.id, agentName: over.agent ?? 'Kara',
      leadName: f.lead ?? 'Lead', occurredAt: f.at, channel: 'call',
      quote: 'Evidence.',
    })),
  };
  const v = validateCoachBrief(raw);
  if (!v.ok) throw new Error(`fixture invalid: ${v.errors.join(', ')}`);
  return v.brief;
}

/** A database that behaves like the real one where it matters: the evidence
 *  table's primary key rejects a finding it already holds. */
function stub() {
  const patterns = new Map<string, any>();
  const findings = new Set<string>();
  const state: any[] = [];
  let n = 0;

  const db = {
    select: vi.fn(async (table: string, query: string) => {
      if (table === 'coach_patterns') {
        const key = /agent_name=eq\.([^&]+).*pattern_key=eq\.([^&]+)/.exec(query);
        if (!key) return [];
        const id = patterns.get(`${decodeURIComponent(key[1])}::${decodeURIComponent(key[2])}`);
        return id ? [{ id }] : [];
      }
      return [];
    }),
    insert: vi.fn(async (table: string, row: any) => {
      if (table === 'coach_patterns') {
        const id = `pat-${++n}`;
        patterns.set(`${row.agent_name}::${row.pattern_key}`, id);
        return { id, ...row };
      }
      if (table === 'coach_pattern_findings') {
        const pk = `${row.pattern_id}::${row.finding_id}`;
        // This is rule 3, and it lives in the schema rather than in a check
        // somebody has to remember to write.
        if (findings.has(pk)) throw new Error('duplicate key value violates unique constraint');
        findings.add(pk);
        return row;
      }
      return row;
    }),
    update: vi.fn(async () => undefined),
    upsert: vi.fn(async (table: string, rows: any[]) => {
      if (table === 'coach_team_state') { state.length = 0; state.push(...rows); }
    }),
  } as unknown as Db;

  return { db, patterns, findings, state };
}

describe('rule 3 — the same finding, every morning for a week', () => {
  it('counts one call once, however many times it is delivered', async () => {
    // The whole reason this module exists. Seven identical deliveries of one
    // conversation must not look like seven conversations.
    const s = stub();
    let firstRun: any = null;
    for (let day = 0; day < 7; day++) {
      const r = await absorbReport(s.db, TEAM, report({ runId: `run-day-${day}` }));
      if (day === 0) firstRun = r;
    }
    expect(firstRun.newFindings).toBe(1);
    expect(s.findings.size).toBe(1);
  });

  it('reports the duplicates rather than hiding them', async () => {
    const s = stub();
    await absorbReport(s.db, TEAM, report());
    const second = await absorbReport(s.db, TEAM, report({ runId: 'run-2' }));
    expect(second.newFindings).toBe(0);
    expect(second.duplicateFindings).toBe(1);
  });

  it('creates the pattern once, not once per delivery', async () => {
    const s = stub();
    await absorbReport(s.db, TEAM, report());
    await absorbReport(s.db, TEAM, report({ runId: 'run-2' }));
    expect(s.patterns.size).toBe(1);
  });
});

describe('rule 7 — grouping', () => {
  it('keeps two agents with the same category apart', async () => {
    // A shared patternKey means the same coaching category, not a collision.
    const s = stub();
    await absorbReport(s.db, TEAM, report({ agent: 'Kara' }));
    await absorbReport(s.db, TEAM, report({
      agent: 'Sam', runId: 'run-2',
      findings: [{ id: 'fnd_b', at: '2026-08-21T09:00:00Z' }],
    }));
    expect(s.patterns.size).toBe(2);
  });

  it('keeps two categories for one agent apart', async () => {
    const s = stub();
    await absorbReport(s.db, TEAM, report({ patternKey: 'next_steps' }));
    await absorbReport(s.db, TEAM, report({
      patternKey: 'call_first', runId: 'run-2',
      findings: [{ id: 'fnd_b', at: '2026-08-21T09:00:00Z' }],
    }));
    expect(s.patterns.size).toBe(2);
  });

  it('files a reworded explanation under the same pattern', async () => {
    // Identity is the category, never the prose. Hermes rewording a point must
    // not start a second pattern and halve its evidence.
    const s = stub();
    await absorbReport(s.db, TEAM, report());
    const b = report({ runId: 'run-2', findings: [{ id: 'fnd_b', at: '2026-08-21T09:00:00Z' }] });
    b.agents[0].opportunityPoints[0].explanation = 'Completely different wording here.';
    await absorbReport(s.db, TEAM, b);
    expect(s.patterns.size).toBe(1);
    expect(s.findings.size).toBe(2);
  });
});

describe('rule 8 — two different occurrences, not one repeated', () => {
  it('accumulates distinct findings across days', async () => {
    const s = stub();
    await absorbReport(s.db, TEAM, report({
      findings: [{ id: 'fnd_a', at: '2026-08-20T09:00:00Z' }],
    }));
    await absorbReport(s.db, TEAM, report({
      runId: 'run-2',
      findings: [
        { id: 'fnd_a', at: '2026-08-20T09:00:00Z' },   // yesterday's, again
        { id: 'fnd_b', at: '2026-08-21T09:00:00Z' },   // genuinely new
      ],
    }));
    // Two distinct occurrences: the threshold is reached honestly.
    expect(s.findings.size).toBe(2);
  });

  it('never reaches two by re-sending one finding', async () => {
    const s = stub();
    for (let i = 0; i < 5; i++) {
      await absorbReport(s.db, TEAM, report({ runId: `run-${i}` }));
    }
    expect(s.findings.size).toBe(1);
  });
});

describe('rule 6 — the window only moves for an accepted report', () => {
  it('records the window and the generated time from the run', async () => {
    const s = stub();
    await absorbReport(s.db, TEAM, report({ start: '2026-08-18', end: '2026-08-24' }));
    expect(s.state[0]).toMatchObject({
      window_start: '2026-08-18',
      window_end: '2026-08-24',
      generated_at: '2026-08-24T12:00:00.000Z',
      last_run_id: 'run-1',
    });
  });

  it('advances to the newer window on the next accepted run', async () => {
    const s = stub();
    await absorbReport(s.db, TEAM, report({ start: '2026-08-17', end: '2026-08-23' }));
    await absorbReport(s.db, TEAM, report({
      runId: 'run-2', start: '2026-08-18', end: '2026-08-24',
      findings: [{ id: 'fnd_b', at: '2026-08-24T09:00:00Z' }],
    }));
    expect(s.state[0].window_end).toBe('2026-08-24');
  });
});

describe('rule 11 — the universal admin profile', () => {
  it('produces no pattern at all', async () => {
    const s = stub();
    const r = await absorbReport(s.db, TEAM, report({ agent: 'Eric and Adam' }));
    expect(r.ignoredAgents).toBe(1);
    expect(s.patterns.size).toBe(0);
    expect(s.findings.size).toBe(0);
  });
});

describe('evidence we cannot recognise again', () => {
  it('drops a finding with no durable id rather than counting it', async () => {
    // Without a findingId there is no way to tell tomorrow whether this is the
    // same evidence, so counting it would inflate every threshold in the spec.
    const s = stub();
    const b = report();
    delete (b.findings[0] as any).findingId;
    b.agents[0].opportunityPoints[0].findingIds = [];
    b.agents[0].opportunityPoints[0].findingIndex = 0;
    const r = await absorbReport(s.db, TEAM, b);
    expect(r.newFindings).toBe(0);
    expect(s.findings.size).toBe(0);
  });

  it('ignores an opportunity with no pattern key', async () => {
    const s = stub();
    const b = report();
    delete (b.agents[0].opportunityPoints[0] as any).patternKey;
    await absorbReport(s.db, TEAM, b);
    expect(s.patterns.size).toBe(0);
  });
});


describe('the coach view shows agents, not the people running the team', () => {
  /** A database holding one live pattern per person named. */
  function viewStub(people: Array<{ id: string; role: string; name: string }>) {
    return {
      select: vi.fn(async (table: string) => {
        if (table === 'agents') return people.map((p) => ({ id: p.id, role: p.role }));
        if (table === 'coach_patterns_live') {
          return people.map((p) => ({
            agent_id: p.id, agent_name: p.name, pattern_key: 'next_steps',
            explanation: 'x', coaching_move: 'y',
            occurrences: 2, occurrences_this_window: 2,
            is_current: true, is_recurring: true,
            window_start: '2026-08-18', window_end: '2026-08-24',
            last_update: '2026-08-25T12:00:00.000Z',
          }));
        }
        return [];
      }),
    } as unknown as Db;
  }

  it('drops the broker and the team lead, keeps the agents', async () => {
    // Live on 2026-08-25: Signature's broker and an admin, and Woosley's team
    // lead, each came back with coaching points of their own.
    const db = viewStub([
      { id: 'a1', role: 'agent', name: 'Cara Benak' },
      { id: 'a2', role: 'admin', name: 'Michelle Pais' },
      { id: 'a3', role: 'lead',  name: 'Carson Woosley' },
    ]);
    const view = await coachViewFor(db, 'team-1');
    expect(view.current.map((r) => r.agent)).toEqual(['Cara Benak']);
    expect(view.trend).toEqual([]);
  });

  it('keeps a name the roster does not recognise', async () => {
    // Hiding evidence because we failed to match somebody is the worse error:
    // it looks like a quiet week rather than a name needing categorising.
    const db = {
      select: vi.fn(async (table: string) => {
        if (table === 'agents') return [{ id: 'a2', role: 'admin' }];
        if (table === 'coach_patterns_live') {
          return [{
            agent_id: null, agent_name: 'Somebody New',
            pattern_key: 'next_steps', occurrences: 1, occurrences_this_window: 1,
            is_current: true, is_recurring: false,
            window_start: '2026-08-18', window_end: '2026-08-24',
          }];
        }
        return [];
      }),
    } as unknown as Db;
    const view = await coachViewFor(db, 'team-1');
    expect(view.current.map((r) => r.agent)).toEqual(['Somebody New']);
  });

  it('still reports the window when every row was filtered out', async () => {
    // The header says when Coach last updated. A team whose only points belong
    // to its lead must not read as "never analysed".
    const db = viewStub([{ id: 'a3', role: 'lead', name: 'Carson Woosley' }]);
    const view = await coachViewFor(db, 'team-1');
    expect(view.current).toEqual([]);
    expect(view.window).toEqual({ start: '2026-08-18', end: '2026-08-24' });
    expect(view.lastUpdate).toBe('2026-08-25T12:00:00.000Z');
  });
});
