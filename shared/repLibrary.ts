// Pure derivations for the Rep library shelf. No I/O, no React, no Worker types —
// so the Worker, the browser and the tests all agree on one definition of
// "how far along is this learner", and it can be tested under the node-env
// vitest config (web/vitest.config.ts includes ../shared/**/*.test.ts).

export type TrackRow = {
  id: string; slug: string; title: string;
  subtitle: string | null; cover: string | null; order_idx: number;
};
export type TrackModuleRow = { track_id: string; module_id: string; idx: number; required: boolean };
export type ProgressRow = { module_id: string; status: string; score: number | null; passed_at: string | null };
export type AssignmentRow = { track_id: string; due_at: string | null; completed_at: string | null };
export type ModuleRow = {
  id: string; title: string; summary: string | null;
  tags?: string[] | null; level?: string | null;
};

export type TrackView = {
  id: string; slug: string; title: string; subtitle: string | null; cover: string | null;
  total: number; passed: number; pct: number; complete: boolean;
  nextModuleId: string | null;
  assigned: boolean; dueAt: string | null; overdue: boolean;
};

const passedIds = (progress: ProgressRow[]) =>
  new Set(progress.filter((p) => p.status === 'passed').map((p) => p.module_id));

export function buildTrackViews(
  tracks: TrackRow[],
  trackModules: TrackModuleRow[],
  progress: ProgressRow[],
  assignments: AssignmentRow[],
  now: Date,
): TrackView[] {
  const done = passedIds(progress);
  const byTrack = new Map<string, TrackModuleRow[]>();
  for (const tm of trackModules) {
    const list = byTrack.get(tm.track_id) ?? [];
    list.push(tm);
    byTrack.set(tm.track_id, list);
  }

  return [...tracks]
    .sort((a, b) => a.order_idx - b.order_idx || a.title.localeCompare(b.title))
    .map((t) => {
      const rows = (byTrack.get(t.id) ?? []).slice().sort((a, b) => a.idx - b.idx);
      const required = rows.filter((r) => r.required);
      const passed = required.filter((r) => done.has(r.module_id)).length;
      const total = required.length;
      // Completion is measured on REQUIRED modules only; "next" walks every
      // module in order, so an optional one still shows up as the next thing to do.
      const complete = total > 0 && passed === total;
      const next = rows.find((r) => !done.has(r.module_id));
      const a = assignments.find((x) => x.track_id === t.id) ?? null;
      const overdue = !!(a && a.due_at && !a.completed_at && new Date(a.due_at) < now);
      return {
        id: t.id, slug: t.slug, title: t.title, subtitle: t.subtitle, cover: t.cover,
        total, passed,
        pct: total ? Math.round((passed / total) * 100) : 0,
        complete,
        nextModuleId: next?.module_id ?? null,
        assigned: !!a, dueAt: a?.due_at ?? null, overdue,
      };
    });
}

/** A module is locked while any REQUIRED module earlier in its track is unpassed. */
export function isModuleLocked(
  trackModules: TrackModuleRow[],
  progress: ProgressRow[],
  trackId: string,
  moduleId: string,
): boolean {
  const done = passedIds(progress);
  const rows = trackModules.filter((t) => t.track_id === trackId).sort((a, b) => a.idx - b.idx);
  const me = rows.find((r) => r.module_id === moduleId);
  if (!me) return false;
  return rows.some((r) => r.required && r.idx < me.idx && !done.has(r.module_id));
}

/** Title / summary / tag / level search. Empty or whitespace query returns everything. */
export function searchModules<T extends ModuleRow>(modules: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return modules;
  return modules.filter((m) =>
    m.title.toLowerCase().includes(needle) ||
    (m.summary ?? '').toLowerCase().includes(needle) ||
    (m.level ?? '').toLowerCase().includes(needle) ||
    (m.tags ?? []).some((t) => t.toLowerCase().includes(needle)));
}
