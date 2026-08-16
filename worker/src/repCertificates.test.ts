import { describe, it, expect } from 'vitest';
import { maybeIssueCertificates } from './repCertificates.js';
import type { Learner } from './repLearner.js';
import type { Db } from './db.js';

const learner: Learner = { id: 'L1', org_id: 'o1', kind: 'agent', agent_id: 'ag1' };

const TRACKS = [
  { id: 't1', slug: 'zillow', title: 'Zillow Preferred', subtitle: null, cover: null, order_idx: 1 },
  { id: 't2', slug: 'fund', title: 'Fundamentals', subtitle: null, cover: null, order_idx: 2 },
];
const TRACK_MODULES = [
  { track_id: 't1', module_id: 'm1', idx: 1, required: true },
  { track_id: 't1', module_id: 'm2', idx: 2, required: true },
  { track_id: 't1', module_id: 'm3', idx: 3, required: false },
  { track_id: 't2', module_id: 'm9', idx: 1, required: true },
];

const passed = (...ids: string[]) =>
  ids.map((id) => ({ module_id: id, status: 'passed', score: 100, passed_at: 'x' }));

function fakeDb(opts: {
  progress: any[]; certificates?: any[]; assignments?: any[];
}) {
  const upserts: any[] = [];
  const updates: Array<{ table: string; query: string; patch: any }> = [];
  const certs = [...(opts.certificates ?? [])];
  const db = {
    async select(table: string) {
      if (table === 'rep_tracks') return TRACKS;
      if (table === 'rep_track_modules') return TRACK_MODULES;
      if (table === 'rep_progress') return opts.progress;
      if (table === 'rep_certificates') return certs;
      if (table === 'rep_assignments') return opts.assignments ?? [];
      return [];
    },
    async upsert(table: string, rows: any[], onConflict?: string, o?: any) {
      upserts.push({ table, rows, onConflict, opts: o });
      // Persist, so a second call in the same test sees them as already issued.
      if (table === 'rep_certificates') certs.push(...rows.map((r) => ({ track_id: r.track_id })));
    },
    async update(table: string, query: string, patch: any) { updates.push({ table, query, patch }); },
    async insert() { return {}; },
  } as unknown as Db;
  return { db, upserts, updates };
}

describe('maybeIssueCertificates', () => {
  it('issues nothing while a required module is unpassed', async () => {
    const { db, upserts } = fakeDb({ progress: passed('m1') });
    expect(await maybeIssueCertificates(db, learner)).toEqual([]);
    expect(upserts).toHaveLength(0);
  });

  it('issues one certificate when the last required module passes', async () => {
    const { db, upserts } = fakeDb({ progress: passed('m1', 'm2') });
    expect(await maybeIssueCertificates(db, learner)).toEqual(['t1']);
    expect(upserts[0].rows[0]).toMatchObject({ org_id: 'o1', learner_id: 'L1', track_id: 't1' });
    expect(upserts[0].onConflict).toBe('learner_id,track_id');
    expect(upserts[0].opts).toMatchObject({ ignoreDuplicates: true });
  });

  it('ignores OPTIONAL modules when deciding completion', async () => {
    // m3 is required:false and unpassed — the certificate still issues.
    const { db } = fakeDb({ progress: passed('m1', 'm2') });
    expect(await maybeIssueCertificates(db, learner)).toEqual(['t1']);
  });

  it('is idempotent — a second call issues nothing', async () => {
    const { db } = fakeDb({ progress: passed('m1', 'm2') });
    await maybeIssueCertificates(db, learner);
    expect(await maybeIssueCertificates(db, learner)).toEqual([]);
  });

  it('never re-issues one already on record', async () => {
    const { db, upserts } = fakeDb({
      progress: passed('m1', 'm2'), certificates: [{ track_id: 't1' }],
    });
    expect(await maybeIssueCertificates(db, learner)).toEqual([]);
    expect(upserts).toHaveLength(0);
  });

  it('stamps the matching assignment completed_at', async () => {
    const { db, updates } = fakeDb({
      progress: passed('m1', 'm2'),
      assignments: [{ track_id: 't1', due_at: null, completed_at: null }],
    });
    await maybeIssueCertificates(db, learner);
    const u = updates.find((x) => x.table === 'rep_assignments');
    expect(u?.patch.completed_at).toBeTruthy();
    expect(u?.query).toContain('track_id=eq.t1');
  });

  it('does not touch assignments for an unassigned track', async () => {
    const { db, updates } = fakeDb({ progress: passed('m1', 'm2') });
    await maybeIssueCertificates(db, learner);
    expect(updates).toHaveLength(0);
  });

  it('issues for every track finished at once', async () => {
    const { db } = fakeDb({ progress: passed('m1', 'm2', 'm9') });
    expect((await maybeIssueCertificates(db, learner)).sort()).toEqual(['t1', 't2']);
  });
});
