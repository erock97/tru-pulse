import { useEffect, useState, type ReactNode, type ChangeEvent } from 'react';
import { loadDashboard, saveSettings, type DashboardData, type Settings, type LeadRow } from '../lib/api';
import { supabase } from '../lib/supabase';
import { gciAtRisk, payModel, PAY_LABEL, isClosing, isOfferPlus, type StageClass } from '../../../shared/flags';
import { CountUp, Ring, Donut, SOURCE_COLORS } from '../components/viz';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const initials = (name: string) =>
  name.split(' ').map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
// A lead's accountable owner: the agent, else its pond (ponds get their own rows —
// that's where unowned leads hide), else Unassigned.
const ownerOf = (l: LeadRow) => l.assigned_to || (l.pond ? `Pond · ${l.pond}` : 'Unassigned');
const isPerson = (owner: string) => owner !== 'Unassigned' && !owner.startsWith('Pond · ');

type View = 'overview' | 'accountability' | 'sources' | 'settings';
type Win = '7' | '14' | 'mtd' | '90' | '180';
const WINDOWS: Array<[Win, string]> = [['7', '7d'], ['14', '14d'], ['mtd', 'MTD'], ['90', '90d'], ['180', '6mo']];

interface Drill {
  leads: LeadRow[];
  contacts: Map<string, { email: string | null; phone: string | null }>;
  subs: Map<string, string | null>;
  closings: Map<string, number>;
}

export default function Dashboard({ org, onHome }: { org: { id: string; name: string }; onHome?: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>('overview');
  const [win, setWin] = useState<Win>('mtd');

  async function load() {
    setData(await loadDashboard());
  }
  useEffect(() => {
    void load();
    // Live-ish: re-pull from Supabase every 60s (the Worker cron + FUB webhook keep
    // it fresh) so the board updates on its own — no manual refresh button.
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <div className="center-wrap"><div className="spinner" /></div>;

  // Date window — leads without a created date stay visible in every window.
  const today = new Date();
  const cutoff = win === 'mtd'
    ? new Date(today.getFullYear(), today.getMonth(), 1).getTime()
    : Date.now() - Number(win) * 86400_000;
  // Source filter — Settings lets a leader check only the sources they pay for.
  const enabledSources = data.settings?.sources && data.settings.sources.length ? data.settings.sources : null;
  const leads = data.leads.filter((l) =>
    (!l.fub_created || Date.parse(l.fub_created) >= cutoff) &&
    (!enabledSources || enabledSources.includes(l.source_family ?? 'Other')));

  const total = leads.length;
  const zero = leads.filter((l) => l.flag === 'zero_contact').length;
  const stuck = leads.filter((l) => l.flag === 'stuck').length;
  const worked = leads.filter((l) => l.flag === 'worked').length;
  const workedPct = total ? Math.round((worked / total) * 100) : 0;

  const avgGci = Number(data.settings?.avg_gci ?? 10000);
  const closeRate = Number(data.settings?.close_rate ?? 2);
  const capacity = Number(data.settings?.per_agent_capacity ?? 20);
  const strikeLimit = Number(data.settings?.strike_limit ?? 3);
  const winDays = win === 'mtd' ? Math.max(1, today.getDate()) : Number(win);
  const risk = gciAtRisk({ zeroContact: zero, avgGci, closeRatePct: closeRate, windowDays: winDays });

  // Per-agent rollup.
  const byAgent = new Map<string, { zero: number; stuck: number; worked: number; total: number }>();
  for (const l of leads) {
    const a = ownerOf(l);
    const r = byAgent.get(a) ?? { zero: 0, stuck: 0, worked: 0, total: 0 };
    r.total++;
    if (l.flag === 'zero_contact') r.zero++;
    else if (l.flag === 'stuck') r.stuck++;
    else if (l.flag === 'worked') r.worked++;
    byAgent.set(a, r);
  }
  const agents = [...byAgent.entries()].sort((a, b) => b[1].zero + b[1].stuck - (a[1].zero + a[1].stuck));

  // Drill-down context: contact info per agent (from the shared agents rows) +
  // FUB subdomain per team (for per-lead links).
  const contacts = new Map<string, { email: string | null; phone: string | null }>();
  for (const a of data.agents) contacts.set(norm(a.name), { email: a.email, phone: a.phone });
  const subs = new Map<string, string | null>();
  for (const t of data.teams) subs.set(t.id, t.fub_subdomain);

  // Source mix + pay-model split.
  const bySource = new Map<string, number>();
  for (const l of leads) {
    const s = l.source_family || 'Other';
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
  }
  const sources = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, n, c: SOURCE_COLORS[name] ?? SOURCE_COLORS.Other, pay: payModel(name) }));
  const upfront = sources.filter((s) => s.pay === 'upfront').reduce((s, x) => s + x.n, 0);
  const atClose = sources.filter((s) => s.pay === 'atclose').reduce((s, x) => s + x.n, 0);

  // Accountability rollup (strike cases are already a 30-day window server-side).
  const strikesByAgent = new Map<string, number>();
  for (const c of data.cases) {
    const a = c.assigned_to || 'Unassigned';
    strikesByAgent.set(a, (strikesByAgent.get(a) ?? 0) + 1);
  }
  const pauseCount = [...strikesByAgent.values()].filter((n) => n >= strikeLimit).length;
  const newStrikes7d = data.cases.filter((c) => Date.parse(c.opened_at) >= Date.now() - 7 * 86400_000).length;
  const openCases = data.cases.filter((c) => c.status === 'open').length;
  const activeAgents = [...byAgent.keys()].filter((a) => isPerson(a)).length;
  const headroom = Math.max(0, activeAgents * capacity - total);

  // Closings metrics — UC and Closed count the SAME (Eric's rule). Windowing is
  // forward-inclusive: a UC deal's projected close naturally sits in the future,
  // so "last 30 days" means closes since the cutoff, including pending ones.
  const dealsWin = data.deals.filter((d) => {
    const t = d.projected_close ? Date.parse(d.projected_close) : d.fub_created ? Date.parse(d.fub_created) : NaN;
    return Number.isNaN(t) || t >= cutoff;
  });
  const closings = dealsWin.filter((d) => isClosing((d.stage_class ?? 'other') as StageClass));
  const offersPlus = dealsWin.filter((d) => isOfferPlus((d.stage_class ?? 'other') as StageClass));
  const offerRate = total ? Math.round((offersPlus.length / total) * 100) : 0;
  const perClosing = closings.length ? Math.max(1, Math.round(total / closings.length)) : null;
  const gciInPlay = closings.reduce((s, d) => s + Number(d.commission ?? 0), 0);
  const closingsByAgent = new Map<string, number>();
  for (const d of closings) {
    const a = norm(d.agent_name);
    if (a) closingsByAgent.set(a, (closingsByAgent.get(a) ?? 0) + 1);
  }
  const drill: Drill = { leads, contacts, subs, closings: closingsByAgent };

  const nav = (v: View, icon: ReactNode, label: string) => (
    <div className={`nav${view === v ? ' active' : ''}`} onClick={() => setView(v)}>{icon}{label}</div>
  );

  const winLabel = win === 'mtd' ? 'month to date' : win === '180' ? 'last 6 months' : `last ${win} days`;
  const HEAD: Record<View, { title: string; sub: string }> = {
    overview: { title: 'Overview', sub: `${org.name} · ${winLabel}` },
    accountability: { title: 'Accountability', sub: 'The 3-strike ledger · last 30 days' },
    sources: { title: 'Sources', sub: `Where your tracked leads come from · ${winLabel}` },
    settings: { title: 'Settings', sub: 'Flag windows, strike rules & the $-at-risk math' },
  };

  return (
    <div className="shell">
      <aside className="side">
        {onHome && <div className="side-back" onClick={onHome}>‹ TRU HQ</div>}
        <div className="side-logo">T<span className="t">RU</span> Pulse</div>
        {nav('overview', ICON.grid, 'Overview')}
        {nav('accountability', ICON.shield, 'Accountability')}
        {nav('sources', ICON.sources, 'Sources')}
        {nav('settings', ICON.gear, 'Settings')}
        <div className="side-foot">
          <span className="av">{initials(org.name)}</span>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f2e8d5' }}>{org.name}</div>
            <div style={{ fontSize: 11, color: '#a99a80' }}>Admin</div>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-head">
          <div>
            <h2>{HEAD[view].title}</h2>
            <span className="muted small">{HEAD[view].sub}</span>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {view !== 'settings' && (
              <div className="winpills">
                {WINDOWS.map(([k, l]) => (
                  <span key={k} className={`winpill${win === k ? ' on' : ''}`} onClick={() => setWin(k)}>{l}</span>
                ))}
              </div>
            )}
            <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>

        {view === 'overview' && (
          <>
            <div className="grid4">
              <KPI color="#a9791f" icon={ICON.leads} value={total} label="Tracked leads" />
              <KPI color="#c0492f" icon={ICON.zero} value={zero} label="Zero contact" />
              <KPI color="#8f6416" icon={ICON.clock} value={stuck} label="Stuck in Lead" />
              <KPI color="#2e8b57" icon={ICON.check} value={workedPct} suffix="%" label="Worked" />
            </div>

            <div className="grid4" style={{ marginTop: 16 }}>
              <KPI color="#2e8b57" icon={ICON.check} value={closings.length} label="Closings (UC + Closed)" />
              <KPI color="#a9791f" icon={ICON.offer} value={offerRate} suffix="%" label="Offer rate" />
              <div className="card kpi fu">
                <span className="accent" style={{ background: '#2f6bb0' }} />
                <div className="ico" style={{ background: '#2f6bb022', color: '#2f6bb0' }}>{ICON.ratio}</div>
                <div className="big">{perClosing ? `1 : ${perClosing}` : '—'}</div>
                <div className="lbl">Leads per closing</div>
              </div>
              <div className="card kpi fu">
                <span className="accent" style={{ background: '#8f6416' }} />
                <div className="ico" style={{ background: '#8f641622', color: '#8f6416' }}>{ICON.gci}</div>
                <div className="big"><CountUp value={gciInPlay} fmt={money} /></div>
                <div className="lbl">GCI in play (closings)</div>
              </div>
            </div>

            <div className="grid2">
              <div className="card risk fu">
                <div className="ey">Commission at risk</div>
                <div className="big"><CountUp value={risk.annual} fmt={money} /> / yr</div>
                <div className="sub">
                  from tracked leads nobody personally worked — paid-up-front spend plus untapped
                  pay-at-close GCI ({closeRate}% close × {money(avgGci)} avg).
                </div>
              </div>
              <div className="card ringwrap fu">
                <Ring pct={workedPct} />
                <div className="cap">of tracked leads actually worked</div>
              </div>
            </div>

            <div className="grid2b">
              <div className="card fu">
                <h3 className="ch">Where the leads come from</h3>
                {sources.length === 0 ? (
                  <p className="muted small">No leads in this window.</p>
                ) : (
                  <>
                    <div className="donutwrap">
                      <Donut sources={sources} />
                      <div className="legend">
                        {sources.map((s) => (
                          <div className="leg" key={s.name}>
                            <span className="dot" style={{ background: s.c }} />
                            {s.name}
                            <b>{s.n}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="paysplit">
                      <span><b>{upfront}</b> paid up front</span>
                      <span><b>{atClose}</b> pay at close</span>
                    </div>
                  </>
                )}
              </div>
              <div className="card accsum fu">
                <h3 className="ch">Accountability this week</h3>
                <div className="row">
                  <span className="tag" style={{ background: '#fbe9e5', color: 'var(--terra)' }}>{pauseCount}</span>
                  <div className="t"><b>Pause recommended</b><br /><span className="muted">agents at {strikeLimit}+ strikes / 30 days</span></div>
                </div>
                <div className="row">
                  <span className="tag" style={{ background: '#f7eede', color: 'var(--gold-dk)' }}>{newStrikes7d}</span>
                  <div className="t"><b>New strikes</b><br /><span className="muted">opened in the last 7 days</span></div>
                </div>
                <div className="row">
                  <span className="tag" style={{ background: '#eef4ef', color: 'var(--green)' }}>{headroom}</span>
                  <div className="t"><b>Coverage headroom</b><br /><span className="muted">capacity vs. tracked intake</span></div>
                </div>
              </div>
            </div>

            <AgentTable agents={agents} strikesByAgent={strikesByAgent} strikeLimit={strikeLimit} caption="By agent · click a row to drill in" drill={drill} />
          </>
        )}
        {view === 'accountability' && (
          <Accountability
            strikesByAgent={strikesByAgent} strikeLimit={strikeLimit}
            pauseCount={pauseCount} newStrikes7d={newStrikes7d} openCases={openCases}
          />
        )}
        {view === 'sources' && <Sources sources={sources} total={total} upfront={upfront} atClose={atClose} />}
        {view === 'settings' && data.settings && (
          <SettingsView initial={data.settings} onSaved={() => void load()} />
        )}
      </main>
    </div>
  );
}

// ── Accountability ──────────────────────────────────────────────────────────
function Accountability(p: {
  strikesByAgent: Map<string, number>; strikeLimit: number;
  pauseCount: number; newStrikes7d: number; openCases: number;
}) {
  const rows = [...p.strikesByAgent.entries()]
    .filter(([a]) => a !== 'Unassigned')
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="grid4">
        <KPI color="#c0492f" icon={ICON.shield} value={p.pauseCount} label="Pause recommended" />
        <KPI color="#8f6416" icon={ICON.clock} value={p.newStrikes7d} label="New strikes (7d)" />
        <KPI color="#a9791f" icon={ICON.leads} value={p.openCases} label="Open cases" />
        <KPI color="#2e8b57" icon={ICON.check} value={p.strikeLimit} label="Strike limit" />
      </div>

      <div className="card fu" style={{ marginTop: 16 }}>
        <h3 className="ch">How the ledger works</h3>
        <p className="muted small" style={{ lineHeight: 1.6, margin: 0 }}>
          A strike opens when an agent leaves a tracked lead un-worked (no call and fewer than two
          outbound texts) or lets one stall in the Lead stage. Reaching {p.strikeLimit} strikes in a
          rolling 30 days triggers a coach-confirmed pause recommendation — never an automatic action.
        </p>
      </div>

      <div className="card tcard fu">
        <div className="thead"><h3 className="ch" style={{ margin: 0 }}>Strikes by agent · last 30 days</h3></div>
        <table className="tbl">
          <thead>
            <tr><th>Agent</th><th>Strikes (30d)</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: '22px' }}>No strikes on record — clean board.</td></tr>
            ) : rows.map(([a, s]) => {
              const pause = s >= p.strikeLimit;
              const pill = pause ? 'pill-bad' : s > 0 ? 'pill-warn' : 'pill-ok';
              return (
                <tr key={a}>
                  <td><span className="cell-agent"><span className="av-sm">{initials(a)}</span>{a}{pause && <span className="badge">Pause rec</span>}</span></td>
                  <td><span className={`pill ${pill}`}>{s}</span></td>
                  <td className={pause ? 'bad' : s > 0 ? 'warn' : ''}>{pause ? 'Pause recommended' : s > 0 ? 'On watch' : 'Clear'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────
function Sources(p: {
  sources: Array<{ name: string; n: number; c: string; pay: 'upfront' | 'atclose' }>;
  total: number; upfront: number; atClose: number;
}) {
  return (
    <>
      <div className="grid2b">
        <div className="card fu">
          <h3 className="ch">Source mix</h3>
          {p.sources.length === 0 ? <p className="muted small">No leads in this window.</p> : (
            <div className="donutwrap"><Donut sources={p.sources} /><div className="legend">
              {p.sources.map((s) => (
                <div className="leg" key={s.name}><span className="dot" style={{ background: s.c }} />{s.name}<b>{s.n}</b></div>
              ))}
            </div></div>
          )}
        </div>
        <div className="card fu">
          <h3 className="ch">How you pay for them</h3>
          <div className="paycard">
            <div><div className="paycard-n">{p.upfront}</div><div className="paycard-l">Paid up front</div><div className="muted small">Subscription / ad spend — Realtor.com, Homes.com, Facebook, Google. Un-worked here is real wasted spend.</div></div>
            <div><div className="paycard-n">{p.atClose}</div><div className="paycard-l">Pay at close</div><div className="muted small">Referral fee at close — Zillow, referral networks. Un-worked here is untapped GCI, not out-of-pocket.</div></div>
          </div>
        </div>
      </div>

      <div className="card tcard fu">
        <div className="thead"><h3 className="ch" style={{ margin: 0 }}>Every source</h3></div>
        <table className="tbl">
          <thead><tr><th>Source</th><th>Leads</th><th>Share</th><th>How you pay</th></tr></thead>
          <tbody>
            {p.sources.map((s) => (
              <tr key={s.name}>
                <td><span className="cell-agent"><span className="dot" style={{ background: s.c, width: 10, height: 10, borderRadius: 3 }} />{s.name}</span></td>
                <td>{s.n}</td>
                <td>{p.total ? Math.round((s.n / p.total) * 100) : 0}%</td>
                <td><span className={`pill ${s.pay === 'atclose' ? 'pill-warn' : 'pill-ok'}`}>{PAY_LABEL[s.pay]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Settings (editable via the Worker) ──────────────────────────────────────
function SettingsView({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [form, setForm] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await saveSettings(form);
      setMsg({ ok: true, text: 'Saved. New numbers apply on the next sync.' });
      onSaved();
    } catch {
      setMsg({ ok: false, text: 'Could not save — check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  // Plain function returning JSX (NOT a component): a component defined inside
  // render remounts on every keystroke and drops input focus after one digit.
  const F = (k: keyof Settings, label: string, hint: string, suffix?: string) => (
    <div className="setrow" key={k}>
      <div><div className="setlabel">{label}</div><div className="muted small">{hint}</div></div>
      <div className="setinput">
        <input type="number" value={String(form[k] ?? '')} onChange={set(k)} />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </div>
  );

  const SOURCE_OPTS: Array<[string, string]> = [
    ['Zillow', 'Zillow Preferred / Flex'],
    ['Realtor.com', 'Realtor.com · MVIP'],
    ['Homes.com', 'Homes.com'],
    ['Facebook', 'Facebook / Instagram'],
    ['Google', 'Google / LSA'],
    ['Referrals', 'Referral networks'],
  ];
  const allSourceKeys = SOURCE_OPTS.map(([k]) => k);
  const checkedSources = form.sources && form.sources.length ? form.sources : allSourceKeys;
  const toggleSource = (k: string) => {
    const next = checkedSources.includes(k) ? checkedSources.filter((x) => x !== k) : [...checkedSources, k];
    if (!next.length) return; // at least one source stays on
    setForm({ ...form, sources: next });
  };

  return (
    <div className="card fu" style={{ maxWidth: 640 }}>
      {msg && <div className={msg.ok ? 'ok' : 'err'}>{msg.text}</div>}
      <div className="setrow" style={{ display: 'block' }}>
        <div className="setlabel">Lead sources you pay for</div>
        <div className="muted small" style={{ marginBottom: 10 }}>Only checked sources count on the board — every KPI, chart, and per-agent number follows.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {SOURCE_OPTS.map(([k, label]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, margin: 0, cursor: 'pointer' }}>
              <input type="checkbox" checked={checkedSources.includes(k)} onChange={() => toggleSource(k)} style={{ width: 16, height: 16, margin: 0 }} />
              {label}
            </label>
          ))}
        </div>
      </div>
      {F('avg_gci', 'Average GCI per deal', 'Drives the commission-at-risk math.', '$')}
      {F('close_rate', 'Worked-lead close rate', '% of properly worked leads that close.', '%')}
      {F('window_hours', 'Contact window', "Hours a new lead can sit before it's flagged.", 'hrs')}
      {F('strike_limit', 'Strike limit', 'Strikes in 30 days that trigger a pause recommendation.')}
      {F('per_agent_capacity', 'Per-agent capacity', 'Leads one agent can work well — sets coverage headroom.')}
      <button className="btn" onClick={save} disabled={busy} style={{ marginTop: 18 }}>{busy ? 'Saving…' : 'Save settings'}</button>
    </div>
  );
}

// ── Agent table with drill-down ─────────────────────────────────────────────
const FLAG_LABEL: Record<string, string> = { zero_contact: 'Zero contact', stuck: 'In Lead', worked: 'Worked' };

function AgentTable(p: {
  agents: Array<[string, { zero: number; stuck: number; worked: number; total: number }]>;
  strikesByAgent: Map<string, number>; strikeLimit: number; caption: string; drill: Drill;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [flagF, setFlagF] = useState<string>('all');
  const toggle = (a: string) => { setOpen(open === a ? null : a); setFlagF('all'); };

  return (
    <div className="card tcard fu">
      <div className="thead"><h3 className="ch" style={{ margin: 0 }}>{p.caption}</h3></div>
      <table className="tbl">
        <thead>
          <tr><th>Agent</th><th>Leads</th><th>Zero contact</th><th>Stuck</th><th>Worked</th><th>Worked %</th><th>Strikes (30d)</th></tr>
        </thead>
        <tbody>
          {p.agents.map(([a, r]) => {
            const s = p.strikesByAgent.get(a) ?? 0;
            const pause = s >= p.strikeLimit;
            const pill = pause ? 'pill-bad' : s > 0 ? 'pill-warn' : 'pill-ok';
            const wp = r.total ? Math.round((r.worked / r.total) * 100) : 0;
            const isOpen = open === a;
            return (
              <FragmentRow key={a}>
                <tr className={isOpen ? 'row-open' : ''} onClick={() => toggle(a)} style={{ cursor: 'pointer' }}>
                  <td><span className="cell-agent"><span className="av-sm">{initials(a)}</span>{a}{pause && <span className="badge">Pause rec</span>}<span className="caret">{isOpen ? '▾' : '▸'}</span></span></td>
                  <td>{r.total}</td>
                  <td className={r.zero ? 'bad' : ''}>{r.zero}</td>
                  <td className={r.stuck ? 'warn' : ''}>{r.stuck}</td>
                  <td>{r.worked}</td>
                  <td>{wp}%</td>
                  <td><span className={`pill ${pill}`}>{s}</span></td>
                </tr>
                {isOpen && (
                  <tr className="drillrow">
                    <td colSpan={7}>
                      <AgentDrill agent={a} counts={r} drill={p.drill} flagF={flagF} setFlagF={setFlagF} />
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// React fragments can't take a key directly in .map without importing Fragment; tiny helper.
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function AgentDrill({ agent, counts, drill, flagF, setFlagF }: {
  agent: string;
  counts: { zero: number; stuck: number; worked: number; total: number };
  drill: Drill; flagF: string; setFlagF: (f: string) => void;
}) {
  const mine = drill.leads.filter((l) => ownerOf(l) === agent);
  const shown = flagF === 'all' ? mine : mine.filter((l) => l.flag === flagF);
  const c = drill.contacts.get(norm(agent));
  const chips: Array<[string, string, number]> = [
    ['all', 'All', counts.total],
    ['zero_contact', 'Zero contact', counts.zero],
    ['stuck', 'In Lead', counts.stuck],
    ['worked', 'Worked', counts.worked],
  ];
  const emailHref = c?.email
    ? `mailto:${c.email}?subject=${encodeURIComponent('Your leads this week')}&body=${encodeURIComponent(`Hey ${agent.split(' ')[0]} — a few of your leads need attention. Can you give me an update today?`)}`
    : null;
  const smsHref = c?.phone ? `sms:${c.phone.replace(/[^+\d]/g, '')}` : null;

  return (
    <div className="drill">
      <div className="drill-head">
        <div className="drill-chips">
          {chips.map(([k, l, n]) => (
            <span key={k} className={`chip${flagF === k ? ' on' : ''}`} onClick={() => setFlagF(k)}>{l} <b>{n}</b></span>
          ))}
          <span className="chip stat">Closings <b>{drill.closings.get(norm(agent)) ?? 0}</b></span>
        </div>
        {isPerson(agent) && (
          <div className="drill-acts">
            {emailHref ? <a className="abtn" href={emailHref}>✉ Email {agent.split(' ')[0]}</a> : <span className="abtn off" title="No email on file — add it in FUB">✉ No email on file</span>}
            {smsHref ? <a className="abtn" href={smsHref}>💬 Text {agent.split(' ')[0]}</a> : <span className="abtn off" title="No mobile on file — add it in FUB">💬 No mobile on file</span>}
          </div>
        )}
      </div>
      <div className="drill-list">
        {shown.length === 0 ? (
          <div className="muted small" style={{ padding: '10px 2px' }}>No leads match this filter in the current window.</div>
        ) : shown.map((l, i) => {
          // Deep-link to the person in FUB; the generic app host redirects to the
          // team's own subdomain for a logged-in user, so the link always exists.
          const sub = drill.subs.get(l.team_id);
          const fubHref = l.fub_person_id
            ? `https://${sub ? sub + '.followupboss.com' : 'app.followupboss.com'}/2/people/view/${l.fub_person_id}`
            : null;
          const pill = l.flag === 'worked' ? 'pill-ok' : l.flag === 'stuck' ? 'pill-warn' : 'pill-bad';
          return (
            <div className="leadline" key={i}>
              <span className="dot" style={{ background: SOURCE_COLORS[l.source_family ?? 'Other'] ?? SOURCE_COLORS.Other }} />
              <span className="ln">{l.name || 'Lead'}</span>
              <span className="muted small">{l.source_family ?? 'Other'}{l.stage ? ` · ${l.stage}` : ''}{l.pond && l.assigned_to ? ` · Pond: ${l.pond}` : ''}</span>
              <span className={`pill ${pill}`} style={{ marginLeft: 'auto' }}>{FLAG_LABEL[l.flag ?? ''] ?? l.flag}</span>
              {fubHref && <a className="abtn sm" href={fubHref} target="_blank" rel="noreferrer">FUB ↗</a>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KPI({ color, icon, value, suffix, label }: { color: string; icon: ReactNode; value: number; suffix?: string; label: string }) {
  return (
    <div className="card kpi fu">
      <span className="accent" style={{ background: color }} />
      <div className="ico" style={{ background: color + '22', color }}>{icon}</div>
      <div className="big"><CountUp value={value} fmt={suffix ? (n) => `${Math.round(n)}${suffix}` : undefined} /></div>
      <div className="lbl">{label}</div>
    </div>
  );
}

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{children}</svg>
);
const ICON = {
  grid: svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  shield: svg(<path d="M12 2l8 3v6c0 5-3.5 8-8 11-4.5-3-8-6-8-11V5z" />),
  users: svg(<><circle cx="9" cy="8" r="3" /><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" /><circle cx="18" cy="9" r="2.5" /><path d="M16.5 15c3 .4 5.5 2.6 5.5 6" /></>),
  sources: svg(<><path d="M12 3v9l7 4" /><circle cx="12" cy="12" r="9" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>),
  leads: svg(<path d="M4 6h16M4 12h16M4 18h10" />),
  zero: svg(<><circle cx="12" cy="12" r="9" /><path d="M5 5l14 14" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  check: svg(<path d="M4 12l5 5L20 6" />),
  offer: svg(<><path d="M12 3v18" /><path d="M17 7c0-1.7-2.2-3-5-3S7 5.3 7 7s1.6 2.6 5 3c3.4.4 5 1.3 5 3s-2.2 3-5 3-5-1.3-5-3" /></>),
  ratio: svg(<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M19 5L5 19" /></>),
  gci: svg(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></>),
};
