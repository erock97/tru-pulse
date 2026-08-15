import { describe, it, expect } from 'vitest';
import { buildTrackViews, isModuleLocked, searchModules } from './repLibrary.js';

const NOW = new Date('2026-08-14T12:00:00Z');
const tracks = [
  { id: 't1', slug: 'zillow-day1', title: 'Zillow Preferred Onboarding', subtitle: null, cover: null, order_idx: 1 },
  { id: 't2', slug: 'fundamentals', title: 'TRU Fundamentals', subtitle: null, cover: null, order_idx: 2 },
];
const tms = [
  { track_id: 't1', module_id: 'm1', idx: 1, required: true },
  { track_id: 't1', module_id: 'm2', idx: 2, required: true },
  { track_id: 't1', module_id: 'm3', idx: 3, required: false },
  { track_id: 't2', module_id: 'm9', idx: 1, required: true },
];

describe('buildTrackViews', () => {
  it('counts only REQUIRED modules toward completion', () => {
    const v = buildTrackViews(tracks, tms, [{ module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' }], [], NOW);
    const t1 = v.find((t) => t.id === 't1')!;
    expect(t1.total).toBe(2);
    expect(t1.passed).toBe(1);
    expect(t1.pct).toBe(50);
    expect(t1.complete).toBe(false);
  });

  it('marks a track complete when every required module is passed', () => {
    const prog = [
      { module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' },
      { module_id: 'm2', status: 'passed', score: 85, passed_at: 'y' },
    ];
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.complete).toBe(true);
    expect(t1.pct).toBe(100);
  });

  it('nextModuleId is the lowest-idx unpassed module, optional ones included', () => {
    const prog = [{ module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' }];
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.nextModuleId).toBe('m2');
  });

  it('still points at a leftover optional module once the required ones are done', () => {
    const prog = [
      { module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' },
      { module_id: 'm2', status: 'passed', score: 85, passed_at: 'y' },
    ];
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.nextModuleId).toBe('m3');
  });

  it('has no next module once every module in the track is passed', () => {
    const prog = ['m1', 'm2', 'm3'].map((id) => ({ module_id: id, status: 'passed', score: 90, passed_at: 'x' }));
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.nextModuleId).toBeNull();
  });

  it('flags an assignment past its due date as overdue', () => {
    const assign = [{ track_id: 't1', due_at: '2026-08-10T00:00:00Z', completed_at: null }];
    const t1 = buildTrackViews(tracks, tms, [], assign, NOW).find((t) => t.id === 't1')!;
    expect(t1.assigned).toBe(true);
    expect(t1.overdue).toBe(true);
  });

  it('never marks a completed assignment overdue', () => {
    const assign = [{ track_id: 't1', due_at: '2026-08-10T00:00:00Z', completed_at: '2026-08-09T00:00:00Z' }];
    expect(buildTrackViews(tracks, tms, [], assign, NOW).find((t) => t.id === 't1')!.overdue).toBe(false);
  });

  it('an assignment with no due date is never overdue', () => {
    const assign = [{ track_id: 't1', due_at: null, completed_at: null }];
    const t1 = buildTrackViews(tracks, tms, [], assign, NOW).find((t) => t.id === 't1')!;
    expect(t1.assigned).toBe(true);
    expect(t1.overdue).toBe(false);
  });

  it('returns tracks in order_idx order', () => {
    expect(buildTrackViews(tracks, tms, [], [], NOW).map((t) => t.slug))
      .toEqual(['zillow-day1', 'fundamentals']);
  });

  it('treats an empty track as 0% and not complete', () => {
    const t = buildTrackViews([tracks[0]], [], [], [], NOW)[0];
    expect(t.pct).toBe(0);
    expect(t.complete).toBe(false);
  });

  it('ignores progress on a module that is not in the track', () => {
    const prog = [{ module_id: 'm9', status: 'passed', score: 90, passed_at: 'x' }];
    const t1 = buildTrackViews(tracks, tms, prog, [], NOW).find((t) => t.id === 't1')!;
    expect(t1.passed).toBe(0);
  });
});

describe('isModuleLocked', () => {
  it('leaves the first module open', () => {
    expect(isModuleLocked(tms, [], 't1', 'm1')).toBe(false);
  });
  it('locks a module whose required predecessor is unpassed', () => {
    expect(isModuleLocked(tms, [], 't1', 'm2')).toBe(true);
  });
  it('unlocks once the predecessor passes', () => {
    const prog = [{ module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' }];
    expect(isModuleLocked(tms, prog, 't1', 'm2')).toBe(false);
  });
  it('does not let an OPTIONAL predecessor block anything', () => {
    const prog = [
      { module_id: 'm1', status: 'passed', score: 90, passed_at: 'x' },
      { module_id: 'm2', status: 'passed', score: 90, passed_at: 'y' },
    ];
    expect(isModuleLocked(tms, prog, 't1', 'm3')).toBe(false);
  });
  it('treats a module outside the track as unlocked', () => {
    expect(isModuleLocked(tms, [], 't1', 'nope')).toBe(false);
  });
});

describe('searchModules', () => {
  const mods = [
    { id: 'm1', title: 'Speed to Lead', summary: 'first five minutes', tags: ['speed'], level: 'core' },
    { id: 'm2', title: 'The ALMS Call Framework', summary: null, tags: ['call', 'scripts'], level: 'core' },
  ];
  it('matches on title, case-insensitively', () => {
    expect(searchModules(mods, 'alms').map((m) => m.id)).toEqual(['m2']);
  });
  it('matches on a tag', () => {
    expect(searchModules(mods, 'scripts').map((m) => m.id)).toEqual(['m2']);
  });
  it('matches on the summary', () => {
    expect(searchModules(mods, 'five minutes').map((m) => m.id)).toEqual(['m1']);
  });
  it('returns everything for an empty query', () => {
    expect(searchModules(mods, '   ')).toHaveLength(2);
  });
  it('returns nothing when nothing matches', () => {
    expect(searchModules(mods, 'zzz')).toHaveLength(0);
  });
});
