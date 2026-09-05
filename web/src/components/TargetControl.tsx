import { useEffect, useState } from 'react';
import { onAuthChange } from '../lib/auth';
import { isDemo } from '../lib/api';

export function validTarget(value: number) { return Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 10000; }
export function targetKey(user: string, org: string, kind: string) { return `tru:target:v1:${encodeURIComponent(user)}:${encodeURIComponent(org)}:${kind}`; }

/** Browser-local preference, isolated by signed-in user, organization and metric. */
export function useSavedTarget(orgId: string, kind: string, initial: number) {
  const [state, setState] = useState({ org: '', key: '', value: initial, saved: initial, notice: '' });
  useEffect(() => {
    const read = (user: string | null) => {
      const key = user ? targetKey(user, orgId, kind) : '';
      let value = initial;
      try { const raw = key ? localStorage.getItem(key) : null; if (raw !== null && validTarget(Number(raw))) value = Number(raw); } catch { /* Save reports storage failures. */ }
      setState({ org: orgId, key, value, saved: value, notice: '' });
    };
    if (isDemo) { read('demo'); return; }
    return onAuthChange(session => read(session?.user.id ?? null));
  }, [orgId, kind, initial]);
  const ready = state.org === orgId && !!state.key;
  return {
    value: state.org === orgId ? state.value : initial,
    saved: state.org === orgId ? state.saved : initial,
    ready,
    notice: state.notice,
    setValue: (value: number) => setState(s => ({ ...s, value, notice: '' })),
    save: () => {
      if (!ready || !validTarget(state.value)) return;
      try { localStorage.setItem(state.key, String(state.value)); setState(s => ({ ...s, saved: s.value, notice: 'Saved on this browser' })); }
      catch { setState(s => ({ ...s, notice: 'Could not save. Browser storage is unavailable.' })); }
    },
  };
}

export function TargetControl({ target, label, defaultValue }: { target: ReturnType<typeof useSavedTarget>; label: string; defaultValue: number }) {
  const [draft, setDraft] = useState(String(target.value));
  useEffect(() => setDraft(String(target.value)), [target.value]);
  return <div className="target-control">
    <label>{label}<input type="number" min={1} max={10000} step={1} value={draft} onChange={e => { setDraft(e.target.value); if (validTarget(e.target.valueAsNumber)) target.setValue(e.target.valueAsNumber); }} /></label>
    <button onClick={target.save} disabled={!target.ready || !validTarget(Number(draft))}>Save target</button>
    <button className="target-reset" onClick={() => target.setValue(defaultValue)}>Default ({defaultValue})</button>
    <span role="status">{target.notice || (target.value !== target.saved ? 'Unsaved change' : 'Saved for this account and team on this browser')}</span>
  </div>;
}
