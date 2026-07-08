import { useEffect, useRef, useState } from 'react';
import { loadRep, inviteAgent, signOffAgent, simScenarios, signOutClean, type RepData, type RepAgent, type RepProgressRow, type RepModule, type CourseModule, type SimScenario } from '../lib/api';
import { Lesson, SimView } from './AgentCourse';
import { HqShell } from '../components/hqShell';
import { Icon, Ring, Avatar } from '../components/hqUi';
import { useReveal, useCountUp } from '../hqHooks';
import '../truHqDark.css';

/* ============================================================
   REP — onboarding & certification, dark shape-diverse reskin.
   Reshaped into the Pulse / Home language: a focal certification
   GAUGE + satellite tiles, the curriculum as a connected JOURNEY
   track, and a certification FUNNEL + searchable capped roster.

   PRESENTATION ONLY. Every number/name flows from the SAME real
   data the previous render used — loadRep() (modules, progress,
   agents, practice), simScenarios(), inviteAgent(), signOffAgent(),
   and the Lesson / SimView preview entries. No mock data.
   ============================================================ */

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/* ---- satellite count-up tile (varied sizes) ---- */
function Satellite({ value, label }: { value: number; label: string }) {
  const { ref, val } = useCountUp(value);
  return (
    <div>
      <div className="rp-sat-num"><span ref={ref}>{val}</span></div>
      <div className="rp-sat-label">{label}</div>
    </div>
  );
}

/* ---- module-progress dots (per REAL module: cleared / in progress / not started) ---- */
function ProgressDots({ statuses }: { statuses: string[] }) {
  const done = statuses.filter((s) => s === 'passed').length;
  return (
    <span className="rp-dots" aria-label={`${done} of ${statuses.length} modules cleared`}>
      {statuses.map((s, i) => (
        <span key={i} className={`rp-dot ${s === 'passed' ? 'on' : s === 'in_progress' ? 'mid' : ''}`} />
      ))}
    </span>
  );
}

/* ---- curved SVG divider (same language as Pulse / Home) ---- */
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

/* ---- Certification funnel — tapering SVG segments, drawn in.
   Derived from the REAL roster's progress (see below). ---- */
function CertFunnel({ tiers }: { tiers: Array<{ label: string; value: number; color: string }> }) {
  const W = 460;
  const rowH = 70;
  const gap = 12;
  const max = tiers[0]?.value || 1;
  const minW = 120;
  return (
    <svg
      className="rp-funnel-svg"
      viewBox={`0 0 ${W} ${tiers.length * rowH + (tiers.length - 1) * gap}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Certification funnel"
    >
      <defs>
        {tiers.map((f, i) => (
          <linearGradient id={`rpFun${i}`} key={i} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={f.color} stopOpacity="0.9" />
            <stop offset="1" stopColor={f.color} stopOpacity="0.55" />
          </linearGradient>
        ))}
      </defs>
      {tiers.map((f, i) => {
        const w = Math.max(minW, (f.value / max) * W);
        const x = (W - w) / 2;
        const y = i * (rowH + gap);
        const drop = i > 0 ? tiers[i - 1].value - f.value : 0;
        return (
          <g key={f.label} className="rp-funnel-row" style={{ ['--fd' as string]: `${i * 130}ms` }}>
            <rect x={x} y={y} width={w} height={rowH} rx="12" fill={`url(#rpFun${i})`} stroke={f.color} strokeOpacity="0.5" />
            <text x={W / 2} y={y + rowH / 2 - 6} textAnchor="middle" className="rp-funnel-val">{f.value}</text>
            <text x={W / 2} y={y + rowH / 2 + 14} textAnchor="middle" className="rp-funnel-lbl">{f.label}</text>
            {drop > 0 && (
              <text x={W - 6} y={y - 2} textAnchor="end" className="rp-funnel-drop">−{drop}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function Rep({ org, onHome }: { org: { id: string; name: string }; onHome?: () => void }) {
  const [data, setData] = useState<RepData | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [preview, setPreview] = useState<RepModule | null>(null);
  const [simTest, setSimTest] = useState(false);
  const [sims, setSims] = useState<{ configured: boolean; scenarios: SimScenario[] }>({ configured: false, scenarios: [] });
  const [q, setQ] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const refresh = () => loadRep().then(setData);
  useEffect(() => { void refresh(); void simScenarios().then(setSims); }, []);
  useReveal([data, simTest, preview], canvasRef.current);

  if (!data) {
    return (
      <div className="tru-dark">
        <div className="center-wrap" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // Leader test drive of the Live Sim — real call, real grade, nothing recorded.
  if (simTest) {
    return <SimView scenarios={sims.scenarios} configured={sims.configured} attempts={[]} onBack={() => setSimTest(false)} onGraded={() => {}} />;
  }

  // Full course preview — the leader walks the exact module the agents get.
  if (preview) {
    const asCourse: CourseModule = {
      ...preview,
      cards: preview.cards ?? [],
      qs: [],
      status: 'not_started', score: null, passed_at: null, signed: false,
    };
    return <Lesson module={asCourse} onBack={() => setPreview(null)} onDone={() => setPreview(null)} doneLabel={`End of module · ${preview.questions}-question quiz follows ✓`} />;
  }

  // ── REAL DATA (unchanged pipeline) ──────────────────────────────────────────
  const { modules, progress, agents, practice } = data;
  const simPassed = (agentId: string) => practice.some((p) => p.agent_id === agentId && p.passed);
  const simTries = (agentId: string) => practice.filter((p) => p.agent_id === agentId).length;
  const simBest = (agentId: string) => practice.filter((p) => p.agent_id === agentId && p.score != null)
    .reduce<number | null>((b, p) => (b == null || (p.score as number) > b ? p.score : b), null);
  const row = (agentId: string, moduleId: string): RepProgressRow | undefined =>
    progress.find((p) => p.agent_id === agentId && p.module_id === moduleId);
  const stat = (agentId: string, moduleId: string) => row(agentId, moduleId)?.status ?? 'not_started';
  const pct = (agentId: string) => {
    const passed = modules.filter((m) => stat(agentId, m.id) === 'passed').length;
    return modules.length ? Math.round((passed / modules.length) * 100) : 0;
  };
  const isSigned = (agentId: string) => {
    const passedRows = progress.filter((p) => p.agent_id === agentId && p.status === 'passed');
    return pct(agentId) === 100 && passedRows.length > 0 && passedRows.every((p) => p.signed_off_at);
  };
  const certifiedCount = agents.filter((a) => pct(a.id) === 100).length;
  const teamCert = agents.length ? Math.round((certifiedCount / agents.length) * 100) : 0;
  const totalQuestions = modules.reduce((s, m) => s + m.questions, 0);

  // ── Certification FUNNEL — derived entirely from the REAL per-agent progress.
  // enrolled (all agents) → invited (login minted) → started (any module touched)
  // → in progress (started, not fully certified) → certified (100% + all signed).
  const enrolled = agents.length;
  const invitedCount = agents.filter((a) => a.invited).length;
  const startedCount = agents.filter((a) => progress.some((p) => p.agent_id === a.id && p.status !== 'not_started')).length;
  const inProgressCount = agents.filter((a) => {
    const started = progress.some((p) => p.agent_id === a.id && p.status !== 'not_started');
    return started && pct(a.id) < 100;
  }).length;
  const funnelTiers = [
    { label: 'Agents enrolled', value: enrolled, color: 'var(--accent-hi)' },
    { label: 'Invited (login sent)', value: invitedCount, color: 'var(--accent)' },
    { label: 'Started a module', value: startedCount, color: 'var(--sea-hi)' },
    { label: 'In progress', value: inProgressCount, color: 'var(--accent)' },
    { label: 'Fully certified', value: certifiedCount, color: 'var(--terracotta)' },
  ];

  // Journey state per module: locked if no preview cards; otherwise the first
  // previewable is "start here", the rest "available". Mirrors the real openable flag.
  let firstOpenSeen = false;
  const journey = modules.map((m) => {
    const openable = !!m.cards?.length;
    let state: 'open' | 'avail' | 'locked';
    if (!openable) state = 'locked';
    else if (!firstOpenSeen) { state = 'open'; firstOpenSeen = true; }
    else state = 'avail';
    return { m, openable, state };
  });

  // Searchable + capped roster (real agents).
  const needle = q.trim().toLowerCase();
  const filtered = needle ? agents.filter((a) => a.name.toLowerCase().includes(needle)) : agents;
  const CAP = 10;
  const shown = filtered.slice(0, CAP);

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        eyebrow="Onboarding & certification"
        title="Rep — certify every agent."
        onSignOut={() => signOutClean()}
        nav={{
          onHome: () => onHome?.(),
          onOpenPulse: () => { window.location.hash = '/pulse'; },
          onOpenCoach: () => { window.location.hash = '/'; },
          onOpenRep: () => { window.location.hash = '/rep'; },
        }}
      >
        <div className="rp-canvas" ref={canvasRef}>
          <div className="rp-ambient" aria-hidden />

          {/* ============ HERO BENTO: gauge focal + satellite tiles ============ */}
          <section className="rp-bento">
            <article className="rp-hero-anchor reveal">
              <div className="rp-hero-glow" />
              <div className="rp-hero-inner">
                <span className="hq-eyebrow"><span className="dot" /> The program</span>
                <h2 className="rp-hero-title">Certify every agent on the program.</h2>
                <p className="rp-hero-sub">
                  The Preferred standards, real scripts and practice drills, and a server-graded quiz
                  to pass on every module. Agents sign in with their own login; you invite, watch
                  progress, and sign off here.
                </p>
                <div className="rp-hero-cta">
                  <button
                    className="rp-preview"
                    onClick={() => setSimTest(true)}
                    title="Take a practice call yourself — real call, real grade, nothing recorded"
                  >
                    🎙 Test the Live Sim
                  </button>
                </div>
              </div>
            </article>

            {/* Focal: certification gauge — REAL fully-certified % */}
            <article className="card rp-gauge-tile reveal" data-delay="80">
              <div className="rp-gauge-glow" />
              <div className="rp-gauge-wrap">
                <Ring pct={teamCert} size={186} stroke={16} label={`${teamCert}%`} color="var(--accent-hi)" />
              </div>
              <div className="rp-gauge-cap">Fully certified</div>
              <div className="rp-gauge-sub">
                {certifiedCount} of {agents.length} agent{agents.length === 1 ? '' : 's'} {certifiedCount === 1 ? 'has' : 'have'} earned the badge
              </div>
            </article>

            {/* Satellite tiles — REAL module / quiz / agent counts */}
            <div className="rp-sats-row">
              <article className="card rp-sat-tile rp-sat-a reveal" data-delay="140">
                <Satellite value={modules.length} label="Modules" />
              </article>
              <article className="card rp-sat-tile rp-sat-b reveal" data-delay="180">
                <Satellite value={totalQuestions} label="Quiz questions" />
              </article>
              <article className="card rp-sat-tile rp-sat-c reveal" data-delay="220">
                <Satellite value={agents.length} label="Agents enrolled" />
              </article>
            </div>
          </section>

          <DividerWave />

          {/* ============ MODULE JOURNEY — the REAL curriculum ============ */}
          <section className="rp-journey reveal">
            <div className="rp-journey-head">
              <div className="panel-head" style={{ margin: 0 }}>
                <h3>The certification journey</h3>
                <span className="panel-sub">{modules.length} module{modules.length === 1 ? '' : 's'} · pass each quiz at its threshold</span>
              </div>
              <button
                className="rp-preview"
                onClick={() => setSimTest(true)}
                title="Take a practice call yourself — real call, real grade, nothing recorded"
              >
                🎙 Test the Live Sim
              </button>
            </div>
            <div className="rp-track">
              <svg className="rp-rail" viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden>
                <line x1="20" y1="0" x2="20" y2="100" className="rp-rail-line" />
              </svg>
              <ol className="rp-steps">
                {journey.map(({ m, openable, state }, i) => (
                  <li
                    key={m.id}
                    className={`rp-step reveal state-${state}${openable ? ' is-open' : ''}`}
                    data-delay={i * 70}
                    onClick={() => openable && setPreview(m)}
                  >
                    <span className="rp-node"><span className="rp-node-n">{m.idx}</span></span>
                    <div className="rp-step-body">
                      <div className="rp-step-top">
                        <h4>{m.title}</h4>
                        {state === 'locked' && <span className="rp-lock">No preview</span>}
                        {state === 'open' && <span className="rp-open">Start here</span>}
                      </div>
                      <div className="rp-step-meta">
                        {m.cards?.length ?? 0} screens · {m.questions} Q · pass {m.pass_pct}%
                        {m.summary ? ` · ${m.summary}` : ''}
                      </div>
                    </div>
                    <button
                      className="rp-preview"
                      disabled={!openable}
                      onClick={(e) => { e.stopPropagation(); if (openable) setPreview(m); }}
                      title={openable ? 'Walk the exact module your agents get' : 'No preview screens on this module yet'}
                    >
                      <Icon name="play" size={15} /> Preview
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <DividerWave />

          {/* ============ FUNNEL + ROSTER ============ */}
          <section className="rp-progress">
            <div className="panel-head reveal">
              <h3>Certification progress · {agents.length} agent{agents.length === 1 ? '' : 's'}</h3>
              <span className="panel-sub">See the drop-off, then work the roster</span>
            </div>
            <div className="rp-progress-grid">
              {/* Funnel — derived from real progress */}
              <div className="card rp-funnel reveal">
                <div><span className="rp-tile-eyebrow">Where agents stall</span></div>
                <CertFunnel tiers={funnelTiers} />
                <p className="rp-funnel-note">
                  {startedCount} of {enrolled} started a module
                  {certifiedCount === 0 ? ", but no one has cleared every module yet — the middle is where momentum dies." : `, and ${certifiedCount} ${certifiedCount === 1 ? 'has' : 'have'} earned the full badge.`}
                </p>
              </div>

              {/* Roster — REAL agents, real Invite, expandable drill-down */}
              <div className="card rp-roster reveal" data-delay="100">
                <div className="rp-roster-head">
                  <div className="rp-search">
                    <Icon name="prospect" size={16} />
                    <input
                      className="rp-search-input"
                      placeholder={`Search ${agents.length} agent${agents.length === 1 ? '' : 's'} by name…`}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  <span className="rp-roster-count">Showing {shown.length} of {filtered.length}</span>
                </div>

                {agents.length === 0 ? (
                  <div className="rp-roster-empty">No agents yet — invite your team in Coach and they'll appear here.</div>
                ) : (
                  <div className="rp-roster-list">
                    {shown.map((a) => {
                      const p = pct(a.id);
                      const statuses = modules.map((m) => stat(a.id, m.id));
                      const isOpen = openAgent === a.id;
                      return (
                        <div key={a.id}>
                          <div className="rp-agent is-open" onClick={() => setOpenAgent(isOpen ? null : a.id)}>
                            <Avatar name={a.name} size={34} tone={0} />
                            <span className="rp-agent-name">
                              {a.name}
                              {isSigned(a.id) && <span className="rp-pill-ok" title="Certification signed off">Signed ✓</span>}
                            </span>
                            <ProgressDots statuses={statuses} />
                            <span className={`rp-agent-pct ${p === 0 ? 'zero' : ''}`}>{p}%</span>
                            <span className="rp-caret">{isOpen ? '▾' : '▸'}</span>
                            <span onClick={(e) => e.stopPropagation()}>
                              <InviteCell agent={a} />
                            </span>
                          </div>
                          {isOpen && (
                            <AgentDrill
                              agent={a}
                              modules={modules}
                              row={row}
                              pct={p}
                              signed={isSigned(a.id)}
                              sim={{ best: simBest(a.id), passed: simPassed(a.id), tries: simTries(a.id) }}
                              onSigned={() => void refresh()}
                            />
                          )}
                        </div>
                      );
                    })}
                    {shown.length === 0 && <div className="rp-roster-empty">No agents match “{q}”.</div>}
                  </div>
                )}

                {filtered.length > CAP && (
                  <div className="rp-roster-more">{filtered.length - CAP} more — search to narrow the roster.</div>
                )}
                <div className="rp-legend">
                  <span><span className="rp-dot on" /> Module cleared</span>
                  <span><span className="rp-dot mid" /> In progress</span>
                  <span><span className="rp-dot" /> Not started</span>
                </div>
              </div>
            </div>

            <div className="rp-note" style={{ margin: '18px 2px 0' }}>
              <b>How it works:</b> hit <b>Invite</b> to send an agent their login. They set a password, take each module,
              and pass its quiz — their progress fills in above. Quizzes are graded server-side, so a pass is real.
            </div>
          </section>
        </div>
      </HqShell>
    </div>
  );
}

/* ============================================================
   AGENT DRILL — module-by-module drill-down + the certification
   sign-off. Same real data + signOffAgent() behavior as before.
   ============================================================ */
function AgentDrill({ agent, modules, row, pct, signed, sim, onSigned }: {
  agent: RepAgent;
  modules: RepData['modules'];
  row: (agentId: string, moduleId: string) => RepProgressRow | undefined;
  pct: number;
  signed: boolean;
  sim: { best: number | null; passed: boolean; tries: number };
  onSigned: () => void;
}) {
  const certReady = pct === 100 && sim.passed;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function signOff() {
    if (busy) return;
    setBusy(true); setErr('');
    try { await signOffAgent(agent.id); onSigned(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not sign off'); }
    setBusy(false);
  }
  return (
    <div className="rp-drill">
      <div className="rp-drill-grid">
        {modules.map((m) => {
          const p = row(agent.id, m.id);
          const s = p?.status ?? 'not_started';
          return (
            <div key={m.id} className={`rp-drill-mod ${s}`}>
              <div className="rp-drill-mtitle">M{m.idx} · {m.title}</div>
              <div className="rp-drill-mline">
                {s === 'passed'
                  ? <>Passed · {p?.score}% · {fmtDate(p?.passed_at)}</>
                  : s === 'in_progress'
                    ? <>In progress{p?.score != null ? ` · last attempt ${p.score}%` : ''}</>
                    : 'Not started'}
              </div>
            </div>
          );
        })}
        <div className={`rp-drill-mod ${sim.passed ? 'passed' : sim.tries > 0 ? 'in_progress' : ''}`}>
          <div className="rp-drill-mtitle">🎙 The Final · Live Sim</div>
          <div className="rp-drill-mline">
            {sim.passed
              ? <>Passed · best {sim.best}% · {sim.tries} {sim.tries === 1 ? 'call' : 'calls'}</>
              : sim.tries > 0
                ? <>Attempting · best {sim.best ?? '—'}% · {sim.tries} {sim.tries === 1 ? 'call' : 'calls'}</>
                : 'No practice calls yet'}
          </div>
        </div>
      </div>
      <div className="rp-drill-foot">
        {signed
          ? <span className="rp-signed">Certification signed off ✓</span>
          : (
            <button className="rp-signoff" disabled={!certReady || busy} onClick={signOff} title={!certReady ? 'Enabled once every module AND the Live Sim are passed' : ''}>
              {busy ? 'Signing…' : certReady ? 'Sign off certification' : pct === 100 ? 'Sign off (Live Sim pending)' : `Sign off (at ${pct}%)`}
            </button>
          )}
        {err && <span className="rp-err">{err}</span>}
      </div>
    </div>
  );
}

/* ---- Per-agent access control: mint an invite/re-invite login link and copy it. ---- */
function InviteCell({ agent }: { agent: RepAgent }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function go() {
    if (busy || !agent.email) return;
    setBusy(true); setMsg('');
    try {
      const { link } = await inviteAgent(agent.id);
      try { await navigator.clipboard.writeText(link); setMsg('Link copied'); }
      catch { setMsg('Link ready'); window.prompt('Copy this invite link:', link); }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  if (!agent.email) return <span className="rp-invite-msg">no email</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button className={`rp-invite${agent.invited ? ' ok' : ''}`} onClick={go} disabled={busy}>
        {busy ? '…' : agent.invited ? 'Re-invite' : 'Invite'}
      </button>
      {msg && <span className="rp-invite-msg">{msg}</span>}
    </span>
  );
}
