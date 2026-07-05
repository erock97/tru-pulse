import { useEffect, useState } from 'react';
import { loadConnection, connectFub, type Connection } from '../lib/api';

// One shared Follow Up Boss connection panel — status row(s) + key entry — used on
// the HQ home (front door) AND in Pulse settings. ONE key per team powers every TRU
// product, so this is the single place the key is entered anywhere in the suite.
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
};

export function FubConnect() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => { void loadConnection().then(setConns); };
  useEffect(() => { load(); }, []);

  async function doConnect() {
    const k = keyInput.trim();
    if (!k || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await connectFub(k);
      setKeyInput('');
      setMsg({ ok: true, text: `Connected${r.subdomain ? ` to ${r.subdomain}.followupboss.com` : ''} — pulling your data now. It’ll fill in over the next minute.` });
      setTimeout(load, 4000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not connect.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(conns ?? []).map((c) => (
        <div key={c.teamId} className="connrow">
          <span className={`conndot ${c.connected ? 'on' : 'off'}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</div>
            <div className="muted small">
              {c.connected
                ? <>Connected{c.subdomain ? ` · ${c.subdomain}.followupboss.com` : ''} · last sync {ago(c.lastSync)}</>
                : 'Not connected — enter your API key below'}
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Paste your Follow Up Boss API key"
          autoComplete="off"
          style={{ flex: 1, minWidth: 240, padding: '11px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, background: '#fff', color: 'var(--ink)' }}
        />
        <button className="btn" onClick={doConnect} disabled={!keyInput.trim() || busy}>{busy ? 'Connecting…' : 'Connect & sync'}</button>
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>Find it in FUB → Admin → API. Stored encrypted; never shown in the browser.</div>
      {msg && <div className={msg.ok ? 'ok' : 'err'} style={{ marginTop: 10 }}>{msg.text}</div>}
    </>
  );
}
