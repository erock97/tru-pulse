import { describe, it, expect } from 'vitest';
import { resolveLearner } from './repLearner.js';
import type { Db } from './db.js';

/** A fake PostgREST that answers by table + query substring, and records inserts. */
function fakeDb(rows: Record<string, any[]>, inserted: any[] = []): Db {
  return {
    async select(table: string, query: string) {
      const all = rows[table] ?? [];
      if (table === 'rep_learners' && query.includes('agent_id=eq.')) {
        const id = query.split('agent_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.agent_id === id);
      }
      if (table === 'rep_learners' && query.includes('user_id=eq.')) {
        const id = query.split('user_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.user_id === id);
      }
      if (table === 'agents' && query.includes('auth_id=eq.')) {
        const id = query.split('auth_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.auth_id === id);
      }
      if (table === 'memberships' && query.includes('user_id=eq.')) {
        const id = query.split('user_id=eq.')[1].split('&')[0];
        return all.filter((r) => r.user_id === id);
      }
      if (table === 'leaders' && query.includes('id=eq.')) {
        const id = query.split('id=eq.')[1].split('&')[0];
        return all.filter((r) => r.id === id);
      }
      return all;
    },
    async insert(table: string, row: any) { inserted.push({ table, row }); return { id: 'new-learner', ...row }; },
    async upsert() {}, async update() {},
  } as unknown as Db;
}

describe('resolveLearner', () => {
  it('returns the existing learner row for an agent', async () => {
    const db = fakeDb({
      agents: [{ id: 'ag1', org_id: 'o1', auth_id: 'u1', name: 'Maya', email: 'm@x.co' }],
      rep_learners: [{ id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1', user_id: null }],
    });
    expect(await resolveLearner(db, 'u1')).toEqual(
      { id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1' });
  });

  it('creates a member learner on first sight of a leader', async () => {
    const inserted: any[] = [];
    const db = fakeDb({
      agents: [],
      memberships: [{ user_id: 'u2', org_id: 'o1', role: 'leader' }],
      rep_learners: [],
      leaders: [{ id: 'u2', name: 'Eric', email: 'eric@truhq.co' }],
    }, inserted);
    const learner = await resolveLearner(db, 'u2', 'o1');
    expect(learner?.kind).toBe('member');
    expect(inserted[0].table).toBe('rep_learners');
    expect(inserted[0].row).toMatchObject({ org_id: 'o1', kind: 'member', user_id: 'u2', name: 'Eric' });
  });

  it('falls back to a placeholder name when the leader has no identity row', async () => {
    const inserted: any[] = [];
    const db = fakeDb({
      agents: [],
      memberships: [{ user_id: 'u3', org_id: 'o1', role: 'admin' }],
      rep_learners: [],
      leaders: [],
    }, inserted);
    await resolveLearner(db, 'u3');
    expect(inserted[0].row).toMatchObject({ name: 'Team leader', email: null });
  });

  it('honours the org hint when a leader runs more than one org', async () => {
    const inserted: any[] = [];
    const db = fakeDb({
      agents: [],
      memberships: [
        { user_id: 'u4', org_id: 'o1', role: 'leader' },
        { user_id: 'u4', org_id: 'o2', role: 'leader' },
      ],
      rep_learners: [],
      leaders: [{ id: 'u4', name: 'Eric', email: 'eric@truhq.co' }],
    }, inserted);
    const learner = await resolveLearner(db, 'u4', 'o2');
    expect(learner?.org_id).toBe('o2');
  });

  it('returns null when the user is neither an agent nor a member', async () => {
    const db = fakeDb({ agents: [], memberships: [], rep_learners: [] });
    expect(await resolveLearner(db, 'nobody')).toBeNull();
  });

  it('prefers the agent identity when a user is somehow both', async () => {
    const db = fakeDb({
      agents: [{ id: 'ag1', org_id: 'o1', auth_id: 'u1', name: 'Maya', email: null }],
      memberships: [{ user_id: 'u1', org_id: 'o1', role: 'leader' }],
      rep_learners: [{ id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1', user_id: null }],
    });
    expect((await resolveLearner(db, 'u1'))?.kind).toBe('agent');
  });
});
