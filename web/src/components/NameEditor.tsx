import { useEffect, useRef, useState } from 'react';
import { saveDisplayName } from '../lib/api';
import { validateDisplayName } from '../../../shared/displayName';
import './nameEditor.css';

export default function NameEditor({ agentId, name, onSaved, onDirtyChange }: {
  agentId: string; name: string; onSaved: (name: string) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  useEffect(() => { onDirtyChange?.(busy || (editing && draft !== name)); return () => onDirtyChange?.(false); }, [busy, editing, draft, name, onDirtyChange]);
  async function save() {
    if (saving.current) return;
    setError('');
    let value: string;
    try { value = validateDisplayName(draft); } catch (e) { setError((e as Error).message); return; }
    saving.current = true; setBusy(true);
    try {
      const result = await saveDisplayName(agentId, value);
      onSaved(result); setDraft(result); setEditing(false); setSaved(true);
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (e) { setError(e instanceof Error ? e.message : 'Your name could not be saved.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="name-editor">
    {!editing ? <><button ref={trigger} className="name-edit-link" onClick={() => { setDraft(name); setEditing(true); setError(''); setSaved(false); }} aria-label={`Edit name for ${name}`}>Edit name</button>{saved && <span role="status">Name saved</span>}</> :
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>Name<input autoFocus autoComplete="name" maxLength={120} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} /></label>
        <p>This name appears in your TRU profile and team roster. Your email and Follow Up Boss connection stay the same.</p>
        {error && <p role="alert">{error}</p>}
        <div className="name-editor-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save name'}</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); requestAnimationFrame(() => trigger.current?.focus()); }}>Cancel</button></div>
      </form>}
  </div>;
}
