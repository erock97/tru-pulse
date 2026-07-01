import { useEffect, useState, type ReactNode } from 'react';
import { loadDashboard, triggerSync, type DashboardData } from '../lib/api';
import { supabase } from '../lib/supabase';
import { gciAtRisk } from '../../../shared/flags';
import { CountUp, Ring, Donut, SOURCE_COLORS } from '../components/viz';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const initials = (name: string) =>
  name.split(' ').map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();

export default function Dashboard({ org }: { org: { id: string; name: string } }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setData(await loadDashboard());
  }
  useEffect(() => {
    void load();
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      await triggerSync();
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="center-wrap"><div className="spinner" /></div>;

  const leads = data.leads;
  const total = leads.length;
  const zero = leads.filter((l) => l.flag === 'zero_contact').length;
  const stuck = leads.filter((l) => l.flag === 'stuck').length;
  const worked = leads.filter((l) => l.flag === 'worked').length;
  const workedPct = total ? Math.round((worked / total) * 100) : 0;

  const avgGci = Number(data.settings?.avg_gci ?? 10000);
  const closeRate = Number(data.settings?.close_rate ?? 2);
  const capacity = Number(data.settings?.per_agent_capacity ?? 20);
  const strikeLimit = Number(data.settings?.strike_limit ?? 3);
  const risk = gciAtRisk({ zeroContact: zero, avgGci, closeRatePct: closeRate, windowDays: 30 });

  const byAgent = new Map<string, { zero: number; stuck: number; worked: number; total: number }>();
  for (const l of leads) {
    const a = l.assigned_to || 'Unassigned';
    const r = byAgent.get(a) ?? { zero: 0, stuck: 0, worked: 0, total: 0 };
    r.total++;
    if (l.flag === 'zero_contact') r.zero++;
    else if (l.flag === 'stuck') r.stuck++;
    else if (l.flag === 'worked') r.worked++;
    byAgent.set(a, r);
  }
  const agents = [...byAgent.entries()].sort((a, b) => b[1].zero + b[1].stuck - (a[1].zero + a[1].stuck));

  const bySource = new Map<string, number>();
  for (const l of leads) {
    const s = l.source_family || 'Other';
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
  }
  const sources = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, n, c: SOURCE_COLORS[name] ?? SOURCE_COLORS.Other }));

  const strikesByAgent = new Map<string, number>();
  for (const c of data.cases) {
    const a = c.assigned_to || 'Unassigned';
    strikesByAgent.set(a, (strikesByAgent.get(a) ?? 0) + 1);
  }
  const pauseCount = [...strikesByAgent.values()].filter((n) => n >= strikeLimit).length;
  const newStrikes7d = data.cases.filter((c) => Date.parse(c.opened_at) >= Date.now() - 7 * 86400_000).length;
  const activeAgents = [...byAgent.keys()].filter((a) => a !== 'Unassigned').length;
  const headroom = Math.max(0, activeAgents * capacity - total);

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-logo">T<span className="t">RU</span> Pulse</div>
        <div className="nav active">{ICON.grid}Overview</div>
        <div className="nav">{ICON.shield}Accountability</div>
        <div className="nav">{ICON.users}Agents</div>
        <div className="nav">{ICON.sources}Sources</div>
        <div className="nav">{ICON.gear}Settings</div>
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
            <h2>Overview</h2>
            <span className="muted small">{org.name} · last 30 days</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="btn small" onClick={refresh} disabled={busy}>{busy ? 'Syncing…' : '↻ Refresh'}</button>
            <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>

        <div className="grid4">
          <KPI color="#a9791f" icon={ICON.leads} value={total} label="Paid leads" />
          <KPI color="#c0492f" icon={ICON.zero} value={zero} label="Zero contact" />
          <KPI color="#8f6416" icon={ICON.clock} value={stuck} label="Stuck in Lead" />
          <KPI color="#2e8b57" icon={ICON.check} value={workedPct} suffix="%" label="Worked" />
        </div>

        <div className="grid2">
          <div className="card risk fu">
            <div className="ey">Commission at risk</div>
            <div className="big"><CountUp value={risk.annual} fmt={money} /> / yr</div>
            <div className="sub">
              from paid leads nobody personally worked — includes pay-at-close ({closeRate}% close × {money(avgGci)} avg).
            </div>
          </div>
          <div className="card ringwrap fu">
            <Ring pct={workedPct} />
            <div className="cap">of paid leads actually worked</div>
          </div>
        </div>

        <div className="grid2b">
          <div className="card fu">
            <h3 className="ch">Where the leads come from</h3>
            {sources.length === 0 ? (
              <p className="muted small">No leads synced yet — hit Refresh.</p>
            ) : (
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

        <div className="card tcard fu">
          <div className="thead"><h3 className="ch" style={{ margin: 0 }}>By agent</h3></div>
          <table className="tbl">
            <thead>
              <tr><th>Agent</th><th>Paid</th><th>Zero contact</th><th>Stuck</th><th>Worked</th><th>Strikes (30d)</th></tr>
            </thead>
            <tbody>
              {agents.map(([a, r]) => {
                const s = strikesByAgent.get(a) ?? 0;
                const pause = s >= strikeLimit;
                const pill = s >= strikeLimit ? 'pill-bad' : s > 0 ? 'pill-warn' : 'pill-ok';
                return (
                  <tr key={a}>
                    <td>
                      <span className="cell-agent">
                        <span className="av-sm">{initials(a)}</span>
                        {a}
                        {pause && <span className="badge">Pause rec</span>}
                      </span>
                    </td>
                    <td>{r.total}</td>
                    <td className={r.zero ? 'bad' : ''}>{r.zero}</td>
                    <td className={r.stuck ? 'warn' : ''}>{r.stuck}</td>
                    <td>{r.worked}</td>
                    <td><span className={`pill ${pill}`}>{s}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
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
};
