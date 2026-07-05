import { useEffect, useState } from 'react';
import { adminConnections, adminConnectFub, type AdminConnection } from '../lib/api';

// Platform-owner board: every team's Follow Up Boss status in one place, with a
// paste-a-key field per team so the admin can connect/rotate a key on a team's
// behalf — no impersonation. The same team_secrets store powers every TRU product.
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
};

function TeamRow({ c, onDone }: { c: AdminConnection; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function connect() {
    const k = key.trim();
    if (!k || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await adminConnectFub(c.teamId, k);
      setKey('');
      setMsg({ ok: true, text: `Connected${r.subdomain ? ` to ${r.subdomain}.followupboss.com` : ''} — syncing now.` });
      setTimeout(onDone, 4000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not connect.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
      <div className="connrow" style={{ marginBottom: 8 }}>
        <span className={`conndot ${c.connected ? 'on' : 'off'}`} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name} <span className="muted small" style={{ fontWeight: 500 }}>· {c.orgName}</span></div>
          <div className="muted small">
            {c.connected
              ? <>Connected{c.subdomain ? ` · ${c.subdomain}.followupboss.com` : ''} · last sync {ago(c.lastSync)}</>
              : 'Not connected — paste this team’s API key'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={c.connected ? 'Paste a new API key to re-key' : 'Paste this team’s Follow Up Boss API key'}
          autoComplete="off"
          style={{ flex: 1, minWidth: 240, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13.5, background: '#fff', color: 'var(--ink)' }}
        />
        <button className="btn" onClick={connect} disabled={!key.trim() || busy}>{busy ? 'Connecting…' : c.connected ? 'Re-key' : 'Connect & sync'}</button>
      </div>
      {msg && <div className={msg.ok ? 'ok' : 'err'} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}

export function AdminConnections() {
  const [conns, setConns] = useState<AdminConnection[] | null>(null);
  const load = () => { void adminConnections().then(setConns); };
  useEffect(() => { load(); }, []);
  if (conns === null) return <div className="muted small">Loading team connections…</div>;
  if (!conns.length) return <div className="muted small">No teams yet.</div>;
  return (
    <div>
      {conns.map((c) => <TeamRow key={c.teamId} c={c} onDone={load} />)}
    </div>
  );
}
