import { useEffect, useRef, useState, type ReactNode } from 'react';
import { resolveCohortRoster, submitCohortAssessment, submitOwnAssessment, myAgent } from '../lib/api';
import {
  PERSONAL_QUESTIONS, PRO_QUESTIONS, scorePersonal, scorePro, divergence,
  ARCH, PERSONAL_TYPES, PERSONAL_LABELS, WORK_LABELS,
  type Axis, type AxisResult,
} from '../lib/assessmentData';
import '../truHqDark.css';
import './assess.css';
import { TruLogo } from '../components/TruLogo';
import { Icon } from '../components/hqUi';
import { useForceHqDark } from '../hqHooks';

type Stage = 'pick'|'intro'|'personal'|'personalResult'|'pro'|'proResult'|'register'|'done'|'save';

function isSelfHash(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return q.get('self') === '1';
}

const AXIS_LABEL: Record<Axis, string> = {
  energy: 'Energy', approach: 'Approach', deal: 'Deal Style', decision: 'Decisions',
};

const AXIS_ORDER: Axis[] = ['energy', 'approach', 'deal', 'decision'];

// Dev preview affordance: `#/assess?preview=1` skips the roster fetch and the
// name-pick gate entirely, starting a synthetic agent straight at `intro`.
// Never calls submit — submit is Task 7's. Used to iterate on the reveal
// design from screenshots without needing a seeded cohort or a DB round trip.
function isPreviewHash(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return q.get('preview') === '1';
}


/* The internal-page frame — the same .tru-shell / sidebar / topbar Home, Coach
   and Rep use, so the assessment sits inside the product rather than beside it.
   The sidebar carries the two parts and the result instead of the app's tabs:
   an agent is mid-task here and those tabs are gated until they finish. */
const ASSESS_STEPS = ['Part 1 · You', 'Part 2 · Work', 'Your result'];

function AssessShell({ active, eyebrow, title, children }: {
  active: number;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  useForceHqDark();
  return (
    <div className="tru-dark">
      <div className="tru-shell">
        <aside className="side">
          <div className="side-logo"><TruLogo size={28} wordSize={20} sub="HQ" /></div>
          <nav className="side-nav" aria-label="Assessment">
            {ASSESS_STEPS.map((label, n) => (
              <div
                key={label}
                className={`side-link aw-side-step${n === active ? ' active' : ''}${n < active ? ' is-done' : ''}`}
                aria-current={n === active ? 'step' : undefined}
              >
                <Icon name={n < active ? 'shield' : n === active ? 'target' : 'clock'} size={20} />
                <span>{label}</span>
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <div className="aw-side-note">No score, no wrong answers.</div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div>
              <div className="main-eyebrow">{eyebrow}</div>
              <h1>{title}</h1>
            </div>
          </header>
          <div className="hh-canvas">
            <div className="hh-ambient" aria-hidden />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Assess({ token }: { token: string }) {
  const preview = isPreviewHash();
  const self = isSelfHash();
  const [roster, setRoster] = useState<{ id: string; name: string }[] | null>(null);
  const [err, setErr] = useState('');
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(
    preview ? { id: 'preview', name: 'Preview' } : null
  );
  const [stage, setStage] = useState<Stage>(preview || self ? 'intro' : 'pick');

  // Lifted so Task 7's register/done stages can read the finished results.
  const [pAns, setPAns] = useState<number[]>(() => Array(PERSONAL_QUESTIONS.length).fill(0));
  const [bAns, setBAns] = useState<number[]>(() => Array(PRO_QUESTIONS.length).fill(0));
  const [personalResult, setPersonalResult] = useState<AxisResult | null>(null);
  const [proResult, setProResult] = useState<AxisResult | null>(null);

  useEffect(() => {
    if (preview) return; // dev preview: no roster fetch, no DB call.
    if (self) {
      myAgent().then((a) => {
        if (!a) { setErr('Sign in to take your assessment, then come back here.'); return; }
        setAgent({ id: a.id, name: a.name });
        setStage('intro');
      }).catch(() => setErr('Sign in to take your assessment, then come back here.'));
      return;
    }
    setErr('');
    if (!token) { setErr('This link is missing its team code. Ask your team lead for a fresh link.'); return; }
    resolveCohortRoster(token).then(setRoster).catch(() => setErr('This team link could not be opened. Ask your team lead for a fresh link.'));
  }, [token, preview, self]);

  if (!preview && !self) {
    if (err) return <div className="asx-shell tru-dark"><div className="asx-card asx-msg">{err}</div></div>;
    if (!roster) return <div className="asx-shell tru-dark"><div className="spinner" /></div>;
  }
  if (self) {
    if (err) return <div className="asx-shell tru-dark"><div className="asx-card asx-msg">{err}</div></div>;
    if (!agent) return <div className="asx-shell tru-dark"><div className="spinner" /></div>;
  }

  if (stage === 'pick') {
    return (
      <AssessShell active={0} eyebrow="Behavioral assessment" title="Which one is you?">
        <div className="asx-card">
          <div className="asx-eyebrow">TRU · Behavioral Assessment</div>
          <h1 className="asx-h1">Pick your name to begin.</h1>
          <p className="asx-sub">Pick your name to begin. Two quick parts — who you are, then how you work.</p>
          <div className="asx-picklist">
            {(roster ?? []).map((r) => (
              <button key={r.id} className="asx-pick" onClick={() => { setAgent(r); setStage('intro'); }}>{r.name}</button>
            ))}
            {roster && roster.length === 0 && <div className="asx-msg">No one’s been added to coaching for this team yet. Check with your team lead.</div>}
          </div>
        </div>
      </AssessShell>
    );
  }

  if (stage === 'save') {
    return (
      <SaveOwnFlow
        agent={agent!}
        personalResult={personalResult!}
        proResult={proResult!}
        pAns={pAns}
        bAns={bAns}
      />
    );
  }

  if (stage === 'register' || stage === 'done') {
    // personalResult/proResult are guaranteed non-null here — reaching this stage
    // requires having passed through proResult, which sets both.
    return (
      <RegisterFlow
        agent={agent!}
        token={token}
        preview={preview}
        personalResult={personalResult!}
        proResult={proResult!}
        pAns={pAns}
        bAns={bAns}
      />
    );
  }

  return (
    <AssessFlow
      agent={agent!}
      stage={stage}
      setStage={setStage}
      afterPro={self ? 'save' : 'register'}
      pAns={pAns} setPAns={setPAns}
      bAns={bAns} setBAns={setBAns}
      personalResult={personalResult} setPersonalResult={setPersonalResult}
      proResult={proResult} setProResult={setProResult}
    />
  );
}

function AssessFlow({
  agent, stage, setStage, afterPro = 'register',
  pAns, setPAns, bAns, setBAns,
  personalResult, setPersonalResult,
  proResult, setProResult,
}: {
  agent: { id: string; name: string };
  stage: Stage;
  setStage: (s: Stage) => void;
  afterPro?: 'register' | 'save';
  pAns: number[]; setPAns: (a: number[]) => void;
  bAns: number[]; setBAns: (a: number[]) => void;
  personalResult: AxisResult | null; setPersonalResult: (r: AxisResult) => void;
  proResult: AxisResult | null; setProResult: (r: AxisResult) => void;
}) {
  const [pIdx, setPIdx] = useState(0);
  const [bIdx, setBIdx] = useState(0);

  function answerPersonal(v: number) {
    const next = pAns.slice(); next[pIdx] = v; setPAns(next);
    if (pIdx >= PERSONAL_QUESTIONS.length - 1) { setPersonalResult(scorePersonal(next)); setStage('personalResult'); }
    else setPIdx(pIdx + 1);
  }

  function answerPro(idx: number) {
    const next = bAns.slice(); next[bIdx] = idx; setBAns(next);
    if (bIdx >= PRO_QUESTIONS.length - 1) { setProResult(scorePro(next)); setStage('proResult'); }
    else setBIdx(bIdx + 1);
  }

  if (stage === 'intro') {
    return (
      <AssessShell active={0} eyebrow="Behavioral assessment" title={`Hey ${agent.name.split(' ')[0]}.`}>
        <div className="asx-card">
          <div className="asx-eyebrow">TRU · Behavioral Assessment</div>
          <h1 className="asx-h1">Let’s find out how you’re wired.</h1>
          <p className="asx-sub">Two short parts. Part 1 is 20 quick statements about you as a person. Part 2 is 32 work scenarios — how you actually show up on the job. Takes about five minutes total, and there are no wrong answers.</p>
          <button className="asx-cta" onClick={() => setStage('personal')}>Start Part 1 →</button>
        </div>
      </AssessShell>
    );
  }

  if (stage === 'personal') {
    const q = PERSONAL_QUESTIONS[pIdx];
    const pct = Math.round(((pIdx) / PERSONAL_QUESTIONS.length) * 100);
    return (
      <AssessShell active={0} eyebrow="Part 1 of 2 · You as a person" title="Which sounds like you?">
        <div className="asx-card asx-quiz">
          <div className="asx-quiz-top">
            <div className="asx-progress"><span style={{ width: `${pct}%` }} /></div>
            <div className="asx-badge">PART 1 OF 2 · YOU AS A PERSON</div>
            <div className="asx-count">{pIdx + 1} / {PERSONAL_QUESTIONS.length}</div>
          </div>
          <div className="asx-quiz-body" key={pIdx}>
            <h2 className="asx-q">{q.text}</h2>
            <div className="asx-likert-labels"><span>Disagree</span><span>Agree</span></div>
            <div className="asx-scale asx-scale-7">
              {[-3, -2, -1, 0, 1, 2, 3].map((v) => {
                const mag = Math.abs(v);
                const sz = ['asx-sz1', 'asx-sz2', 'asx-sz3', 'asx-sz4'][mag];
                const side = v < 0 ? 'asx-dot-neg' : v > 0 ? 'asx-dot-pos' : 'asx-dot-mid';
                return (
                  <button key={v} className={`asx-dot ${sz} ${side}`}
                    aria-label={v === 0 ? 'Neutral' : v < 0 ? `Disagree ${mag}` : `Agree ${mag}`}
                    onClick={() => answerPersonal(v)} />
                );
              })}
            </div>
          </div>
        </div>
      </AssessShell>
    );
  }

  if (stage === 'personalResult' && personalResult) {
    const type = PERSONAL_TYPES[personalResult.code];
    return (
      <AssessShell active={0} eyebrow="Act one · who you are" title={type.name}>
        <div className="asx-card asx-reveal-card asx-act1" key="act1">
          <div className="asx-act-marker">Act One · Who You Are</div>
          <h1 className="asx-h1">{type.name}</h1>
          <p className="asx-sub">{type.desc}</p>
          <div className="asx-meters">
            {AXIS_ORDER.map((ax, i) => {
              const a = personalResult.axes[ax];
              return (
                <div className="asx-meter-row" key={ax} style={{ ['--mi' as string]: i }}>
                  <div className="asx-meter-label">
                    <span>{AXIS_LABEL[ax]}</span>
                    <span className="asx-meter-val">{PERSONAL_LABELS[a.letter]} · {a.pct}%</span>
                  </div>
                  <div className="asx-meter"><span style={{ width: `${a.pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          <div className="asx-strengths">
            {type.strengths.map((s) => <span className="asx-chip" key={s}>{s}</span>)}
          </div>
          <p className="asx-watch"><strong>Watch for:</strong> {type.watch}</p>
          <button className="asx-cta asx-cta-curtain" onClick={() => setStage('pro')}>Now, how you work →</button>
        </div>
      </AssessShell>
    );
  }

  if (stage === 'pro') {
    const q = PRO_QUESTIONS[bIdx];
    const pct = Math.round(((bIdx) / PRO_QUESTIONS.length) * 100);
    return (
      <AssessShell active={1} eyebrow="Part 2 of 2 · How you work" title="Which sounds more like you?">
        <div className="asx-card asx-quiz">
          <div className="asx-quiz-top">
            <div className="asx-progress"><span style={{ width: `${pct}%` }} /></div>
            <div className="asx-badge">PART 2 OF 2 · HOW YOU WORK</div>
            <div className="asx-count">{bIdx + 1} / {PRO_QUESTIONS.length}</div>
          </div>
          <div className="asx-quiz-body" key={bIdx}>
            <h2 className="asx-q-sub">Which sounds more like you?</h2>
            <div className="asx-diff">
              <div className="asx-diff-labels"><span className="a">{q.a}</span><span className="b">{q.b}</span></div>
              <div className="asx-scale asx-scale-6">
                {[0, 1, 2, 3, 4, 5].map((idx) => {
                  const tier = (idx === 0 || idx === 5) ? 'asx-sz4' : (idx === 1 || idx === 4) ? 'asx-sz3' : 'asx-sz2';
                  const side = idx <= 2 ? 'asx-dot-a' : 'asx-dot-b';
                  return (
                    <button key={idx} className={`asx-dot ${tier} ${side}`}
                      aria-label={idx <= 2 ? `Left option, strength ${3 - idx}` : `Right option, strength ${idx - 2}`}
                      onClick={() => answerPro(idx)} />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </AssessShell>
    );
  }

  if (stage === 'proResult' && personalResult && proResult) {
    const arch = ARCH[proResult.code];
    const divergentAxes = divergence(personalResult, proResult);
    return (
      <AssessShell active={2} eyebrow="Act two · how you work" title={arch.name}>
        <div className="asx-card asx-reveal-card asx-act2" key="act2" style={{ ['--arch' as string]: arch.color }}>
          <div className="asx-act-marker">Act Two · How You Work</div>
          <div className="asx-medallion"><span>{arch.emoji}</span></div>
          <h1 className="asx-h1">{arch.name}</h1>
          <p className="asx-sub">{arch.tagline}</p>
          <div className="asx-meters">
            {AXIS_ORDER.map((ax, i) => {
              const a = proResult.axes[ax];
              return (
                <div className="asx-meter-row" key={ax} style={{ ['--mi' as string]: i }}>
                  <div className="asx-meter-label">
                    <span>{AXIS_LABEL[ax]}</span>
                    <span className="asx-meter-val">{WORK_LABELS[a.letter]} · {a.pct}%</span>
                  </div>
                  <div className="asx-meter"><span style={{ width: `${a.pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          {divergentAxes.length > 0 && (
            <div className="asx-divergence">
              <div className="asx-divergence-head">Where Work Stretches You</div>
              {divergentAxes.map((ax) => (
                <p className="asx-diverge-line" key={ax}>
                  In life you're <strong>{PERSONAL_LABELS[personalResult.axes[ax].letter]}</strong>, but at work you show up <strong>{WORK_LABELS[proResult.axes[ax].letter]}</strong>.
                </p>
              ))}
            </div>
          )}
          <button className="asx-cta" onClick={() => setStage(afterPro)}>See your full result →</button>
        </div>
      </AssessShell>
    );
  }

  return <div className="asx-shell tru-dark"><div className="spinner" /></div>;
}

function SaveOwnFlow({
  agent, personalResult, proResult, pAns, bAns,
}: {
  agent: { id: string; name: string };
  personalResult: AxisResult;
  proResult: AxisResult;
  pAns: number[];
  bAns: number[];
}) {
  const submitted = useRef(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    const tallies = {
      energy_p: proResult.axes.energy.letter === 'P' ? proResult.axes.energy.pct : 100 - proResult.axes.energy.pct,
      energy_t: proResult.axes.energy.letter === 'T' ? proResult.axes.energy.pct : 100 - proResult.axes.energy.pct,
      approach_pro: proResult.axes.approach.letter === 'Pro' ? proResult.axes.approach.pct : 100 - proResult.axes.approach.pct,
      approach_rec: proResult.axes.approach.letter === 'Rec' ? proResult.axes.approach.pct : 100 - proResult.axes.approach.pct,
      deal_r: proResult.axes.deal.letter === 'R' ? proResult.axes.deal.pct : 100 - proResult.axes.deal.pct,
      deal_v: proResult.axes.deal.letter === 'V' ? proResult.axes.deal.pct : 100 - proResult.axes.deal.pct,
      decision_d: proResult.axes.decision.letter === 'D' ? proResult.axes.decision.pct : 100 - proResult.axes.decision.pct,
      decision_i: proResult.axes.decision.letter === 'I' ? proResult.axes.decision.pct : 100 - proResult.axes.decision.pct,
    };
    submitOwnAssessment({
      agentId: agent.id,
      personalCode: personalResult.code,
      personalAxes: personalResult.axes,
      businessCode: proResult.code,
      tallies,
      answers: { personal: pAns, pro: bAns },
    }).then(() => { window.location.hash = '/coach'; })
      .catch(() => setErr('Your result didn’t save — try again from Coach.'));
  }, []);
  if (err) {
    return (
      <div className="asx-shell tru-dark">
        <div className="asx-card asx-msg">{err}</div>
      </div>
    );
  }
  return <div className="asx-shell tru-dark"><div className="spinner" /></div>;
}

// ── Task 7: gated submit + registration ─────────────────────────────────────
// Mounted only when stage is 'register'/'done'. Fires the cohort-assessment
// write exactly once on mount (ref-guarded — React StrictMode double-invokes
// effects in dev), then renders the email/password registration form and the
// final "you're in" screen. In `?preview=1` this NEVER touches the backend:
// no submit_cohort_assessment RPC — it just walks the screens.
//
// It used to end with an email/password form calling auth.signUp. That was a
// second front door into the product: anyone could create a login with any
// address, and claim_agent() would bind it to whichever agents row shared that
// email. There is one front door now, and it is the invite from a team lead.
function RegisterFlow({
  agent, token, preview, personalResult, proResult, pAns, bAns,
}: {
  agent: { id: string; name: string };
  token: string;
  preview: boolean;
  personalResult: AxisResult;
  proResult: AxisResult;
  pAns: number[];
  bAns: number[];
}) {
  const submitted = useRef(false);
  const [submitErr, setSubmitErr] = useState('');

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    if (preview) return; // design walk-through only — never hits the DB.
    const tallies = {
      energy_p: proResult.axes.energy.letter === 'P' ? proResult.axes.energy.pct : 100 - proResult.axes.energy.pct,
      energy_t: proResult.axes.energy.letter === 'T' ? proResult.axes.energy.pct : 100 - proResult.axes.energy.pct,
      approach_pro: proResult.axes.approach.letter === 'Pro' ? proResult.axes.approach.pct : 100 - proResult.axes.approach.pct,
      approach_rec: proResult.axes.approach.letter === 'Rec' ? proResult.axes.approach.pct : 100 - proResult.axes.approach.pct,
      deal_r: proResult.axes.deal.letter === 'R' ? proResult.axes.deal.pct : 100 - proResult.axes.deal.pct,
      deal_v: proResult.axes.deal.letter === 'V' ? proResult.axes.deal.pct : 100 - proResult.axes.deal.pct,
      decision_d: proResult.axes.decision.letter === 'D' ? proResult.axes.decision.pct : 100 - proResult.axes.decision.pct,
      decision_i: proResult.axes.decision.letter === 'I' ? proResult.axes.decision.pct : 100 - proResult.axes.decision.pct,
    };
    submitCohortAssessment({
      token, agentId: agent.id, personalCode: personalResult.code, personalAxes: personalResult.axes,
      businessCode: proResult.code, tallies, answers: { personal: pAns, pro: bAns },
    }).catch(() => setSubmitErr('Your result didn’t save — refresh and try again, or ask your team lead for a fresh link.'));
    // Fire once on mount; deps intentionally omitted (values are stable for the
    // lifetime of this mount, and the ref guard prevents a second fire anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="asx-shell tru-dark">
      <div className="asx-card asx-reveal-card">
        <div className="asx-eyebrow">TRU · Behavioral Assessment</div>
        <h1 className="asx-h1">You’re done.</h1>
        <p className="asx-sub">
          Your team lead has your profile. If you have an HQ login, your result is
          waiting on your Coach tab — and if you don’t, your team lead can send you one.
        </p>
        {submitErr && <div className="asx-form-err">{submitErr}</div>}
        <a className="asx-cta asx-cta-link" href="https://app.truhq.co">Go to app.truhq.co →</a>
      </div>
    </div>
  );
}
