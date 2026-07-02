import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TruLogo } from '../components/TruLogo';
import {
  runCircle, runListing, loadProspectQueue, logProspectDisposition,
  type CircleSummary, type ProspectQueueItem,
} from '../lib/api';

// TRU palette (fallbacks so the page renders even if a token is missing).
const INK = '#33281a', GOLD = '#a9791f', GREEN = '#2e8b57', RED = '#c0492f', BLUE = '#2f6bb0', MUTE = '#8a7a63';

// A default subject location (Seattle) — until a geocoder is wired, the stubbed
// providers use the center to seed a deterministic neighbor set.
const DEMO_CENTER = { latitude: 47.6205, longitude: -122.3493 };

type Channel = 'circle' | 'expired' | 'fsbo';
const CHANNELS: Array<{ key: Channel; label: string; color: string; eyebrow: string; title: string; blurb: string; inputLabel: string; placeholder: string; dnc: string }> = [
  {
    key: 'circle', label: 'Circle', color: RED,
    eyebrow: 'Agent-assist outbound', title: 'Circle Prospecting',
    blurb: 'Drop a just-sold or just-listed home. TRU pulls the neighbors, skip-traces them, scrubs DNC, and hands you a compliance-cleared call list — prioritized by equity.',
    inputLabel: 'Subject property (just sold / just listed)', placeholder: '123 Maple St — SOLD $625k, 4 offers',
    dnc: 'DNC-listed neighbors are held back (circle default = block); litigators are always suppressed.',
  },
  {
    key: 'expired', label: 'Expired', color: GOLD,
    eyebrow: 'Agent-assist outbound', title: 'Expired Listings',
    blurb: "Pull today's expired & withdrawn listings. TRU skip-traces the owners, scrubs DNC, and builds a compliance-cleared list with an empathetic, do-it-differently opener per lead.",
    inputLabel: 'Campaign note (optional)', placeholder: 'This morning’s expireds — 90210 farm',
    dnc: 'DNC-listed numbers route to manual-dial-only (with acknowledgment); litigators are always suppressed.',
  },
  {
    key: 'fsbo', label: 'FSBO', color: GREEN,
    eyebrow: 'Agent-assist outbound', title: 'For Sale By Owner',
    blurb: "Pull today's FSBO listings. TRU skip-traces the owners, scrubs DNC, and builds a value-first call list — a buyer or a free pricing check, never a hard listing pitch.",
    inputLabel: 'Campaign note (optional)', placeholder: 'FSBOs within 3 miles',
    dnc: 'DNC-listed numbers route to manual-dial-only (with acknowledgment); litigators are always suppressed.',
  },
];

const STATE_STYLE: Record<string, { label: string; color: string }> = {
  queued: { label: 'Ready to dial', color: GREEN },
  manual: { label: 'Manual-dial only', color: GOLD },
  gate_blocked: { label: 'Blocked', color: RED },
  suppressed: { label: 'Suppressed', color: MUTE },
  completed: { label: 'Done', color: MUTE },
  calling: { label: 'Calling', color: BLUE },
  failed: { label: 'Failed', color: RED },
};

const DISPOSITIONS: Array<{ outcome: string; label: string }> = [
  { outcome: 'appointment', label: 'Appt set' },
  { outcome: 'contact_interested', label: 'Interested' },
  { outcome: 'contact_not_ready', label: 'Not ready' },
  { outcome: 'no_answer', label: 'No answer' },
  { outcome: 'bad_number', label: 'Bad #' },
  { outcome: 'opt_out', label: 'Opt out' },
];

function Badge({ state }: { state: string }) {
  const s = STATE_STYLE[state] ?? { label: state, color: MUTE };
  return (
    <span style={{
      background: s.color + '1a', color: s.color, borderRadius: 999, padding: '3px 10px',
      fontSize: 11, fontWeight: 800, letterSpacing: '.3px', whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

export default function Prospect({ org, onHome }: { org: { id: string; name: string }; onHome: () => void }) {
  const [channel, setChannel] = useState<Channel>('circle');
  const meta = CHANNELS.find((c) => c.key === channel)!;
  const [subject, setSubject] = useState('');
  const [count, setCount] = useState(12);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [summary, setSummary] = useState<CircleSummary | null>(null);
  const [stubbed, setStubbed] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [queue, setQueue] = useState<ProspectQueueItem[]>([]);
  const [loadingQ, setLoadingQ] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Rows the agent has tapped "Call" on — surfaces the disposition buttons.
  // tel: opens the device's own dialer; nothing here places a call automatically.
  const [dialed, setDialed] = useState<Set<string>>(new Set());

  async function refreshQueue(cid: string) {
    setLoadingQ(true);
    setDialed(new Set());
    try { setQueue(await loadProspectQueue(cid)); } catch (e) { setErr(String(e)); }
    setLoadingQ(false);
  }

  async function run() {
    if (running) return;
    setRunning(true); setErr('');
    try {
      const r = channel === 'circle'
        ? await runCircle(DEMO_CENTER, { name: subject || 'Circle campaign', limit: count })
        : await runListing(channel, { name: subject || undefined, limit: count });
      setSummary(r.summary); setStubbed(!r.providersLive); setCampaignId(r.campaignId);
      await refreshQueue(r.campaignId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setRunning(false);
  }

  function switchChannel(c: Channel) {
    setChannel(c); setSummary(null); setQueue([]); setCampaignId(null); setErr(''); setSubject('');
  }

  async function disposition(item: ProspectQueueItem, outcome: string) {
    setBusy(item.id);
    try {
      await logProspectDisposition(item.id, outcome);
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, state: outcome === 'opt_out' ? 'suppressed' : 'completed' } : x)));
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  useEffect(() => { if (campaignId) void refreshQueue(campaignId); /* eslint-disable-next-line */ }, []);

  const dialable = queue.filter((q) => q.state === 'queued' || q.state === 'manual');
  const held = queue.filter((q) => q.state === 'gate_blocked' || q.state === 'suppressed');

  return (
    <div className="hq" style={{ minHeight: '100vh', background: 'var(--bg, #fbf7f0)' }}>
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="link small" onClick={onHome}>← HQ</button>
          <TruLogo size={26} wordSize={19} sub="Prospect" />
        </div>
        <div className="topbar-right">
          <span className="muted small">{org.name}</span>
          <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main className="hq-main" style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px 60px' }}>
        {/* Channel selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {CHANNELS.map((c) => {
            const on = c.key === channel;
            return (
              <button
                key={c.key}
                onClick={() => switchChannel(c.key)}
                style={{
                  border: `1px solid ${on ? c.color : 'var(--line,#e6dac6)'}`,
                  background: on ? c.color + '14' : 'var(--card,#fff)',
                  color: on ? c.color : INK, borderRadius: 10, padding: '8px 16px',
                  fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
                }}
              >{c.label}</button>
            );
          })}
        </div>

        <div className="hq-hero fu" style={{ marginBottom: 18 }}>
          <div className="eyebrow" style={{ color: meta.color }}>{meta.eyebrow}</div>
          <h1 style={{ margin: '4px 0' }}>{meta.title}</h1>
          <p style={{ color: MUTE }}>{meta.blurb} You dial; nothing here calls anyone automatically.</p>
        </div>

        {/* Compliance posture */}
        <div style={{
          border: `1px solid ${meta.color}55`, background: meta.color + '12', borderRadius: 12,
          padding: '10px 14px', fontSize: 12.5, color: INK, marginBottom: 18,
        }}>
          <strong>Compliance built in.</strong> Every number is scrubbed against DNC + litigator lists and
          checked for the recipient’s local calling hours before it reaches your list. {meta.dnc} Opt-outs are
          permanent and cross-channel.
        </div>

        {/* Run */}
        <div className="hq-card fu" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>{channel === 'circle' ? 'Start a circle' : channel === 'expired' ? 'Pull expireds' : 'Pull FSBOs'}</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: 1, minWidth: 240, fontSize: 12.5, color: MUTE }}>
              {meta.inputLabel}
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={meta.placeholder}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', border: '1px solid var(--line, #e6dac6)', borderRadius: 10, fontSize: 14 }}
              />
            </label>
            <label style={{ fontSize: 12.5, color: MUTE }}>
              {channel === 'circle' ? 'Neighbors' : 'Leads'}
              <input
                type="number" min={1} max={50} value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 12)))}
                style={{ display: 'block', width: 90, marginTop: 4, padding: '10px 12px', border: '1px solid var(--line, #e6dac6)', borderRadius: 10, fontSize: 14 }}
              />
            </label>
            <button className="btn" onClick={run} disabled={running}>{running ? 'Building list…' : `Run ${meta.label} →`}</button>
          </div>
          {stubbed && (
            <div className="muted small" style={{ marginTop: 10 }}>
              ⚙️ Demo data — {channel === 'circle' ? 'neighbor lookup' : `${meta.label} feed`}, skip trace, and DNC scrub are stubbed until provider keys are added.
            </div>
          )}
          {err && <div className="err" style={{ marginTop: 10, color: RED }}>{err}</div>}
        </div>

        {/* Summary */}
        {summary && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
            {[
              [channel === 'circle' ? 'Neighbors' : 'Leads', summary.neighbors, INK],
              ['Ready', summary.queued, GREEN],
              ['Manual', summary.manual, GOLD],
              ['Held (DNC/hours)', summary.blocked, RED],
              ['Suppressed', summary.suppressed, MUTE],
              ['No phone', summary.uncallable, MUTE],
            ].map(([label, n, c]) => (
              <div key={label as string} style={{ flex: 1, minWidth: 110, background: 'var(--card,#fff)', border: '1px solid var(--line,#e6dac6)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c as string }}>{n as number}</div>
                <div className="muted small">{label as string}</div>
              </div>
            ))}
          </div>
        )}

        {/* The call list */}
        {loadingQ && <div className="center-wrap"><div className="spinner" /></div>}
        {!loadingQ && dialable.length > 0 && (
          <>
            <h3 style={{ margin: '4px 0 10px' }}>Your call list <span className="muted small">({dialable.length})</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dialable.map((item) => (
                <div key={item.id} style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#e6dac6)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: INK }}>{item.person?.full_name ?? 'Lead'}</div>
                      <div className="muted small">{item.phone_e164 ?? '—'}{item.person?.timezone ? ` · ${item.person.timezone.split('/')[1]?.replace('_', ' ')}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge state={item.state} />
                      {item.phone_e164 && (
                        // Opens the device's own phone app with the number pre-filled —
                        // the agent dials by hand (mobile: native dialer; desktop: only if
                        // a calling app is registered as the tel: handler).
                        <a
                          href={`tel:${item.phone_e164}`}
                          onClick={() => setDialed((s) => new Set(s).add(item.id))}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
                            background: GREEN, color: '#fff', borderRadius: 8, padding: '6px 12px',
                            fontSize: 12.5, fontWeight: 800,
                          }}
                        >📞 Call</a>
                      )}
                    </div>
                  </div>
                  {item.dossier?.opener && (
                    <div style={{ marginTop: 8, fontSize: 13, color: INK, background: BLUE + '0e', borderRadius: 8, padding: '8px 10px' }}>
                      💬 {item.dossier.opener}
                    </div>
                  )}
                  {item.state === 'manual' && (
                    <div className="small" style={{ marginTop: 8, color: GOLD }}>
                      ⚠️ On a DNC list — hand-dial only, and acknowledge before you call. No power dialer.
                    </div>
                  )}
                  {dialed.has(item.id) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {DISPOSITIONS.map((d) => (
                        <button
                          key={d.outcome}
                          onClick={() => disposition(item, d.outcome)}
                          disabled={busy === item.id}
                          style={{
                            border: `1px solid ${d.outcome === 'opt_out' ? RED : 'var(--line,#e6dac6)'}`,
                            background: d.outcome === 'appointment' ? GREEN + '14' : 'transparent',
                            color: d.outcome === 'opt_out' ? RED : INK,
                            borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          }}
                        >{d.label}</button>
                      ))}
                    </div>
                  )}
                  {!dialed.has(item.id) && (
                    <div className="muted small" style={{ marginTop: 10 }}>Tap Call, then log what happened.</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Held / suppressed — visible for transparency, not dialable */}
        {!loadingQ && held.length > 0 && (
          <>
            <h3 style={{ margin: '22px 0 10px' }} className="muted">Held by the compliance gate <span className="small">({held.length})</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {held.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'var(--card,#fff)', border: '1px dashed var(--line,#e6dac6)', borderRadius: 10, padding: '8px 12px' }}>
                  <div className="small">
                    <span style={{ color: INK, fontWeight: 600 }}>{item.person?.full_name ?? 'Lead'}</span>
                    <span className="muted"> · {item.last_gate_decision?.reason ?? 'held'}</span>
                  </div>
                  <Badge state={item.state} />
                </div>
              ))}
            </div>
          </>
        )}

        {summary && dialable.length === 0 && held.length === 0 && !loadingQ && (
          <div className="muted" style={{ textAlign: 'center', padding: 30 }}>No callable leads in this run.</div>
        )}
      </main>
    </div>
  );
}
