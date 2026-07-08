import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import {
  loadCourse, gradeQuiz, isDemo, simScenarios, simStart, simFinish, demoSimResult, mySimAttempts, signOutClean,
  type AgentIdentity, type CourseModule, type GradeResult, type LessonCard, type SimScenario, type SimResult, type SimAttempt,
} from '../lib/api';
import { TruLogo } from '../components/TruLogo';
import '../truHqDark.css';

type View = 'home' | 'lesson' | 'quiz' | 'result' | 'sim';

// Per-module accent — gold, blue, sea-green, terracotta (cycles past 4).
const ACCENTS = ['#e0a340', '#4f8fd6', '#3fa06c', '#d9694c'];
const accentOf = (idx: number) => ACCENTS[(idx - 1) % ACCENTS.length];

// Short sidebar label for each lesson screen.
function cardLabel(c: LessonCard, i: number): string {
  if (c.t === 'section') return c.title ?? `Part`;
  if (c.t === 'drill') return '⚡ Practice rep';
  if (c.t === 'script') return '📋 Steal this script';
  if (c.t === 'dialogue') return '🎧 Live example';
  if (c.t === 'video') return `🎬 ${c.title ?? 'Watch'}`;
  if (c.t === 'steps') return c.title ?? 'The pipeline';
  if (c.t === 'callout') return 'The takeaway';
  if (c.t === 'stat') return `The number: ${c.big}`;
  if (c.t === 'stats') return 'The economics';
  if (c.t === 'compare') return 'Do / don’t';
  return c.k ?? `Lesson ${i + 1}`;
}

// Loom share links → embeddable player URLs.
function embedUrl(u: string): string {
  const m = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]+)/i);
  return m ? `https://www.loom.com/embed/${m[1]}` : u;
}

// Honest time estimate for a module (reading + drills + quiz).
function estMinutes(m: CourseModule): number {
  return Math.max(5, Math.round(m.cards.length * 0.8 + m.qs.length * 0.5));
}

export default function AgentCourse({ agent }: { agent: AgentIdentity }) {
  const [mods, setMods] = useState<CourseModule[] | null>(null);
  const [view, setView] = useState<View>('home');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [scenarios, setScenarios] = useState<SimScenario[]>([]);
  const [simConfigured, setSimConfigured] = useState(false);
  const [attempts, setAttempts] = useState<SimAttempt[]>([]);
  const [sessionSimPass, setSessionSimPass] = useState(false);

  const refresh = () => loadCourse(agent.id).then(setMods);
  useEffect(() => {
    void refresh();
    void simScenarios().then((s) => { setScenarios(s.scenarios); setSimConfigured(s.configured); });
    void mySimAttempts(agent.id).then(setAttempts);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const active = useMemo(() => mods?.find((m) => m.id === activeId) ?? null, [mods, activeId]);
  const firstName = agent.name.split(' ')[0] || 'there';

  if (!mods) return <div className="center-wrap"><div className="spinner" /></div>;

  const passed = mods.filter((m) => m.status === 'passed').length;
  const total = mods.length;
  const allMods = passed === total && total > 0;
  const simUnlocked = allMods || isDemo; // demo: the sim is always walkable
  const simPassed = sessionSimPass || attempts.some((a) => a.passed);
  const bestSim = attempts.reduce<number | null>((b, a) => (a.score != null && (b == null || a.score > b) ? a.score : b), null);
  const certified = allMods && simPassed;
  const nextMod = mods.find((m) => m.status !== 'passed') ?? null;
  const openModule = (m: CourseModule) => { setActiveId(m.id); setResult(null); setView(m.qs.length ? 'lesson' : 'home'); };

  if (view === 'home') {
    return (
      <div className="ac">
        <header className="ac-top">
          <TruLogo size={26} wordSize={19} sub="Rep" />
          <button className="link small" onClick={() => signOutClean()}>Sign out</button>
        </header>
        <main className="ac-main">
          <div className="ac-hero2 fu">
            <div className="ac-hero2-txt">
              <div className="ac-hero2-ey">Your certification</div>
              <h1>Hi {firstName}.</h1>
              <p>{certified
                ? 'Fully certified — modules and the Live Sim. This is the standard; keep living it.'
                : allMods
                  ? 'All five modules down. One thing left: pass the Live Sim — a real call, out loud.'
                  : 'Master the TRU way — real numbers, real scripts, real reps. Pass every module, then prove it out loud in the Live Sim.'}</p>
            </div>
            <Ring passed={passed} total={total} />
          </div>
          {certified && (
            <div className="ac-cert fu">
              <div className="ac-cert-seal">🏆</div>
              <div className="ac-cert-word">TRU REP · CERTIFIED</div>
              <div className="ac-cert-name">{agent.name}</div>
              <div className="ac-cert-line">
                Completed {new Date(Math.max(...mods.map((m) => (m.passed_at ? Date.parse(m.passed_at) : Date.now())))).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                {bestSim != null && <> · Live Sim {bestSim}%</>}
                {mods.every((m) => m.signed) && <> · Signed off by your team leader ✓</>}
              </div>
            </div>
          )}
          <div className="ac-modlist">
            {mods.map((m, i) => {
              const done = m.status === 'passed';
              const isNext = nextMod?.id === m.id;
              const ac = accentOf(m.idx);
              return (
                <button
                  key={m.id}
                  className={`ac-modcard fu${done ? ' done' : ''}${isNext ? ' next' : ''}`}
                  style={{ ['--mac' as string]: ac, animationDelay: `${0.07 * i}s` }}
                  onClick={() => openModule(m)}
                  disabled={!m.qs.length}
                >
                  <span className="ac-modbar" />
                  <span className={`ac-modnum${done ? ' done' : ''}`}>{done ? '✓' : m.idx}</span>
                  <span className="ac-modmeta">
                    <span className="ac-modtitle">{m.title}</span>
                    <span className="ac-modsub">{done ? `Passed · ${m.score}%` : `≈ ${estMinutes(m)} min · ${m.cards.length} screens · ${m.qs.length}-question quiz`}</span>
                  </span>
                  {isNext ? <span className="ac-modstart">Start</span> : <span className="ac-modgo">{done ? 'Review' : '›'}</span>}
                </button>
              );
            })}
            {/* The final: a live, graded roleplay call */}
            <button
              className={`ac-modcard ac-simcard fu${simPassed ? ' done' : ''}${allMods && !simPassed ? ' next' : ''}`}
              style={{ ['--mac' as string]: '#a9791f', animationDelay: `${0.07 * mods.length}s` }}
              disabled={!simUnlocked}
              onClick={() => setView('sim')}
            >
              <span className="ac-modbar" />
              <span className={`ac-modnum${simPassed ? ' done' : ''}`}>{simPassed ? '✓' : '🎙'}</span>
              <span className="ac-modmeta">
                <span className="ac-modtitle">The Final: Live Sim</span>
                <span className="ac-modsub">
                  {simPassed
                    ? `Passed · ${bestSim}%`
                    : simUnlocked
                      ? 'A real call with an AI buyer, graded on ALMS — score 80+ to certify'
                      : `🔒 Pass all ${total} modules to unlock`}
                </span>
              </span>
              {simUnlocked && !simPassed ? <span className="ac-modstart">Take the call</span> : <span className="ac-modgo">{simPassed ? 'Again' : '›'}</span>}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (view === 'sim') {
    return (
      <SimView
        scenarios={scenarios}
        configured={simConfigured}
        attempts={attempts}
        onBack={() => setView('home')}
        onGraded={(r) => {
          if (r.passed) setSessionSimPass(true);
          void mySimAttempts(agent.id).then(setAttempts);
        }}
      />
    );
  }

  if (!active) return null;

  return view === 'lesson' ? (
    <Lesson key={active.id} module={active} onDone={() => setView('quiz')} onBack={() => setView('home')} />
  ) : view === 'quiz' ? (
    <Quiz
      key={active.id + ':' + (result ? 'retry' : 'first')}
      module={active}
      onExit={() => setView('lesson')}
      onGraded={(r) => { setResult(r); void refresh(); setView('result'); }}
    />
  ) : result ? (
    <Result module={active} result={result} onRetry={() => setView('quiz')} onReview={() => setView('lesson')} onHome={() => setView('home')} />
  ) : null;
}

// ── The Live Sim: pick a buyer, take the call, get graded on ALMS ───────────
// Exported so the leader Rep tab can run it in test mode (real call, nothing stored).
type SimPhase = 'pick' | 'connecting' | 'live' | 'grading' | 'result' | 'error';

export function SimView({ scenarios, configured, attempts, onBack, onGraded }: {
  scenarios: SimScenario[];
  configured: boolean;
  attempts: SimAttempt[];
  onBack: () => void;
  onGraded: (r: SimResult) => void;
}) {
  const [phase, setPhase] = useState<SimPhase>('pick');
  const [scenario, setScenario] = useState<SimScenario | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<SimResult | null>(null);
  const clientRef = useRef<RetellWebClient | null>(null);
  const practiceRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const unblockRef = useRef<(() => void) | null>(null);

  // Browser autoplay policy blocks the buyer's audio track unless playback is kicked
  // off under a user gesture. The `await simStart()` before the call consumes the
  // Call-button click, so we re-arm playback here and on the next tap as a fallback.
  const enableAudio = () => { void clientRef.current?.startAudioPlayback().catch(() => {}); };
  const armAudioFallback = () => {
    if (unblockRef.current) return;
    const fn = () => enableAudio();
    unblockRef.current = fn;
    window.addEventListener('pointerdown', fn, { capture: true });
  };
  const disarmAudioFallback = () => {
    if (unblockRef.current) window.removeEventListener('pointerdown', unblockRef.current, { capture: true } as EventListenerOptions);
    unblockRef.current = null;
  };

  useEffect(() => () => { // leave = hang up
    clientRef.current?.stopCall();
    disarmAudioFallback();
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const bestFor = (key: string) => attempts.filter((a) => a.scenario === key && a.score != null)
    .reduce<number | null>((b, a) => (b == null || (a.score as number) > b ? a.score : b), null);

  async function start(s: SimScenario) {
    setScenario(s); setErr('');
    if (isDemo) { // demo: simulate a short call, then show the canned scorecard
      setPhase('live'); setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((x) => x + 1), 1000);
      return;
    }
    setPhase('connecting');
    try {
      const { practiceId, accessToken } = await simStart(s.key);
      practiceRef.current = practiceId;
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on('call_started', () => {
        setPhase('live'); setSeconds(0);
        timerRef.current = window.setInterval(() => setSeconds((x) => x + 1), 1000);
        enableAudio(); // make the buyer audible the moment the call is up
      });
      client.on('call_ended', () => { disarmAudioFallback(); void grade(); });
      client.on('error', () => { setErr('The call dropped — try again.'); setPhase('error'); disarmAudioFallback(); client.stopCall(); });
      await client.startCall({ accessToken });
      enableAudio();       // unblock playback now…
      armAudioFallback();  // …and guarantee it on the next tap if autoplay blocked us
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the call.');
      setPhase('error');
    }
  }

  function hangUp() {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    disarmAudioFallback();
    if (isDemo) { void grade(); return; }
    clientRef.current?.stopCall(); // → call_ended → grade()
  }

  async function grade() {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setPhase('grading');
    try {
      const r = isDemo ? await new Promise<SimResult>((ok) => setTimeout(() => ok(demoSimResult()), 1800)) : await simFinish(practiceRef.current as string);
      setRes(r); setPhase('result'); onGraded(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Grading failed — the attempt is saved; try again.');
      setPhase('error');
    }
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const rail = (
    <>
      <div className="ac-rail-logo"><TruLogo size={26} wordSize={19} sub="Rep" /></div>
      <button className="ac-rail-back" onClick={() => { hangUp(); onBack(); }}>‹ All modules</button>
      <div className="ac-rail-kicker">The Final</div>
      <div className="ac-rail-title">Live Sim</div>
      <div className="ac-rail-steps">
        {scenarios.map((s) => (
          <button key={s.key} className={`ac-step${scenario?.key === s.key ? ' on' : ''}`} disabled={phase === 'live' || phase === 'connecting' || phase === 'grading'} onClick={() => { setPhase('pick'); setScenario(s); }}>
            <span className="ac-step-dot">🎙</span>
            <span className="ac-step-label">{s.label}</span>
          </button>
        ))}
      </div>
      <RailFoot />
    </>
  );

  return (
    <Shell accent="#a9791f" num={6} rail={rail}>
      <button className="ac-back ac-mob" onClick={() => { hangUp(); onBack(); }}>‹ All modules</button>
      <div className="ac-lessonhead">
        <span className="ac-chip">The Final · pass 80%</span>
        {phase === 'live' && <span className="ac-count">{mmss}</span>}
      </div>

      {phase === 'pick' && (
        <div className="ac-cardzone">
          <h2 className="ac-lessontitle" style={{ display: 'block' }}>Take the call. Out loud.</h2>
          <p className="ac-simintro">Pick a buyer. When you hit start, your mic goes live and they answer like a real connection call — run ALMS, book the appointment, and hang up when you’ve locked the plan. The call is graded the moment you end it.</p>
          {!configured && !isDemo && <div className="err">The Live Sim isn’t switched on for your team yet — your leader is setting it up.</div>}
          <div className="ac-simgrid">
            {scenarios.map((s) => {
              const best = bestFor(s.key);
              return (
                <div key={s.key} className={`ac-simopt${scenario?.key === s.key ? ' on' : ''}`} onClick={() => setScenario(s)}>
                  <div className="ac-simopt-name">{s.name}</div>
                  <div className="ac-simopt-label">{s.label}</div>
                  <div className="ac-simopt-blurb">{s.blurb}</div>
                  {best != null && <div className="ac-simopt-best">Best: {best}%</div>}
                </div>
              );
            })}
          </div>
          <div className="ac-nav">
            <button className="btn ac-btn" disabled={!scenario || (!configured && !isDemo)} onClick={() => scenario && start(scenario)}>
              {scenario ? `📞 Call ${scenario.name}` : 'Pick a buyer'}
            </button>
          </div>
        </div>
      )}

      {(phase === 'connecting' || phase === 'live') && scenario && (
        <div className="ac-cardzone">
          <div className="ac-simlive fu">
            <div className={`ac-simpulse${phase === 'live' ? ' on' : ''}`}><span>🎙</span></div>
            <div className="ac-simlive-name">{scenario.name}</div>
            <div className="ac-simlive-sub">{phase === 'connecting' ? 'Connecting…' : `Live · ${mmss} — speak naturally, like a real connection call`}</div>
            {phase === 'live' && (
              <button className="btn ac-simend" onClick={hangUp}>End call &amp; get graded</button>
            )}
            {!isDemo && phase === 'live' && (
              <button
                className="link small"
                onClick={enableAudio}
                style={{ marginTop: 8, color: '#a9791f', fontWeight: 700 }}
              >🔊 Can’t hear them? Tap to turn on sound</button>
            )}
            {isDemo && phase === 'live' && <div className="ac-simlive-demo">Demo mode: no mic — hit end whenever to see the scorecard.</div>}
          </div>
        </div>
      )}

      {phase === 'grading' && (
        <div className="ac-cardzone">
          <div className="ac-simlive fu">
            <div className="spinner" />
            <div className="ac-simlive-sub">Your coach is listening back to the call…</div>
          </div>
        </div>
      )}

      {phase === 'result' && res && scenario && (
        <div className="ac-cardzone">
          <div className={`ac-verdict fu ${res.passed ? 'pass' : 'fail'}`} style={{ marginBottom: 14 }}>
            <div className="ac-badge">{res.passed ? '🏆' : '🎧'}</div>
            <div className="ac-score">{res.score}<span>%</span></div>
            <div className="ac-verdict-word">{res.passed ? 'CALL PASSED' : 'RUN IT BACK'}</div>
            <p>{scenario.label} · {res.durationS ? `${Math.round(res.durationS / 60)} min call` : 'graded on ALMS'}{res.passed ? ' — that’s a certifying call.' : ` — you need 80. Read the notes, then call ${scenario.name} again.`}</p>
          </div>
          <div className="ac-simboard fu">
            {(['a', 'l', 'm', 's'] as const).map((k) => (
              <div key={k} className="ac-simrow">
                <span className="ac-simrow-k">{k.toUpperCase()}</span>
                <span className="ac-simrow-bar"><span style={{ width: `${(res.breakdown[k].score / 25) * 100}%` }} /></span>
                <span className="ac-simrow-n">{res.breakdown[k].score}/25</span>
                <span className="ac-simrow-note">{res.breakdown[k].note}</span>
              </div>
            ))}
            {res.breakdown.flags.length > 0 && (
              <div className="ac-simflags">{res.breakdown.flags.map((f, i) => <span key={i}>⚠ {f}</span>)}</div>
            )}
            {res.breakdown.best_moment && <div className="ac-simbest">Your best line: <em>{res.breakdown.best_moment}</em></div>}
            <div className="ac-simcoach">{res.breakdown.coach_note}</div>
          </div>
          <div className="ac-nav center">
            <button className="btn ghost" onClick={() => { setPhase('pick'); setRes(null); }}>Another buyer</button>
            <button className="btn ac-btn" onClick={() => { hangUp(); onBack(); }}>{res.passed ? 'Back to the course →' : 'Review the modules'}</button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="ac-cardzone">
          <div className="err">{err}</div>
          <div className="ac-nav"><button className="btn ac-btn" onClick={() => setPhase('pick')}>Back to buyers</button></div>
        </div>
      )}
    </Shell>
  );
}

// ── Progress ring — CSS-animated stroke draw-in ─────────────────────────────
function Ring({ passed, total }: { passed: number; total: number }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const frac = total ? passed / total : 0;
  return (
    <div className="ac-ring">
      <svg viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={R} className="ac-ring-track" />
        <circle
          cx="55" cy="55" r={R} className="ac-ring-fill"
          strokeDasharray={C}
          style={{ ['--dash' as string]: String(C), ['--off' as string]: String(C * (1 - Math.max(frac, 0.03))) }}
        />
      </svg>
      <div className="ac-ring-mid">
        <div className="ac-ring-n">{passed}<span>/{total}</span></div>
        <div className="ac-ring-l">modules</div>
      </div>
    </div>
  );
}

// ── The desktop shell: dark course rail + big stage with ambient backdrop ───
function Shell({ accent, num, rail, children }: { accent: string; num: number; rail: ReactNode; children: ReactNode }) {
  return (
    <div className="ac ac-shell tru-dark" style={{ ['--mac' as string]: accent }}>
      <aside className="ac-rail">{rail}</aside>
      <section className="ac-stage">
        <div className="ac-watermark" aria-hidden>{String(num).padStart(2, '0')}</div>
        <div className="ac-stage-inner">{children}</div>
      </section>
    </div>
  );
}

function RailHead({ module: m, onBack }: { module: CourseModule; onBack: () => void }) {
  return (
    <>
      <div className="ac-rail-logo"><TruLogo size={26} wordSize={19} sub="Rep" /></div>
      <button className="ac-rail-back" onClick={onBack}>‹ All modules</button>
      <div className="ac-rail-kicker">Module {m.idx}</div>
      <div className="ac-rail-title">{m.title}</div>
    </>
  );
}

function RailFoot() {
  return (
    <div className="ac-rail-foot">
      <button className="link small" onClick={() => signOutClean()}>Sign out</button>
    </div>
  );
}

// ── Lesson: typed cards on the big stage; rail = the outline ────────────────
// Exported so the leader Rep tab can open any module as a full preview.
export function Lesson({ module: m, onDone, onBack, doneLabel }: { module: CourseModule; onDone: () => void; onBack: () => void; doneLabel?: string }) {
  const cards = m.cards;
  const [i, setI] = useState(0);
  const [seen, setSeen] = useState(0);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const ac = accentOf(m.idx);
  const card = cards[i];
  const last = i >= cards.length - 1;
  const isDrill = card?.t === 'drill';
  const answered = !isDrill || picks[i] !== undefined;
  const go = (n: number) => { setI(n); setSeen((s) => Math.max(s, n)); };

  const rail = (
    <>
      <RailHead module={m} onBack={onBack} />
      <div className="ac-rail-steps">
        {cards.map((c, k) => (
          <button key={k} className={`ac-step${c.t === 'section' ? ' sect' : ''}${k === i ? ' on' : ''}${k < i ? ' done' : ''}`} disabled={k > seen} onClick={() => go(k)}>
            {c.t !== 'section' && <span className="ac-step-dot">{k < i ? '✓' : k + 1}</span>}
            <span className="ac-step-label">{cardLabel(c, k)}</span>
          </button>
        ))}
      </div>
      <RailFoot />
    </>
  );

  return (
    <Shell accent={ac} num={m.idx} rail={rail}>
      <button className="ac-back ac-mob" onClick={onBack}>‹ All modules</button>
      <div className="ac-lessonhead">
        <span className="ac-chip">Module {m.idx}</span>
        <span className="ac-count">{i + 1} / {cards.length}</span>
      </div>
      <h2 className="ac-lessontitle ac-mob">{m.title}</h2>
      <div className="ac-progress"><div className="ac-progress-fill" style={{ width: `${((i + 1) / cards.length) * 100}%` }} /></div>
      <div className="ac-cardzone" key={i}>
        <Card card={card} pick={picks[i]} onPick={(ci) => setPicks((p) => ({ ...p, [i]: ci }))} />
      </div>
      <div className="ac-nav">
        {i > 0 && <button className="btn ghost" onClick={() => setI(i - 1)}>Back</button>}
        {!last
          ? <button className="btn ac-btn" disabled={!answered} onClick={() => go(i + 1)}>{isDrill && !answered ? 'Pick an answer' : 'Next'}</button>
          : <button className="btn ac-btn" disabled={!answered} onClick={onDone}>{doneLabel ?? 'Take the quiz →'}</button>}
      </div>
    </Shell>
  );
}

function Card({ card, pick, onPick }: { card: LessonCard; pick?: number; onPick: (ci: number) => void }) {
  if (!card) return null;
  if (card.t === 'section') {
    return (
      <div className="ac-sect fu">
        <div className="ac-sect-n">{card.n}</div>
        <h2 className="ac-sect-title">{card.title}</h2>
        {card.body && <p className="ac-sect-sub">{card.body}</p>}
      </div>
    );
  }
  if (card.t === 'stat') {
    return (
      <div className="ac-stat fu">
        <div className="ac-stat-big">{card.big}</div>
        <div className="ac-stat-label">{card.label}</div>
        {card.src && <div className="ac-stat-src">{card.src}</div>}
      </div>
    );
  }
  if (card.t === 'stats') {
    return (
      <div className="ac-statgrid fu">
        {(card.items ?? []).map((it, k) => (
          <div key={k} className="ac-stat sm">
            <div className="ac-stat-big">{it.big}</div>
            <div className="ac-stat-label">{it.label}</div>
          </div>
        ))}
      </div>
    );
  }
  if (card.t === 'callout') {
    return <div className="ac-callout fu">{card.body}</div>;
  }
  if (card.t === 'script') {
    return (
      <div className="ac-script fu">
        <div className="ac-script-tag">📋 Steal this script</div>
        {card.title && <div className="ac-script-title">{card.title}</div>}
        {(card.lines ?? []).map((l, k) => <div key={k} className="ac-script-line">{l}</div>)}
      </div>
    );
  }
  if (card.t === 'dialogue') {
    return (
      <div className="ac-dlg fu">
        <div className="ac-dlg-tag">🎧 Live example</div>
        {card.title && <div className="ac-dlg-title">{card.title}</div>}
        <div className="ac-dlg-thread">
          {(card.turns ?? []).map((tn, k) => (
            <div key={k} className={`ac-turn ${tn.who === 'agent' ? 'agent' : 'lead'}`}>
              <span className="ac-turn-who">{tn.who === 'agent' ? 'You' : 'Lead'}</span>
              <span className="ac-turn-say">{tn.say}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (card.t === 'video') {
    return (
      <div className="ac-video fu">
        <div className="ac-video-tag">🎬 Watch</div>
        {card.title && <div className="ac-video-title">{card.title}</div>}
        {card.url ? (
          <div className="ac-video-frame">
            <iframe src={embedUrl(card.url)} allowFullScreen title={card.title ?? 'Lesson video'} />
          </div>
        ) : (
          <div className="ac-video-soon">
            <span className="ac-video-play">▶</span>
            <span>A personal welcome from your team leader — video coming soon.</span>
          </div>
        )}
        {card.body && <p className="ac-video-note">{card.body}</p>}
      </div>
    );
  }
  if (card.t === 'steps') {
    return (
      <div className="ac-ladder fu">
        {card.title && <div className="ac-ladder-title">{card.title}</div>}
        {(card.steps ?? []).map((s, k) => (
          <div key={k} className="ac-ladder-row">
            <span className="ac-ladder-num">{k + 1}</span>
            <span className="ac-ladder-label">{s}</span>
          </div>
        ))}
      </div>
    );
  }
  if (card.t === 'compare') {
    return (
      <div className="ac-compare fu">
        <div className="ac-cmp do">
          <div className="ac-cmp-head">✓ Do this</div>
          {(card.good ?? []).map((g, k) => <div key={k} className="ac-cmp-item">{g}</div>)}
        </div>
        <div className="ac-cmp dont">
          <div className="ac-cmp-head">✗ Not this</div>
          {(card.bad ?? []).map((b, k) => <div key={k} className="ac-cmp-item">{b}</div>)}
        </div>
      </div>
    );
  }
  if (card.t === 'drill') {
    const answered = pick !== undefined;
    return (
      <div className="ac-drill fu">
        <div className="ac-drill-tag">⚡ Practice rep</div>
        <div className="ac-drill-q">{card.prompt}</div>
        <div className="ac-choices">
          {(card.choices ?? []).map((c, ci) => {
            let cls = 'ac-choice';
            if (answered) {
              if (ci === card.answer) cls += ' right';
              else if (ci === pick) cls += ' wrong';
              else cls += ' dim';
            }
            return (
              <button key={ci} className={cls} disabled={answered} onClick={() => onPick(ci)}>
                <span className="ac-choice-mark">{answered && ci === card.answer ? '✓' : answered && ci === pick ? '✗' : String.fromCharCode(65 + ci)}</span>{c}
              </button>
            );
          })}
        </div>
        {answered && (
          <div className={`ac-drill-fb ${pick === card.answer ? 'ok' : 'no'}`}>
            <b>{pick === card.answer ? 'Exactly right.' : 'Not this time — here’s the why:'}</b> {card.explain}
          </div>
        )}
      </div>
    );
  }
  // text — body supports "\n\n" paragraph breaks; optional source line
  const paras = (card.body ?? '').split(/\n\n+/);
  return (
    <div className="ac-card fu">
      {card.k && <div className="ac-kicker">{card.k}</div>}
      {paras.map((p, k) => <p key={k} className="ac-card-body">{p}</p>)}
      {card.src && <div className="ac-card-src">{card.src}</div>}
    </div>
  );
}

// ── Quiz: one question per screen; rail = the question list ─────────────────
function Quiz({ module: m, onExit, onGraded }: { module: CourseModule; onExit: () => void; onGraded: (r: GradeResult) => void }) {
  const [qi, setQi] = useState(0);
  const [maxQ, setMaxQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>(() => m.qs.map(() => -1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ac = accentOf(m.idx);
  const q = m.qs[qi];
  const last = qi >= m.qs.length - 1;
  const chosen = answers[qi];
  const go = (n: number) => { setQi(n); setMaxQ((s) => Math.max(s, n)); };

  function pick(ci: number) {
    setAnswers((a) => { const n = [...a]; n[qi] = ci; return n; });
  }
  async function submit() {
    setBusy(true); setErr('');
    try {
      onGraded(await gradeQuiz(m.id, answers));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit. Try again.');
      setBusy(false);
    }
  }

  const rail = (
    <>
      <RailHead module={m} onBack={onExit} />
      <div className="ac-rail-steps">
        {m.qs.map((_, k) => (
          <button key={k} className={`ac-step${k === qi ? ' on' : ''}${answers[k] >= 0 && k !== qi ? ' done' : ''}`} disabled={k > maxQ} onClick={() => go(k)}>
            <span className="ac-step-dot">{answers[k] >= 0 && k !== qi ? '✓' : k + 1}</span>
            <span className="ac-step-label">Question {k + 1}</span>
          </button>
        ))}
      </div>
      <RailFoot />
    </>
  );

  return (
    <Shell accent={ac} num={m.idx} rail={rail}>
      <button className="ac-back ac-mob" onClick={onExit}>‹ Back to the lesson</button>
      <div className="ac-lessonhead">
        <span className="ac-chip">Quiz · pass {m.pass_pct}%</span>
        <span className="ac-count">{qi + 1} / {m.qs.length}</span>
      </div>
      <div className="ac-progress"><div className="ac-progress-fill" style={{ width: `${((qi + 1) / m.qs.length) * 100}%` }} /></div>
      <div className="ac-cardzone" key={q.id}>
        <div className="ac-qprompt fu">{q.prompt}</div>
        <div className="ac-choices">
          {q.choices.map((c, ci) => (
            <button key={ci} className={`ac-choice${chosen === ci ? ' on' : ''}`} onClick={() => pick(ci)}>
              <span className="ac-choice-mark">{String.fromCharCode(65 + ci)}</span>{c}
            </button>
          ))}
        </div>
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      </div>
      <div className="ac-nav">
        {qi > 0 && <button className="btn ghost" onClick={() => setQi(qi - 1)}>Back</button>}
        {!last
          ? <button className="btn ac-btn" disabled={chosen < 0} onClick={() => go(qi + 1)}>Next</button>
          : <button className="btn ac-btn" disabled={chosen < 0 || busy} onClick={submit}>{busy ? 'Grading…' : 'Submit answers'}</button>}
      </div>
    </Shell>
  );
}

// ── Result: celebration on pass, warm review + unlimited retries on miss ────
function Result({ module: m, result, onRetry, onReview, onHome }: {
  module: CourseModule; result: GradeResult; onRetry: () => void; onReview: () => void; onHome: () => void;
}) {
  const byIdx = new Map(m.qs.map((q) => [q.idx, q]));
  const ac = accentOf(m.idx);

  const rail = (
    <>
      <RailHead module={m} onBack={onHome} />
      <div className="ac-rail-verdict">
        <div className={`ac-rail-score ${result.passed ? 'ok' : 'no'}`}>{result.score}%</div>
        <div className="ac-rail-scoreline">{result.correct} of {result.total} correct · pass {m.pass_pct}%</div>
      </div>
      <RailFoot />
    </>
  );

  return (
    <Shell accent={ac} num={m.idx} rail={rail}>
      <div className={`ac-verdict fu ${result.passed ? 'pass' : 'fail'}`}>
        {result.passed && (
          <div className="ac-confetti">
            {Array.from({ length: 18 }).map((_, i) => (
              <i key={i} style={{
                left: `${(i * 37 + 8) % 100}%`,
                background: ACCENTS[i % ACCENTS.length],
                animationDelay: `${(i % 6) * 0.14}s`,
                transform: `rotate(${(i * 47) % 360}deg)`,
              }} />
            ))}
          </div>
        )}
        <div className="ac-badge">{result.passed ? '🏆' : '💪'}</div>
        <div className="ac-score">{result.score}<span>%</span></div>
        <div className="ac-verdict-word">{result.passed ? 'CERTIFIED' : 'ALMOST THERE'}</div>
        <p>{result.passed
          ? `${m.title} — ${result.correct} of ${result.total} correct. That’s the standard.`
          : `${result.correct} of ${result.total}. You need ${m.pass_pct}%. Check the misses below and run it back — unlimited retries.`}</p>
        <div className="ac-nav center">
          {result.passed
            ? <button className="btn ac-btn" onClick={onHome}>Next module →</button>
            : <>
                <button className="btn ghost" onClick={onReview}>Re-read lesson</button>
                <button className="btn ac-btn" onClick={onRetry}>Run it back</button>
              </>}
        </div>
      </div>
      <div className="ac-review">
        {result.review.map((r) => {
          const q = byIdx.get(r.idx);
          if (!q) return null;
          return (
            <div key={r.idx} className={`ac-rev ${r.is_correct ? 'ok' : 'no'}`}>
              <div className="ac-rev-q"><span className="ac-rev-mark">{r.is_correct ? '✓' : '✗'}</span>{q.prompt}</div>
              {!r.is_correct && (
                <div className="ac-rev-a">
                  {r.your >= 0 && <div className="ac-rev-your">You picked: {q.choices[r.your]}</div>}
                  <div className="ac-rev-correct">Correct: {q.choices[r.correct_index]}</div>
                </div>
              )}
              {r.explain && <div className="ac-rev-why">{r.explain}</div>}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
