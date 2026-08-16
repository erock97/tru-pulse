// Assign a track to learners — the leader half of the shelf.
//
// Mounted ON TOP of the Rep dashboard (same overlay idiom as ModuleManager) so
// closing it never loses the roster's search state underneath. Everything the
// leader picked stays picked until they change it; nothing reorders itself
// after a successful assign.
import { useMemo, useState } from 'react';
import { assignTrack, type RepData, type RepLearner } from '../lib/api';
import { Avatar } from '../components/hqUi';

export default function RepAssign({
  org, data, preselect, onClose, onAssigned,
}: {
  org: { id: string; name: string };
  data: RepData;
  /** Learner id to arrive pre-checked (the roster's per-agent Assign button). */
  preselect?: string | null;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [trackId, setTrackId] = useState(data.tracks[0]?.id ?? '');
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(preselect ? [preselect] : []));
  const [dueAt, setDueAt] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const learners = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.learners.filter((l) =>
      !needle || l.name.toLowerCase().includes(needle) || (l.email ?? '').toLowerCase().includes(needle));
  }, [data.learners, q]);

  const already = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of data.assignments) if (a.track_id === trackId) m.set(a.learner_id, a.due_at ?? '');
    return m;
  }, [data.assignments, trackId]);

  const toggle = (id: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    setErr(''); setDone(''); setBusy(true);
    try {
      const { count } = await assignTrack({
        orgId: org.id, trackId,
        learnerIds: [...picked],
        dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
      });
      setDone(`Assigned to ${count}${dueAt ? ` · due ${new Date(`${dueAt}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`);
      onAssigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not assign this track.');
    } finally {
      setBusy(false);
    }
  };

  const label = (l: RepLearner) => (l.kind === 'member' ? `${l.name} · leader` : l.name);

  return (
    <div className="rp-mgmt-overlay" role="dialog" aria-modal="true" aria-label="Assign a track" onClick={onClose}>
      <div className="rp-mgmt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rp-mgmt-head">
          <div>
            <h3>Assign a track</h3>
            <span className="panel-sub">
              Everyone you pick sees it under <b>Assigned to you</b>. Leaders can be assigned too.
            </span>
          </div>
          <button className="link small" onClick={onClose}>Close</button>
        </div>

        {data.tracks.length === 0 ? (
          <div className="rp-roster-empty">
            No tracks yet. Once the library's tracks are set up they'll be listed here.
          </div>
        ) : (
          <>
            <div className="rp-assign-row">
              <label className="rp-assign-lab">
                Track
                <select className="lib-search" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
                  {data.tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </label>
              <label className="rp-assign-lab">
                Due date <span className="rp-assign-opt">optional</span>
                <input className="lib-search" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </label>
            </div>

            <div className="rp-search" style={{ marginTop: 14 }}>
              <input
                className="rp-search-input"
                placeholder={`Search ${data.learners.length} learner${data.learners.length === 1 ? '' : 's'}…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div className="rp-assign-list">
              {learners.map((l) => {
                const has = already.has(l.id);
                return (
                  <label key={l.id} className={`rp-assign-item${picked.has(l.id) ? ' on' : ''}`}>
                    <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                    <Avatar name={l.name} size={30} tone={0} />
                    <span className="rp-assign-name">{label(l)}</span>
                    {has && <span className="lib-chip">Already assigned</span>}
                  </label>
                );
              })}
              {learners.length === 0 && <div className="rp-roster-empty">No learners match “{q}”.</div>}
            </div>

            {err && <p className="err">{err}</p>}
            {done && <p className="rp-assign-done">{done}</p>}

            <div className="rp-mgmt-foot">
              <button className="btn" disabled={busy || picked.size === 0 || !trackId} onClick={() => void submit()}>
                {busy ? 'Assigning…' : `Assign to ${picked.size}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
