import { useEffect, useState } from 'react';
import { loadRep, inviteAgent, signOffAgent, simScenarios, type RepData, type RepAgent, type RepProgressRow, type RepModule, type CourseModule, type SimScenario } from '../lib/api';
import { Lesson, SimView } from './AgentCourse';
import { TruLogo } from '../components/TruLogo';

const initials = (name: string) => name.split(' ').map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function Rep({ org, onHome }: { org: { id: string; name: string }; onHome?: () => void }) {
  const [data, setData] = useState<RepData | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [preview, setPreview] = useState<RepModule | null>(null);
  const [simTest, setSimTest] = useState(false);
  const [sims, setSims] = useState<{ configured: boolean; scenarios: SimScenario[] }>({ configured: false, scenarios: [] });

  const refresh = () => loadRep().then(setData);
  useEffect(() => { void refresh(); void simScenarios().then(setSims); }, []);
  if (!data) return <div className="center-wrap"><div className="spinner" /></div>;

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

  const { modules, progress, agents, practice } = data;
  const simBest = (agentId: string) => practice.filter((p) => p.agent_id === agentId && p.score != null)
    .reduce<number | null>((b, p) => (b == null || (p.score as number) > b ? p.score : b), null);
  const simPassed = (agentId: string) => practice.some((p) => p.agent_id === agentId && p.passed);
  const simTries = (agentId: string) => practice.filter((p) => p.agent_id === agentId).length;
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
  const teamCert = agents.length ? Math.round((agents.filter((a) => pct(a.id) === 100).length / agents.length) * 100) : 0;

  return (
    <div className="hq">
      <header className="topbar">
        <TruLogo size={30} wordSize={22} sub="Rep" />
        <div className="topbar-right">
          {onHome && <button className="link small" onClick={onHome}>‹ TRU HQ</button>}
          <span className="muted small">{org.name}</span>
        </div>
      </header>
      <main className="hq-main">
        <div className="hq-hero fu">
          <div className="eyebrow" style={{ color: '#2f6bb0' }}>Make it stick</div>
          <h1>Onboarding & certification</h1>
          <p>Certify every agent on the program — the Preferred standards, the required pipeline, real scripts and practice drills, and a server-graded quiz to pass on every module. Agents sign in with their own login; you invite, watch progress, and sign off here.</p>
        </div>

        <div className="grid4" style={{ marginBottom: 20 }}>
          <div className="card kpi fu"><span className="accent" style={{ background: '#2f6bb0' }} /><div className="big">{modules.length}</div><div className="lbl">Modules</div></div>
          <div className="card kpi fu"><span className="accent" style={{ background: '#a9791f' }} /><div className="big">{modules.reduce((s, m) => s + m.questions, 0)}</div><div className="lbl">Quiz questions</div></div>
          <div className="card kpi fu"><span className="accent" style={{ background: '#2e8b57' }} /><div className="big">{agents.length}</div><div className="lbl">Agents</div></div>
          <div className="card kpi fu"><span className="accent" style={{ background: '#8f6416' }} /><div className="big">{teamCert}%</div><div className="lbl">Fully certified</div></div>
        </div>

        {/* Curriculum */}
        <div className="card fu" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 className="ch">The curriculum</h3>
            <button className="btn small" onClick={() => setSimTest(true)} title="Take a practice call yourself — real call, real grade, nothing recorded">
              🎙 Test the Live Sim
            </button>
          </div>
          {modules.map((m) => {
            const openable = !!m.cards?.length;
            return (
              <div key={m.id} className="repmod">
                <div className="repmod-head" onClick={() => openable && setPreview(m)} style={openable ? undefined : { cursor: 'default' }}>
                  <span className="repmod-idx">{m.idx}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="repmod-title">{m.title}</div>
                    <div className="muted small">{m.summary}</div>
                  </div>
                  <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{m.cards?.length ?? 0} screens · {m.questions} Q · pass {m.pass_pct}%</span>
                  {openable && <span className="btn small ghost" style={{ whiteSpace: 'nowrap' }}>Preview ›</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Team progress */}
        <div className="card tcard fu">
          <div className="thead"><h3 className="ch" style={{ margin: 0 }}>Team progress</h3></div>
          {agents.length === 0 ? (
            <div className="muted small" style={{ padding: 20 }}>No agents yet — invite your team in Coach and they'll appear here.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Agent</th>
                    {modules.map((m) => <th key={m.id} title={m.title}>M{m.idx}</th>)}
                    <th>Certified</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <AgentRows
                      key={a.id}
                      agent={a}
                      modules={modules}
                      row={row}
                      pct={pct(a.id)}
                      signed={isSigned(a.id)}
                      sim={{ best: simBest(a.id), passed: simPassed(a.id), tries: simTries(a.id) }}
                      open={openAgent === a.id}
                      onToggle={() => setOpenAgent(openAgent === a.id ? null : a.id)}
                      onSigned={() => void refresh()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="muted small" style={{ padding: '12px 20px 4px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><span className="repdot passed" /> Passed</span>
            <span><span className="repdot in_progress" /> In progress</span>
            <span><span className="repdot not_started" /> Not started</span>
          </div>
        </div>

        <div className="muted small" style={{ margin: '14px 2px 0' }}>
          <b>How it works:</b> hit <b>Invite</b> to send an agent their login. They set a password, take each module, and pass its quiz (80%) — their progress fills in above. Quizzes are graded server-side, so a pass is real.
        </div>
      </main>
    </div>
  );
}

// One agent: the matrix row, plus an expandable module-by-module drill-down
// with the certification sign-off.
function AgentRows({ agent, modules, row, pct, signed, sim, open, onToggle, onSigned }: {
  agent: RepAgent;
  modules: RepData['modules'];
  row: (agentId: string, moduleId: string) => RepProgressRow | undefined;
  pct: number;
  signed: boolean;
  sim: { best: number | null; passed: boolean; tries: number };
  open: boolean;
  onToggle: () => void;
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
    <>
      <tr className="reprow" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td><span className="cell-agent"><span className="av-sm">{initials(agent.name)}</span>{agent.name}{signed && <span className="pill pill-ok" style={{ marginLeft: 8 }} title="Certification signed off">Signed ✓</span>}</span></td>
        {modules.map((m) => {
          const s = row(agent.id, m.id)?.status ?? 'not_started';
          return <td key={m.id}><span className={`repdot ${s}`} title={s.replace('_', ' ')} /></td>;
        })}
        <td><span className={`pill ${pct === 100 ? 'pill-ok' : pct > 0 ? 'pill-warn' : 'pill-bad'}`}>{pct}%</span></td>
        <td onClick={(e) => e.stopPropagation()}><InviteCell agent={agent} /></td>
      </tr>
      {open && (
        <tr className="repdetail">
          <td colSpan={modules.length + 3}>
            <div className="repdetail-grid">
              {modules.map((m) => {
                const p = row(agent.id, m.id);
                const s = p?.status ?? 'not_started';
                return (
                  <div key={m.id} className={`repdetail-mod ${s}`}>
                    <div className="repdetail-title">M{m.idx} · {m.title}</div>
                    <div className="repdetail-line">
                      {s === 'passed'
                        ? <>Passed · {p?.score}% · {fmtDate(p?.passed_at)}</>
                        : s === 'in_progress'
                          ? <>In progress{p?.score != null ? ` · last attempt ${p.score}%` : ''}</>
                          : 'Not started'}
                    </div>
                  </div>
                );
              })}
              <div className={`repdetail-mod ${sim.passed ? 'passed' : sim.tries > 0 ? 'in_progress' : 'not_started'}`}>
                <div className="repdetail-title">🎙 The Final · Live Sim</div>
                <div className="repdetail-line">
                  {sim.passed
                    ? <>Passed · best {sim.best}% · {sim.tries} {sim.tries === 1 ? 'call' : 'calls'}</>
                    : sim.tries > 0
                      ? <>Attempting · best {sim.best ?? '—'}% · {sim.tries} {sim.tries === 1 ? 'call' : 'calls'}</>
                      : 'No practice calls yet'}
                </div>
              </div>
            </div>
            <div className="repdetail-foot">
              {signed
                ? <span className="muted small">Certification signed off ✓</span>
                : (
                  <button className="btn small" disabled={!certReady || busy} onClick={signOff} title={!certReady ? 'Enabled once every module AND the Live Sim are passed' : ''}>
                    {busy ? 'Signing…' : certReady ? 'Sign off certification' : pct === 100 ? 'Sign off (Live Sim pending)' : `Sign off (at ${pct}%)`}
                  </button>
                )}
              {err && <span className="err" style={{ margin: 0 }}>{err}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Per-agent access control: mint an invite/re-invite login link and copy it.
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
  if (!agent.email) return <span className="muted small">no email</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {agent.invited && <span className="pill pill-ok" title="Login created">Active</span>}
      <button className="btn small ghost" onClick={go} disabled={busy}>
        {busy ? '…' : agent.invited ? 'Re-invite' : 'Invite'}
      </button>
      {msg && <span className="muted small">{msg}</span>}
    </span>
  );
}
