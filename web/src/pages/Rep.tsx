import { useEffect, useRef, useState } from 'react';
import {
  loadRep, inviteAgent, signOffAgent, simScenarios, signOutClean, myOrgRole,
  loadRepCustomModules, loadRepQuestionsMasked, loadRepQuestionsForEdit, uploadRepMedia, saveRepModule, saveRepQuestions, archiveRepModule,
  type RepData, type RepAgent, type RepProgressRow, type RepModule, type CourseModule, type SimScenario, type LessonCard,
} from '../lib/api';
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

/* ---- Preview-only card coercion: an uploaded `t:'media'` asset renders for
   real in the learner course (Block 4 — signed playback/PDF/slide viewer).
   Until that ships, the leader's preview here degrades it to a plain chip so
   the walkthrough never shows a blank screen or crashes on an unknown type. ---- */
function previewCards(cards: LessonCard[] | null | undefined): LessonCard[] {
  return (cards ?? []).map((c) => {
    if (c.t !== 'media') return c;
    const kindLabel = c.kind ? c.kind.toUpperCase() : 'FILE';
    return { t: 'callout', body: `📎 ${kindLabel} attached — “${c.title || c.path || 'untitled'}”. Renders for agents once the media player ships.` };
  });
}

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
  const [role, setRole] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const refresh = () => loadRep().then(setData);
  useEffect(() => { void refresh(); void simScenarios().then(setSims); }, []);
  useEffect(() => { void myOrgRole(org.id).then(setRole); }, [org.id]);
  useReveal([data, simTest, preview], canvasRef.current);

  // "Manage modules" — reuses the memberships.role signal, the exact same
  // gate the Worker enforces server-side (isOrgLeaderOrAdmin) on every
  // authoring write. A plain 'coach' member never sees the entry point,
  // though the Worker is still the real authority if this check is bypassed.
  const canAuthor = role === 'admin' || role === 'leader';

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
      cards: previewCards(preview.cards),
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
                  {canAuthor && (
                    <button
                      className="rp-preview"
                      onClick={() => setManage(true)}
                      title="Author, publish, or archive your org's own training modules"
                    >
                      🛠 Manage modules
                    </button>
                  )}
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

      {/* Authoring overlay — same fixed/backdrop idiom as Coach's AddAgentsModal
          (this app's one existing modal), re-themed to the tru-dark tokens Rep
          already uses. Sits ON TOP of the dashboard so closing it never loses
          the roster/search state above. */}
      {manage && canAuthor && (
        <ModuleManager
          org={org}
          onClose={() => setManage(false)}
          onPreview={(m) => setPreview(m)}
        />
      )}
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

/* ============================================================
   MODULE MANAGER — the leader's authoring surface: list of the
   org's own source='custom' modules (any status), + New/Edit/
   Publish-Unpublish/Archive. An overlay on top of the dashboard
   (same fixed-backdrop idiom as Coach's AddAgentsModal), so it
   never disturbs the roster/search state underneath.
   ============================================================ */
function ModuleManager({ org, onClose, onPreview }: {
  org: { id: string; name: string };
  onClose: () => void;
  onPreview: (m: RepModule) => void;
}) {
  const [mods, setMods] = useState<RepModule[] | null>(null);
  const [editing, setEditing] = useState<RepModule | 'new' | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () =>
    loadRepCustomModules(org.id)
      .then(setMods)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load your modules'));
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [org.id]);

  async function toggleStatus(m: RepModule) {
    if (busyId) return;
    setBusyId(m.id); setErr('');
    try {
      await saveRepModule({
        id: m.id, org_id: org.id, title: m.title, summary: m.summary,
        cards: m.cards ?? [], pass_pct: m.pass_pct,
        status: m.status === 'published' ? 'draft' : 'published',
      });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update status');
    }
    setBusyId(null);
  }

  async function doArchive(m: RepModule) {
    if (busyId) return;
    setBusyId(m.id); setErr('');
    try { await archiveRepModule(m.id); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not archive module'); }
    setBusyId(null);
  }

  if (editing !== null) {
    return (
      <ModuleEditor
        orgId={org.id}
        module={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void refresh(); }}
      />
    );
  }

  return (
    <div className="rp-mgmt-overlay" role="dialog" aria-modal="true" aria-label="Manage custom modules" onClick={onClose}>
      <div className="rp-mgmt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rp-mgmt-head">
          <div className="panel-head" style={{ margin: 0 }}>
            <h3>Manage custom modules</h3>
            <span className="panel-sub">{org.name}’s own training — draft it, publish it, retire it.</span>
          </div>
          <div className="rp-mgmt-headbtns">
            <button className="rp-preview" onClick={() => setEditing('new')}>+ New module</button>
            <button className="rp-invite" onClick={onClose}>Close</button>
          </div>
        </div>

        {err && <div className="rp-err" style={{ margin: '0 0 12px' }}>{err}</div>}

        {!mods ? (
          <div className="rp-empty">Loading…</div>
        ) : mods.length === 0 ? (
          <div className="rp-empty">No custom modules yet — hit “New module” to author your first one.</div>
        ) : (
          <div className="rp-mgmt-list">
            {mods.map((m) => (
              <div key={m.id} className="rp-mgmt-row">
                <div className="rp-mgmt-row-main">
                  <span className={`rp-mgmt-badge st-${m.status ?? 'draft'}`}>{m.status ?? 'draft'}</span>
                  <span className="rp-mgmt-title">{m.title}</span>
                  <span className="rp-mgmt-meta">{m.cards?.length ?? 0} screen{(m.cards?.length ?? 0) === 1 ? '' : 's'}</span>
                </div>
                <div className="rp-mgmt-row-actions">
                  <button className="rp-invite" disabled={!m.cards?.length} onClick={() => onPreview(m)} title={m.cards?.length ? 'Walk this module' : 'Add at least one screen to preview'}>Preview</button>
                  <button className="rp-invite" onClick={() => setEditing(m)}>Edit</button>
                  {m.status !== 'archived' && (
                    <button className="rp-invite" disabled={busyId === m.id} onClick={() => void toggleStatus(m)}>
                      {busyId === m.id ? '…' : m.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                  )}
                  {m.status !== 'archived' && (
                    <button className="rp-invite" disabled={busyId === m.id} onClick={() => void doArchive(m)}>
                      {busyId === m.id ? '…' : 'Archive'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- one authored quiz question, before it's saved (answer index only
   meaningful once the leader has actively confirmed it — see `unresolved`). ---- */
type QDraft = { prompt: string; choices: string[]; answer: number; explain: string; unresolved?: boolean };

const CARD_KINDS = ['text', 'callout', 'script', 'steps', 'video'] as const;
type AddableCardKind = (typeof CARD_KINDS)[number];
const CARD_KIND_LABEL: Record<AddableCardKind, string> = {
  text: 'Text', callout: 'Callout', script: 'Script', steps: 'Steps', video: 'Video (URL)',
};
function blankCard(t: AddableCardKind): LessonCard {
  switch (t) {
    case 'text': return { t: 'text', body: '' };
    case 'callout': return { t: 'callout', body: '' };
    case 'script': return { t: 'script', title: '', lines: [''] };
    case 'steps': return { t: 'steps', title: '', steps: [''] };
    case 'video': return { t: 'video', title: '', url: '', body: '' };
  }
}
function mediaKindOf(fileName: string): 'video' | 'pdf' | 'slide' {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'slide';
}

/* ============================================================
   MODULE EDITOR — title/summary/pass%, the card builder (text,
   callout, script, steps, video, + uploaded media), the quiz
   editor, and a live preview reusing AgentCourse's Lesson. Save
   flow: save the module first (needs its id), THEN replace its
   quiz questions — matches saveRepQuestions's delete-all+insert
   semantics, which requires an existing module id.
   ============================================================ */
function ModuleEditor({ orgId, module, onClose, onSaved }: {
  orgId: string;
  module: RepModule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(module?.title ?? '');
  const [summary, setSummary] = useState(module?.summary ?? '');
  const [passPct, setPassPct] = useState(module?.pass_pct ?? 80);
  const [cards, setCards] = useState<LessonCard[]>(module?.cards ? [...module.cards] : []);
  const [questions, setQuestions] = useState<QDraft[]>([]);
  const [qLoading, setQLoading] = useState(!!module);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [busy, setBusy] = useState<'draft' | 'published' | null>(null);
  const [err, setErr] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Existing quiz: the real answer/explain, via the leader-only /answers route
  // (Block 4) — no more re-confirm-every-answer friction. Falls back to the old
  // masked load (prompts/choices only, answer re-confirm required) if that route
  // ever fails, so a hiccup degrades gracefully instead of crashing the editor.
  useEffect(() => {
    if (!module) { setQLoading(false); return; }
    let alive = true;
    loadRepQuestionsForEdit(module.id)
      .then((qs) => {
        if (!alive) return;
        setQuestions(qs.map((q) => ({ prompt: q.prompt, choices: [...q.choices], answer: q.answer, explain: q.explain ?? '' })));
      })
      .catch(() =>
        loadRepQuestionsMasked(module.id)
          .then((qs) => {
            if (!alive) return;
            setQuestions(qs.map((q) => ({ prompt: q.prompt, choices: [...q.choices], answer: 0, explain: '', unresolved: true })));
          })
          .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Could not load the existing quiz'); }),
      )
      .finally(() => { if (alive) setQLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module?.id]);

  function addCard(t: AddableCardKind) { setCards((c) => [...c, blankCard(t)]); }
  function updateCard(i: number, patch: Partial<LessonCard>) {
    setCards((c) => c.map((card, ci) => (ci === i ? { ...card, ...patch } : card)));
  }
  function removeCard(i: number) { setCards((c) => c.filter((_, ci) => ci !== i)); }
  function moveCard(i: number, dir: -1 | 1) {
    setCards((c) => {
      const j = i + dir;
      if (j < 0 || j >= c.length) return c;
      const next = [...c];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setUploading(true); setUploadErr('');
    try {
      const path = await uploadRepMedia(file, orgId);
      setCards((c) => [...c, { t: 'media', kind: mediaKindOf(file.name), path, title: file.name }]);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function addQuestion() { setQuestions((qs) => [...qs, { prompt: '', choices: ['', ''], answer: 0, explain: '' }]); }
  function removeQuestion(i: number) { setQuestions((qs) => qs.filter((_, qi) => qi !== i)); }
  function updateQuestion(i: number, patch: Partial<QDraft>) {
    setQuestions((qs) => qs.map((q, qi) => (qi === i ? { ...q, ...patch, unresolved: false } : q)));
  }
  function addChoice(i: number) {
    setQuestions((qs) => qs.map((q, qi) => (qi === i ? { ...q, choices: [...q.choices, ''] } : q)));
  }
  function setChoiceText(i: number, ci: number, val: string) {
    setQuestions((qs) => qs.map((q, qi) => (qi === i ? { ...q, choices: q.choices.map((c, x) => (x === ci ? val : c)) } : q)));
  }
  function removeChoice(i: number, ci: number) {
    setQuestions((qs) => qs.map((q, qi) => {
      if (qi !== i) return q;
      const choices = q.choices.filter((_, x) => x !== ci);
      const answer = q.answer === ci ? 0 : q.answer > ci ? q.answer - 1 : q.answer;
      return { ...q, choices, answer };
    }));
  }
  function markCorrect(i: number, ci: number) { updateQuestion(i, { answer: ci }); }
  function moveQuestion(i: number, dir: -1 | 1) {
    setQuestions((qs) => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const hasUnresolved = questions.some((qq) => qq.unresolved);
  const questionsValid = questions.length > 0 && questions.every((qq) => qq.prompt.trim() && qq.choices.filter((c) => c.trim()).length >= 2);
  const canPublish = title.trim().length > 0 && questionsValid && !hasUnresolved;

  async function handleSave(status: 'draft' | 'published') {
    if (busy || qLoading) return;
    setErr('');
    if (!title.trim()) { setErr('Give the module a title first.'); return; }
    if (status === 'published' && !canPublish) {
      setErr(hasUnresolved
        ? 'Re-confirm the correct answer on every carried-over question before publishing.'
        : 'Add at least one quiz question (with 2+ filled-in choices) before publishing.');
      return;
    }
    setBusy(status);
    try {
      const saved = await saveRepModule({
        id: module?.id, org_id: orgId, title: title.trim(), summary: summary.trim() || null,
        cards, pass_pct: passPct, status,
      });
      if (questions.length) {
        await saveRepQuestions(saved.id, questions.map((qq, i) => ({
          prompt: qq.prompt.trim(), choices: qq.choices.map((c) => c.trim()), answer: qq.answer,
          explain: qq.explain.trim() || null, idx: i + 1,
        })));
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save module');
    } finally {
      setBusy(null);
    }
  }

  // Live preview — an in-progress draft, not yet necessarily saved. Kept as
  // LOCAL state (not the top-level Rep `preview`) specifically so opening it
  // never unmounts this editor and loses unsaved card/quiz edits.
  if (previewing) {
    const draft: CourseModule = {
      id: module?.id ?? 'draft', idx: module?.idx ?? 0, title: title || 'Untitled module',
      summary: summary || null, body: null, pass_pct: passPct, questions: questions.length,
      cards: previewCards(cards), qs: [], status: 'not_started', score: null, passed_at: null, signed: false,
    };
    return <Lesson module={draft} onBack={() => setPreviewing(false)} onDone={() => setPreviewing(false)} doneLabel="End of module preview" />;
  }

  return (
    <div className="rp-mgmt-overlay" role="dialog" aria-modal="true" aria-label={module ? 'Edit module' : 'New module'}>
      <div className="rp-mgmt-panel rp-editor">
        <div className="rp-mgmt-head">
          <div className="panel-head" style={{ margin: 0 }}>
            <h3>{module ? 'Edit module' : 'New module'}</h3>
            <span className="panel-sub">Build it like the real curriculum — screens, then a quiz.</span>
          </div>
          <div className="rp-mgmt-headbtns">
            <button className="rp-invite" disabled={!cards.length} onClick={() => setPreviewing(true)} title={cards.length ? 'Walk this draft' : 'Add a screen to preview'}>Preview</button>
            <button className="rp-invite" onClick={onClose}>Cancel</button>
          </div>
        </div>

        <div className="rp-editor-body">
          <div className="rp-editor-field">
            <label>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Our objection playbook" />
          </div>
          <div className="rp-editor-field">
            <label>Summary</label>
            <input type="text" value={summary ?? ''} onChange={(e) => setSummary(e.target.value)} placeholder="One line — shown on the journey card" />
          </div>
          <div className="rp-editor-field rp-editor-field-sm">
            <label>Pass %</label>
            <input type="number" min={1} max={100} value={passPct} onChange={(e) => setPassPct(Math.max(1, Math.min(100, Number(e.target.value) || 0)))} />
          </div>

          <div className="rp-editor-section">
            <div className="rp-editor-section-head">
              <h4>Screens</h4>
              <div className="rp-editor-addrow">
                {CARD_KINDS.map((k) => (
                  <button key={k} className="rp-invite" type="button" onClick={() => addCard(k)}>+ {CARD_KIND_LABEL[k]}</button>
                ))}
                <button className="rp-invite" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Uploading…' : '+ Upload media'}
                </button>
                <input ref={fileRef} type="file" style={{ display: 'none' }} accept="video/*,.pdf,.ppt,.pptx,.key,.odp" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            {uploadErr && <div className="rp-err">{uploadErr}</div>}

            {cards.length === 0 ? (
              <div className="rp-empty">No screens yet — add one above.</div>
            ) : (
              <div className="rp-cardlist">
                {cards.map((c, i) => (
                  <CardEditorRow
                    key={i}
                    card={c}
                    onChange={(patch) => updateCard(i, patch)}
                    onRemove={() => removeCard(i)}
                    onMove={(dir) => moveCard(i, dir)}
                    canMoveUp={i > 0}
                    canMoveDown={i < cards.length - 1}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rp-editor-section">
            <div className="rp-editor-section-head">
              <h4>Quiz</h4>
              <button className="rp-invite" type="button" onClick={addQuestion}>+ Question</button>
            </div>
            {qLoading ? (
              <div className="rp-empty">Loading existing quiz…</div>
            ) : questions.length === 0 ? (
              <div className="rp-empty">No questions yet — a module needs at least one to publish.</div>
            ) : (
              <div className="rp-qlist">
                {questions.map((qq, i) => (
                  <div key={i} className={`rp-qrow${qq.unresolved ? ' unresolved' : ''}`}>
                    <div className="rp-qrow-top">
                      <span className="rp-qrow-n">Q{i + 1}</span>
                      <input type="text" value={qq.prompt} onChange={(e) => updateQuestion(i, { prompt: e.target.value })} placeholder="Question prompt" style={{ flex: 1 }} />
                      <button className="rp-invite" type="button" disabled={i === 0} onClick={() => moveQuestion(i, -1)}>↑</button>
                      <button className="rp-invite" type="button" disabled={i === questions.length - 1} onClick={() => moveQuestion(i, 1)}>↓</button>
                      <button className="rp-invite" type="button" onClick={() => removeQuestion(i)}>Remove</button>
                    </div>
                    {qq.unresolved && (
                      <div className="rp-qrow-warn">Re-confirm the correct answer — saved answers aren’t sent back to the browser, so it must be re-marked.</div>
                    )}
                    <div className="rp-qchoices">
                      {qq.choices.map((c, ci) => (
                        <div key={ci} className="rp-qchoice">
                          <label className="rp-qchoice-mark" title="Mark as the correct answer">
                            <input type="radio" name={`q${i}-answer`} checked={qq.answer === ci} onChange={() => markCorrect(i, ci)} />
                          </label>
                          <input type="text" value={c} onChange={(e) => setChoiceText(i, ci, e.target.value)} placeholder={`Choice ${ci + 1}`} style={{ flex: 1 }} />
                          <button className="rp-invite" type="button" disabled={qq.choices.length <= 2} onClick={() => removeChoice(i, ci)}>✕</button>
                        </div>
                      ))}
                      <button className="rp-invite" type="button" onClick={() => addChoice(i)}>+ Choice</button>
                    </div>
                    <input type="text" value={qq.explain} onChange={(e) => updateQuestion(i, { explain: e.target.value })} placeholder="Explain the correct answer (optional)" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && <div className="rp-err">{err}</div>}
        </div>

        <div className="rp-editor-foot">
          <button className="rp-invite" disabled={busy !== null} onClick={() => void handleSave('draft')}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
          <button className="rp-signoff" disabled={busy !== null || qLoading} onClick={() => void handleSave('published')}>{busy === 'published' ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- one row of the card builder — a tiny type-specific mini-form. ---- */
function CardEditorRow({ card, onChange, onRemove, onMove, canMoveUp, canMoveDown }: {
  card: LessonCard;
  onChange: (patch: Partial<LessonCard>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const head = (
    <div className="rp-cardrow-head">
      <span className="rp-cardrow-kind">{card.t}</span>
      <button className="rp-invite" type="button" disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button>
      <button className="rp-invite" type="button" disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button>
      <button className="rp-invite" type="button" onClick={onRemove}>Remove</button>
    </div>
  );

  if (card.t === 'media') {
    return (
      <div className="rp-cardrow">
        {head}
        <div className="rp-cardrow-media">
          📎 <b>{card.kind}</b> · {card.title || card.path}
        </div>
      </div>
    );
  }
  if (card.t === 'text') {
    return (
      <div className="rp-cardrow">
        {head}
        <input type="text" value={card.k ?? ''} onChange={(e) => onChange({ k: e.target.value })} placeholder="Kicker (optional)" />
        <textarea value={card.body ?? ''} onChange={(e) => onChange({ body: e.target.value })} placeholder="Body text — blank line = new paragraph" rows={4} />
      </div>
    );
  }
  if (card.t === 'callout') {
    return (
      <div className="rp-cardrow">
        {head}
        <textarea value={card.body ?? ''} onChange={(e) => onChange({ body: e.target.value })} placeholder="The takeaway" rows={3} />
      </div>
    );
  }
  if (card.t === 'script') {
    return (
      <div className="rp-cardrow">
        {head}
        <input type="text" value={card.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title (optional)" />
        <textarea
          value={(card.lines ?? ['']).join('\n')}
          onChange={(e) => onChange({ lines: e.target.value.split('\n') })}
          placeholder="One line to say per row"
          rows={4}
        />
      </div>
    );
  }
  if (card.t === 'steps') {
    return (
      <div className="rp-cardrow">
        {head}
        <input type="text" value={card.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title (optional)" />
        <textarea
          value={(card.steps ?? ['']).join('\n')}
          onChange={(e) => onChange({ steps: e.target.value.split('\n') })}
          placeholder="One step per row"
          rows={4}
        />
      </div>
    );
  }
  if (card.t === 'video') {
    return (
      <div className="rp-cardrow">
        {head}
        <input type="text" value={card.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title (optional)" />
        <input type="text" value={card.url ?? ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="Loom/YouTube URL" />
        <textarea value={card.body ?? ''} onChange={(e) => onChange({ body: e.target.value })} placeholder="Note under the video (optional)" rows={2} />
      </div>
    );
  }
  return <div className="rp-cardrow">{head}</div>;
}
