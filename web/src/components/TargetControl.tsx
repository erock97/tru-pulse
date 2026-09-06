import { useEffect, useState } from 'react';
import { onAuthChange } from '../lib/auth';
import { isDemo, workerFetch } from '../lib/api';

export function validTarget(value: number) { return Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 10000; }
export function targetKey(user: string, org: string, kind: string) { return `tru:target:v1:${encodeURIComponent(user)}:${encodeURIComponent(org)}:${kind}`; }

/** Account preference, isolated by signed-in user, organization and metric. */
export function useSavedTarget(orgId: string, kind: string, initial: number) {
  const [state, setState] = useState({ org: '', key: '', value: initial, saved: initial, notice: '' });
  const [saving,setSaving]=useState(false);
  useEffect(() => {
    let active=true, generation=0;
    const read = async (user: string | null) => {
      const token=++generation;
      const key = user ? targetKey(user, orgId, kind) : '';
      let value = initial;
      try { const raw = key ? localStorage.getItem(key) : null; if (raw !== null && validTarget(Number(raw))) value = Number(raw); } catch { /* Save reports storage failures. */ }
      if(!isDemo && user){
        try{
          const response=await workerFetch(`/data/preferences?orgId=${encodeURIComponent(orgId)}&kind=${encodeURIComponent(kind)}`);
          if(!response.ok)throw Error('load failed');
          const data=await response.json() as {value:number|null};
          value=data.value!==null&&validTarget(data.value)?data.value:initial;
        }catch{if(active&&token===generation)setState({org:orgId,key:'',value:initial,saved:initial,notice:'Saved preference could not be loaded. Refresh before editing.'});return;}
      }
      if(active&&token===generation)setState({ org: orgId, key, value, saved: value, notice: '' });
    };
    if (isDemo) { void read('demo'); return ()=>{active=false;}; }
    const unsubscribe=onAuthChange(session => {void read(session?.user.id ?? null);});
    return ()=>{active=false;unsubscribe();};
  }, [orgId, kind, initial]);
  const ready = state.org === orgId && !!state.key;
  return {
    value: state.org === orgId ? state.value : initial,
    saved: state.org === orgId ? state.saved : initial,
    ready:ready&&!saving,
    notice: state.notice,
    setValue: (value: number) => setState(s => ({ ...s, value, notice: '' })),
    save: async () => {
      if (!ready || !validTarget(state.value)) return;
      const value=state.value,key=state.key;setSaving(true);
      try {
        if(isDemo)localStorage.setItem(key,String(value));
        else{const response=await workerFetch(`/data/preferences?orgId=${encodeURIComponent(orgId)}&kind=${encodeURIComponent(kind)}`,{method:'PUT',body:JSON.stringify({value})});if(!response.ok)throw Error('save failed');}
        setState(s=>s.key===key?({...s,saved:value,notice:isDemo?'Saved in this preview browser':'Saved to your account for this team'}):s);
      }catch{setState(s=>s.key===key?({...s,notice:'Could not save. Your saved threshold has not changed.'}):s);}
      finally{setSaving(false);}
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
    <span role="status">{target.notice || (target.value !== target.saved ? 'Unsaved change' : isDemo?'Preview browser preference':'Account preference · this team')}</span>
  </div>;
}
