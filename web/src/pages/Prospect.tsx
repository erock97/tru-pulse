import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { HqShell } from '../components/hqShell';
import { Icon } from '../components/hqUi';
import { useReveal, useCountUp } from '../hqHooks';
import {
  runCircle, runListing, loadProspectQueue, logProspectDisposition,
  type CircleSummary, type ProspectQueueItem,
} from '../lib/api';
import '../truHqDark.css';

/* ============================================================
   PROSPECT — dark shape-diverse reskin (radar + pipeline + list).

   PRESENTATION ONLY. Every row/number flows from the SAME real
   state the previous render used: the channel selector, the
   circle form + Radius (miles) input, runCircle()/runListing(),
   the returned queue (dialable + held rows), the per-row Call
   (tel:) + logProspectDisposition() dispositions, and the
   compliance messaging. No mock data replaces the real queue.
   The radar/pipeline are illustrative shapes; the radar is DRIVEN
   by the real Radius input (bigger radius → more rings/dots).
   ============================================================ */

// A default subject location (Seattle) — until a geocoder is wired, the stubbed
// providers use the center to seed a deterministic neighbor set.
const DEMO_CENTER = { latitude: 47.6205, longitude: -122.3493 };

type Channel = 'circle' | 'expired' | 'fsbo';
const CHANNELS: Array<{ key: Channel; label: string; eyebrow: string; title: string; blurb: string; inputLabel: string; placeholder: string; dnc: string; pull: string }> = [
  {
    key: 'circle', label: 'Circle',
    eyebrow: 'Agent-assist outbound', title: 'Prospect — Circle Prospecting.',
    blurb: 'Drop a just-sold or just-listed home. TRU pulls the neighbors, skip-traces them, scrubs DNC, and hands you a compliance-cleared call list — prioritized by equity.',
    inputLabel: 'Subject property (just sold / just listed)', placeholder: '123 Maple St — SOLD $625k, 4 offers',
    dnc: 'DNC-listed neighbors are held back (circle default = block); litigators are always suppressed.',
    pull: 'Neighbors around a subject property',
  },
  {
    key: 'expired', label: 'Expired',
    eyebrow: 'Agent-assist outbound', title: 'Prospect — Expired Listings.',
    blurb: "Pull today's expired & withdrawn listings. TRU skip-traces the owners, scrubs DNC, and builds a compliance-cleared list with an empathetic, do-it-differently opener per lead.",
    inputLabel: 'Campaign note (optional)', placeholder: 'This morning’s expireds — 90210 farm',
    dnc: 'DNC-listed numbers route to manual-dial-only (with acknowledgment); litigators are always suppressed.',
    pull: 'Recently expired & withdrawn listings',
  },
  {
    key: 'fsbo', label: 'FSBO',
    eyebrow: 'Agent-assist outbound', title: 'Prospect — For Sale By Owner.',
    blurb: "Pull today's FSBO listings. TRU skip-traces the owners, scrubs DNC, and builds a value-first call list — a buyer or a free pricing check, never a hard listing pitch.",
    inputLabel: 'Campaign note (optional)', placeholder: 'FSBOs within 3 miles',
    dnc: 'DNC-listed numbers route to manual-dial-only (with acknowledgment); litigators are always suppressed.',
    pull: 'Active for-sale-by-owner listings',
  },
];

// Per-channel radius: circle is a tight neighbor ring; expired/FSBO are a wider
// farm radius. `density` seeds the pre-run "in radius" estimate; `def` is the
// value we reset to when switching channels.
const RADIUS_CFG: Record<Channel, { min: number; max: number; step: number; def: number; density: number; hint: string }> = {
  circle:  { min: 0.1, max: 5,  step: 0.1, def: 0.5, density: 420, hint: 'Tight ring around the subject home' },
  expired: { min: 1,   max: 25, step: 0.5, def: 5,   density: 14,  hint: 'Farm radius for today’s expireds' },
  fsbo:    { min: 1,   max: 25, step: 0.5, def: 5,   density: 9,   hint: 'Farm radius for today’s FSBOs' },
};

const STATE_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Ready to dial', cls: 'queued' },
  manual: { label: 'Manual-dial only', cls: 'manual' },
  gate_blocked: { label: 'Blocked', cls: 'blocked' },
  suppressed: { label: 'Suppressed', cls: 'suppressed' },
  completed: { label: 'Done', cls: 'completed' },
  calling: { label: 'Calling', cls: 'calling' },
  failed: { label: 'Failed', cls: 'failed' },
};

const DISPOSITIONS: Array<{ outcome: string; label: string; tone?: 'good' | 'bad' }> = [
  { outcome: 'appointment', label: 'Appt set', tone: 'good' },
  { outcome: 'contact_interested', label: 'Interested' },
  { outcome: 'contact_not_ready', label: 'Not ready' },
  { outcome: 'no_answer', label: 'No answer' },
  { outcome: 'bad_number', label: 'Bad #' },
  { outcome: 'opt_out', label: 'Opt out', tone: 'bad' },
];

function Badge({ state }: { state: string }) {
  const s = STATE_LABEL[state] ?? { label: state, cls: 'completed' };
  return <span className={`pr-badge ${s.cls}`}>{s.label}</span>;
}

/* ---- small arrow glyph (Icon has no "arrow"/"check"; inline these) ---- */
function ArrowGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function CheckGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/* ============================================================
   RADAR / SONAR — the focal shape. Concentric rings pulse from a
   center pin (subject property). Household dots scatter inside the
   radius. Ring/dot counts scale with the REAL Radius (miles) input.
   The dots are illustrative; the counts shown come from the real
   run summary once a run returns.
   ============================================================ */
const RADAR = 360, CX = RADAR / 2, CY = RADAR / 2;

function rng(seed: number) {
  let s = (seed * 2654435761) & 0x7fffffff;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
type Dot = { x: number; y: number; r: number; callable: boolean };
function scatter(count: number, maxR: number, suppressedRate: number): Dot[] {
  const r = rng(count * 31 + Math.round(maxR));
  return Array.from({ length: count }, (_, i) => {
    const dist = (0.12 + Math.sqrt(r()) * 0.86) * maxR;
    const ang = r() * Math.PI * 2;
    return { x: CX + Math.cos(ang) * dist, y: CY + Math.sin(ang) * dist, r: 2.4 + r() * 1.8, callable: r() > suppressedRate || i % 5 !== 0 };
  });
}

function Radar({ radius }: { radius: number }) {
  const maxPx = CX - 20;
  const ringPx = Math.min(maxPx, 70 + radius * 150);
  const ringCount = Math.max(3, Math.min(5, Math.round(2 + radius * 3)));
  const rings = Array.from({ length: ringCount }, (_, i) => ringPx * ((i + 1) / ringCount));
  const dotCount = Math.min(72, Math.round(26 + radius * 44));
  const dots = useMemo(() => scatter(dotCount, ringPx - 8, 0.28), [dotCount, ringPx]);
  const callable = dots.filter((d) => d.callable).length;

  return (
    <div className="pr-radar">
      <div className="pr-radar-glow" aria-hidden />
      <svg viewBox={`0 0 ${RADAR} ${RADAR}`} className="pr-radar-svg" role="img" aria-label="Circle-prospecting radar around the subject property">
        <defs>
          <radialGradient id="prRadarField" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--accent-soft)" />
            <stop offset="0.7" stopColor="var(--accent-soft)" />
            <stop offset="1" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="prSweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-hi)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <circle cx={CX} cy={CY} r={ringPx} fill="url(#prRadarField)" />

        <g className="pr-rings">
          {rings.map((r, i) => (
            <circle
              key={i} className="pr-ring" cx={CX} cy={CY} r={r} fill="none" stroke="var(--accent-line)"
              strokeWidth={i === rings.length - 1 ? 1.75 : 1}
              strokeDasharray={i === rings.length - 1 ? '5 6' : 'none'}
              style={{ ['--pulse-delay' as string]: `${i * 0.9}s` }}
            />
          ))}
        </g>

        <line x1={CX - ringPx} y1={CY} x2={CX + ringPx} y2={CY} stroke="var(--border-soft)" strokeWidth="1" />
        <line x1={CX} y1={CY - ringPx} x2={CX} y2={CY + ringPx} stroke="var(--border-soft)" strokeWidth="1" />

        <g className="pr-sweep" style={{ transformOrigin: `${CX}px ${CY}px` }}>
          <path d={`M ${CX} ${CY} L ${CX + ringPx} ${CY} A ${ringPx} ${ringPx} 0 0 0 ${CX + ringPx * Math.cos(-Math.PI / 4)} ${CY + ringPx * Math.sin(-Math.PI / 4)} Z`} fill="url(#prSweep)" />
        </g>

        <g className="pr-dots">
          {dots.map((d, i) => (
            <circle key={i} className={`pr-dot ${d.callable ? 'callable' : 'suppressed'}`} cx={d.x} cy={d.y} r={d.r} style={{ ['--dot-delay' as string]: `${(i % 20) * 45}ms` }} />
          ))}
        </g>

        <g className="pr-pin">
          <circle className="pr-pin-halo" cx={CX} cy={CY} r="16" />
          <circle cx={CX} cy={CY} r="6.5" fill="var(--accent-hi)" />
          <circle cx={CX} cy={CY} r="2.5" fill="#fff" />
        </g>
      </svg>

      <div className="pr-radar-legend">
        <span className="pr-leg"><i className="pr-leg-dot callable" /> Callable <b>{callable}</b></span>
        <span className="pr-leg"><i className="pr-leg-dot suppressed" /> Suppressed <b>{dots.length - callable}</b></span>
        <span className="pr-leg-note">{radius.toFixed(1)} mi radius</span>
      </div>
    </div>
  );
}

/* ---- count-up readout number ---- */
function PullNum({ value }: { value: number }) {
  const { ref, val } = useCountUp(value);
  return <span ref={ref}>{val.toLocaleString()}</span>;
}

/* ============================================================
   PIPELINE — "How TRU works it". Static/illustrative SVG stepper.
   ============================================================ */
const PIPELINE = [
  { icon: 'prospect', label: 'Pull neighbors', note: 'everyone around the pin' },
  { icon: 'coach', label: 'Skip-trace', note: 'match names to numbers' },
  { icon: 'shield', label: 'DNC + litigator scrub', note: 'compliance-cleared' },
  { icon: 'target', label: 'Prioritize by equity', note: 'rank likeliest to sell' },
  { icon: 'play', label: 'Your call list', note: 'ready to dial' },
];
function Pipeline() {
  return (
    <div className="pr-pipe">
      <svg className="pr-pipe-rail" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
        <line x1="2" y1="5" x2="98" y2="5" className="pr-pipe-line" />
      </svg>
      <ol className="pr-pipe-steps">
        {PIPELINE.map((s, i) => (
          <li key={s.label} className="pr-pipe-step reveal" data-delay={i * 90}>
            <span className="pr-pipe-node">
              <Icon name={s.icon} size={20} />
              <span className="pr-pipe-idx">{i + 1}</span>
            </span>
            <div className="pr-pipe-label">{s.label}</div>
            <div className="pr-pipe-note">{s.note}</div>
            {i < PIPELINE.length - 1 && (
              <span className="pr-pipe-arrow" aria-hidden><ArrowGlyph size={16} /></span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---- curved SVG divider (same language as Home / Rep) ---- */
function DividerWave() {
  return (
    <div className="ps-divider hh-divider" aria-hidden>
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34 L1200 60 L0 60 Z" fill="var(--accent-soft)" />
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34" fill="none" stroke="var(--accent-line)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export default function Prospect({ org, onHome }: { org: { id: string; name: string }; onHome: () => void }) {
  const [channel, setChannel] = useState<Channel>('circle');
  const meta = CHANNELS.find((c) => c.key === channel)!;
  const [subject, setSubject] = useState('');
  // Every channel is now driven by a mileage radius (circle = neighbor ring,
  // expired/FSBO = farm radius). The pull size is derived from it.
  const rcfg = RADIUS_CFG[channel];
  const [radiusMiles, setRadiusMiles] = useState(RADIUS_CFG.circle.def);
  // Radius → how many rows to pull (bounded so a wide farm can't runaway the demo).
  const runLimit = Math.max(4, Math.min(20, Math.round(radiusMiles * (channel === 'circle' ? 4 : 0.9)) + 2));
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
  const canvasRef = useRef<HTMLDivElement | null>(null);

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
        ? await runCircle(DEMO_CENTER, { name: subject || 'Circle campaign', radiusMeters: Math.round(radiusMiles * 1609.34), limit: runLimit })
        : await runListing(channel, { name: subject || undefined, limit: runLimit, radiusMiles });
      setSummary(r.summary); setStubbed(!r.providersLive); setCampaignId(r.campaignId);
      await refreshQueue(r.campaignId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setRunning(false);
  }

  function switchChannel(c: Channel) {
    setChannel(c); setSummary(null); setQueue([]); setCampaignId(null); setErr(''); setSubject('');
    setRadiusMiles(RADIUS_CFG[c].def);
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
  useReveal([summary, queue, loadingQ, channel], canvasRef.current);

  const dialable = queue.filter((q) => q.state === 'queued' || q.state === 'manual');
  const held = queue.filter((q) => q.state === 'gate_blocked' || q.state === 'suppressed');

  // Live pull readout: real run counts once a run returns; a radius-based estimate before.
  const estHouseholds = Math.round(radiusMiles * rcfg.density);
  const estCallable = Math.round(estHouseholds * 0.719);
  const readHouseholds = summary ? summary.neighbors : estHouseholds;
  const readCallable = summary ? summary.queued + summary.manual : estCallable;
  const keptPct = readHouseholds > 0 ? Math.round((readCallable / readHouseholds) * 100) : 0;

  const runLabel = channel === 'circle' ? 'Circle' : channel === 'expired' ? 'Expireds' : 'FSBOs';

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        eyebrow={meta.eyebrow}
        title={meta.title}
        onSignOut={() => supabase.auth.signOut()}
        nav={{
          onHome: () => onHome(),
          onOpenPulse: () => { window.location.hash = '/pulse'; },
          onOpenCoach: () => { window.location.hash = '/'; },
          onOpenRep: () => { window.location.hash = '/rep'; },
          onOpenProspect: () => { window.location.hash = '/prospect'; },
          onOpenStudio: () => { window.location.hash = '/studio'; },
        }}
      >
        <div className="pr-canvas" ref={canvasRef}>
          <div className="pr-ambient" aria-hidden />

          {/* CHANNEL PILLS — real selector */}
          <div className="chan-pills reveal">
            {CHANNELS.map((c) => (
              <button key={c.key} className={`chan-pill ${channel === c.key ? 'active' : ''}`} onClick={() => switchChannel(c.key)}>
                {c.label}
              </button>
            ))}
          </div>

          {/* COMPLIANCE CALLOUT — restyled, real messaging */}
          <section className="card compliance reveal" data-delay="60">
            <div className="risk-glow" />
            <span className="compliance-icon"><Icon name="shield" size={24} /></span>
            <div className="compliance-body">
              <h4>Compliance built in, every time.</h4>
              <p>
                Every number is scrubbed against DNC + litigator lists and checked for the recipient’s
                local calling hours before it reaches your list. {meta.dnc} Opt-outs are permanent and
                cross-channel. You dial; nothing here calls anyone automatically.
              </p>
            </div>
            <span className="compliance-badge"><span className="hq-prod-dot" /> Scrubbed</span>
          </section>

          {/* HERO BENTO: radar centerpiece + start-a-circle form/readout */}
          <section className="pr-bento">
            <article className="card pr-radar-tile reveal" data-delay="80">
              <div className="panel-head">
                <h3>Live radar</h3>
                <span className="panel-sub">{meta.pull}</span>
              </div>
              <Radar radius={radiusMiles} />
            </article>

            <article className="card pr-form reveal" data-delay="140">
              <div className="panel-head">
                <h3>{channel === 'circle' ? 'Start a circle' : channel === 'expired' ? 'Pull expireds' : 'Pull FSBOs'}</h3>
                <span className="panel-sub">{channel === 'circle' ? 'Drop a pin, set a radius, run' : 'Same pull → scrub → prioritize flow'}</span>
              </div>

              <label className="field">
                <span className="field-label">{meta.inputLabel}</span>
                <input
                  className="field-input" type="text" placeholder={meta.placeholder}
                  value={subject} onChange={(e) => setSubject(e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">Radius (miles)</span>
                <input
                  className="field-input field-num" type="number" min={rcfg.min} max={rcfg.max} step={rcfg.step} value={radiusMiles}
                  onChange={(e) => setRadiusMiles(Math.max(rcfg.min, Math.min(rcfg.max, Number(e.target.value) || rcfg.def)))}
                />
                <span className="field-hint">{rcfg.hint} · pulls ~{runLimit} to work</span>
              </label>

              <button className="btn btn-block" onClick={run} disabled={running}>
                <Icon name="prospect" size={18} /> {running ? 'Building list…' : `Run ${runLabel}`}
              </button>

              {stubbed && (
                <div className="pr-run-note">
                  ⚙️ Demo data — {channel === 'circle' ? 'neighbor lookup' : `${meta.label} feed`}, skip trace, and DNC scrub are stubbed until provider keys are added.
                </div>
              )}
              {err && <div className="pr-run-err">{err}</div>}

              {/* live pull readout — count-up (real run counts, or radius estimate before) */}
              <div className="pr-readout">
                <div className="pr-readout-flow">
                  <div className="pr-readout-stat">
                    <div className="pr-readout-num"><PullNum key={readHouseholds} value={readHouseholds} /></div>
                    <div className="pr-readout-label">{summary ? (channel === 'circle' ? 'Neighbors found' : 'Leads found') : 'In radius (est.)'}</div>
                  </div>
                  <span className="pr-readout-arrow" aria-hidden><ArrowGlyph size={18} /></span>
                  <div className="pr-readout-stat">
                    <div className="pr-readout-num accent"><PullNum key={readCallable} value={readCallable} /></div>
                    <div className="pr-readout-label">Callable after scrub</div>
                  </div>
                </div>
                <div className="pr-readout-kept">
                  <span className="pr-readout-keptbar"><span style={{ width: `${keptPct}%` }} /></span>
                  <b>{keptPct}%</b> kept after DNC + litigator scrub
                </div>
              </div>
            </article>
          </section>

          <DividerWave />

          {/* PIPELINE — how TRU works it (illustrative) */}
          <section className="pr-section reveal">
            <div className="panel-head">
              <h3>How TRU works it</h3>
              <span className="panel-sub">Pull to dial-ready in five steps</span>
            </div>
            <Pipeline />
          </section>

          {/* SUMMARY — real run counts */}
          {summary && (
            <div className="pr-summary reveal">
              {([
                [channel === 'circle' ? 'Neighbors' : 'Leads', summary.neighbors, ''],
                ['Ready', summary.queued, 'good'],
                ['Manual', summary.manual, 'warn'],
                ['Held (DNC/hours)', summary.blocked, 'bad'],
                ['Suppressed', summary.suppressed, ''],
                ['No phone', summary.uncallable, ''],
              ] as Array<[string, number, string]>).map(([label, n, tone]) => (
                <div key={label} className="pr-sum-chip">
                  <div className={`pr-sum-num ${tone}`}>{n}</div>
                  <div className="pr-sum-label">{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* THE CALL LIST — the REAL returned queue */}
          {loadingQ && <div className="center-wrap" style={{ display: 'grid', placeItems: 'center', padding: 40 }}><div className="spinner" /></div>}

          {!loadingQ && dialable.length > 0 && (
            <section className="pr-section">
              <div className="panel-head">
                <h3>Your call list <span className="panel-sub">({dialable.length})</span></h3>
                <span className="panel-sub">What today’s pull hands your dialer</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {dialable.map((item) => (
                  <div key={item.id} className="card reveal" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div>
                        <span className="cell-name">{item.person?.full_name ?? 'Lead'}</span>
                        <span className="pr-list-addr">
                          {item.phone_e164 ?? '—'}{item.person?.timezone ? ` · ${item.person.timezone.split('/')[1]?.replace('_', ' ')}` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Badge state={item.state} />
                        {item.phone_e164 && (
                          // Opens the device's own phone app with the number pre-filled — the agent
                          // dials by hand (mobile: native dialer; desktop: only if a tel: handler exists).
                          <a
                            className="pr-callbtn"
                            href={`tel:${item.phone_e164}`}
                            onClick={() => setDialed((s) => new Set(s).add(item.id))}
                          >📞 Call</a>
                        )}
                      </div>
                    </div>
                    {item.dossier?.opener && (
                      <div className="pr-opener">💬 {item.dossier.opener}</div>
                    )}
                    {item.state === 'manual' && (
                      <div className="pr-manual">⚠️ On a DNC list — hand-dial only, and acknowledge before you call. No power dialer.</div>
                    )}
                    {dialed.has(item.id) ? (
                      <div className="pr-disp">
                        {DISPOSITIONS.map((d) => (
                          <button
                            key={d.outcome}
                            className={`pr-disp-btn ${d.tone ?? ''}`}
                            onClick={() => disposition(item, d.outcome)}
                            disabled={busy === item.id}
                          >{d.label}</button>
                        ))}
                      </div>
                    ) : (
                      <div className="pr-disp-hint">Tap Call, then log what happened.</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* HELD / SUPPRESSED — visible for transparency, not dialable */}
          {!loadingQ && held.length > 0 && (
            <section className="pr-section">
              <div className="panel-head">
                <h3>Held by the compliance gate <span className="panel-sub">({held.length})</span></h3>
                <span className="panel-sub">Scrubbed out before they reached your dialer</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {held.map((item) => (
                  <div key={item.id} className="pr-held-row row-suppressed">
                    <span>
                      <span className="pr-held-name">{item.person?.full_name ?? 'Lead'}</span>
                      <span className="pr-held-reason"> · {item.last_gate_decision?.reason ?? 'held'}</span>
                    </span>
                    <Badge state={item.state} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state after a run */}
          {summary && dialable.length === 0 && held.length === 0 && !loadingQ && (
            <div className="pr-run-note" style={{ textAlign: 'center', padding: 30 }}>No callable leads in this run.</div>
          )}

          {/* Pre-run sample / empty state — the OUTPUT preview */}
          {!summary && !loadingQ && (
            <section className="pr-section">
              <div className="card pr-list reveal" data-delay="120">
                <div className="panel-head">
                  <h3>Sample call list</h3>
                  <span className="panel-sub">Run {runLabel} above to build your real, compliance-cleared list</span>
                </div>
                <div className="table-wrap">
                  <table className="tru-table">
                    <thead>
                      <tr><th>Household</th><th>Est. equity</th><th>Phone</th><th>Compliance</th></tr>
                    </thead>
                    <tbody>
                      {[
                        { name: 'Marisol Reyes', addr: '1418 Oak Bend Dr', equity: 312000, ph: 'mobile', clear: true },
                        { name: 'Grant Whitfield', addr: '907 Cypress Ln', equity: 268500, ph: 'mobile', clear: true },
                        { name: 'Dana Okafor', addr: '225 Larkspur Ct', equity: 244000, ph: 'landline', clear: true },
                        { name: 'Theo Marchetti', addr: '1102 Maple Ave', equity: 198750, ph: 'mobile', clear: false },
                        { name: 'Priya Nair', addr: '560 Juniper St', equity: 176000, ph: 'mobile', clear: true },
                      ].map((l) => (
                        <tr key={l.name} className={l.clear ? '' : 'row-suppressed'}>
                          <td>
                            <span className="cell-name">{l.name}</span>
                            <span className="pr-list-addr">{l.addr}</span>
                          </td>
                          <td className="pr-list-equity" style={{ fontWeight: 700, color: 'var(--text-strong)' }}>${l.equity.toLocaleString()}</td>
                          <td><span className={`pr-phone ${l.ph === 'mobile' ? 'ok' : 'mid'}`}>{l.ph === 'mobile' ? 'Mobile' : 'Landline'}</span></td>
                          <td>
                            {l.clear
                              ? <span className="pr-clear ok"><CheckGlyph /> DNC-clear</span>
                              : <span className="pr-clear off"><Icon name="shield" size={13} /> Suppressed</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pr-list-foot">
                  <span className="hq-prod-dot" /> A sample of the shape. Your real list — every row DNC + litigator scrubbed — appears here after a run.
                </div>
              </div>
            </section>
          )}
        </div>
      </HqShell>
    </div>
  );
}
