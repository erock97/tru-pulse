// The learner's shelf: what's assigned, what's earned, what's available.
//
// Every derived number here — track %, next module, locked — comes from
// shared/repLibrary.ts, the same pure functions the Worker uses to build the
// response. Nothing on this screen recomputes progress a second, slightly
// different way.
//
// Per Eric's standing preference the screen changes only when the learner changes
// it: no self-collapsing sections, no auto-reordering, nothing that closes itself
// after a pass. Expanding a track is sticky until they collapse it themselves.
import { useMemo, useState, type ReactNode } from 'react';
import { isModuleLocked, searchModules } from '../../../shared/repLibrary.js';
import type { LibraryData, CourseModule } from '../lib/api';

const ACCENTS = ['#e0a340', '#4f8fd6', '#3fa06c', '#d9694c'];
const accentOf = (idx: number) => ACCENTS[(Math.max(idx, 1) - 1) % ACCENTS.length];

/** Honest time estimate: the authored duration when set, otherwise from the shape. */
function minutesFor(m: CourseModule | undefined, authored: number | null): number {
  if (authored && authored > 0) return authored;
  if (!m) return 5;
  return Math.max(5, Math.round(m.cards.length * 0.8 + m.qs.length * 0.5));
}

const dueLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function LibraryHome({
  data, mods, onOpen, extras,
}: {
  data: LibraryData;
  /** The full course rows — cards and questions live here, not on the shelf feed. */
  mods: CourseModule[];
  onOpen: (m: CourseModule) => void;
  /** The Live Sim and practice-lab cards, rendered under the shelf. */
  extras?: ReactNode;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');

  const byId = useMemo(() => new Map(mods.map((m) => [m.id, m])), [mods]);
  const metaById = useMemo(() => new Map(data.modules.map((m) => [m.id, m])), [data.modules]);
  const certIds = useMemo(
    () => new Set(data.certificates.map((c) => c.track_id)), [data.certificates]);

  // A learner whose org has no tracks yet still gets a working library: every
  // published module, as one shelf. Removing this would blank the course for any
  // org that hasn't been seeded, which is worse than an unnamed shelf.
  const tracks = data.tracks;
  const ungrouped = tracks.length === 0;

  const assigned = tracks.filter((t) => t.assigned);
  const searching = q.trim().length > 0;
  const hits = useMemo(
    () => (searching ? searchModules(data.modules, q) : []), [searching, data.modules, q]);

  const openById = (id: string) => {
    const m = byId.get(id);
    if (m) onOpen(m);
  };

  const moduleRow = (
    moduleId: string, trackId: string | null, i: number, locked: boolean, blocker: string | null,
  ) => {
    const m = byId.get(moduleId);
    const meta = metaById.get(moduleId);
    if (!m && !meta) return null;
    const title = m?.title ?? meta?.title ?? 'Module';
    const done = m?.status === 'passed';
    const idx = m?.idx ?? meta?.idx ?? i + 1;
    const mins = minutesFor(m, meta?.duration_min ?? null);
    const playable = !!m && ((m.cards?.length ?? 0) > 0 || m.qs.length > 0);
    return (
      <button
        key={`${trackId ?? 'all'}:${moduleId}`}
        className={`ac-modcard fu${done ? ' done' : ''}${locked ? ' lib-locked' : ''}`}
        style={{ ['--mac' as string]: accentOf(idx), animationDelay: `${0.05 * i}s` }}
        onClick={() => { if (!locked) openById(moduleId); }}
        disabled={locked || !playable}
      >
        <span className="ac-modbar" />
        <span className={`ac-modnum${done ? ' done' : ''}`}>{locked ? '🔒' : done ? '✓' : idx}</span>
        <span className="ac-modmeta">
          <span className="ac-modtitle">{title}</span>
          <span className="ac-modsub">
            {locked
              ? blocker ? `Finish ${blocker} first.` : 'Finish the module before this one first.'
              : done
                ? `Passed · ${m?.score != null ? `${m.score}%` : 'Done'}`
                : `≈ ${mins} min${m ? ` · ${m.cards.length} screens` : ''}${m && m.qs.length ? ` · ${m.qs.length}-question quiz` : ''}`}
          </span>
        </span>
        <span className="ac-modgo">{locked ? '' : done ? 'Review' : '›'}</span>
      </button>
    );
  };

  return (
    <>
      {assigned.length > 0 && (
        <section className="lib-sec fu">
          <h2 className="lib-h">Assigned to you</h2>
          <div className="lib-cards">
            {assigned.map((t) => (
              <div key={t.id} className={`lib-assign${t.overdue ? ' overdue' : ''}`}>
                <div className="lib-assign-top">
                  <span className="lib-assign-title">{t.title}</span>
                  {t.dueAt && (
                    <span className={`lib-chip${t.overdue ? ' lib-chip-late' : ''}`}>
                      {t.overdue ? 'Overdue · ' : 'Due '}{dueLabel(t.dueAt)}
                    </span>
                  )}
                </div>
                <div className="lib-bar"><span style={{ width: `${t.pct}%` }} /></div>
                <div className="lib-assign-sub">
                  {t.passed}/{t.total} done
                  {t.complete
                    ? ' · complete'
                    : t.nextModuleId
                      ? <> · next: <button className="link small" onClick={() => openById(t.nextModuleId!)}>
                          {byId.get(t.nextModuleId)?.title ?? metaById.get(t.nextModuleId)?.title ?? 'continue'}
                        </button></>
                      : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.certificates.length > 0 && (
        <section className="lib-sec fu">
          <h2 className="lib-h">Earned</h2>
          <div className="lib-cards">
            {data.certificates.map((c) => {
              const t = tracks.find((x) => x.id === c.track_id);
              return (
                <div key={c.track_id} className="lib-badge">
                  <span className="lib-badge-seal">🏆</span>
                  <span className="lib-badge-title">{t?.title ?? 'Track complete'}</span>
                  <span className="lib-badge-date">
                    {new Date(c.issued_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="lib-sec fu">
        <div className="lib-hrow">
          <h2 className="lib-h">{ungrouped ? 'Your modules' : 'The library'}</h2>
          <input
            className="lib-search"
            placeholder="Search modules…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {searching ? (
          <div className="ac-modlist">
            {hits.length === 0 && <p className="lib-empty">Nothing matches “{q.trim()}”.</p>}
            {hits.map((h, i) => moduleRow(h.id, null, i, false, null))}
          </div>
        ) : ungrouped ? (
          <div className="ac-modlist">
            {mods.map((m, i) => moduleRow(m.id, null, i, false, null))}
          </div>
        ) : (
          tracks.map((t) => {
            const rows = data.trackModules
              .filter((tm) => tm.track_id === t.id)
              .slice()
              .sort((a, b) => a.idx - b.idx);
            const isOpen = open[t.id] ?? t.assigned;
            return (
              <div key={t.id} className="lib-track">
                <button
                  className="lib-track-head"
                  onClick={() => setOpen((s) => ({ ...s, [t.id]: !(s[t.id] ?? t.assigned) }))}
                >
                  <span className="lib-track-title">
                    {t.title}
                    {/* Display only — nothing here is locked. It tells an agent
                        which training matters before they take leads. */}
                    {t.requiredToLaunch && !certIds.has(t.id) && (
                      <span className="lib-chip lib-chip-req">Required to launch</span>
                    )}
                    {certIds.has(t.id) && <span className="lib-chip lib-chip-done">Certified</span>}
                  </span>
                  <span className="lib-track-sub">
                    {t.subtitle ? `${t.subtitle} · ` : ''}{t.passed}/{t.total} done
                  </span>
                  <span className="lib-bar sm"><span style={{ width: `${t.pct}%` }} /></span>
                  <span className="lib-caret">{isOpen ? '⌄' : '›'}</span>
                </button>
                {isOpen && (
                  <div className="ac-modlist">
                    {rows.map((tm, i) => {
                      const locked = isModuleLocked(data.trackModules, data.progress, t.id, tm.module_id);
                      const before = rows
                        .filter((r) => r.required && r.idx < tm.idx)
                        .find((r) => !data.progress.some((p) => p.module_id === r.module_id && p.status === 'passed'));
                      const blocker = before
                        ? byId.get(before.module_id)?.title ?? metaById.get(before.module_id)?.title ?? null
                        : null;
                      return moduleRow(tm.module_id, t.id, i, locked, blocker);
                    })}
                    {rows.length === 0 && <p className="lib-empty">No modules on this track yet.</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {extras}
    </>
  );
}
