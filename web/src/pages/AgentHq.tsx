import { useEffect, useMemo, useState } from 'react';
import {
  loadCourse, signOutClean, type AgentIdentity, type CourseModule,
} from '../lib/api';
import {
  AGENT_COACH_HEADINGS,
  AGENT_HQ_EMPTY,
  attentionItems,
  canOpenModule,
  isZillowOnboarding,
  parseAgentHqTab,
  trainingBay,
  type AgentHqTab,
} from '../lib/agentHq';
import { AG, ARCH } from '../lib/assessmentData';
import {
  loadCommitments,
  loadMyOneOnOnes,
  loadOwnProfile,
  toggleCheckinCommitment,
  toggleCommitment,
  type Commitment,
  type MyOneOnOne,
  type Profile,
} from '../lib/coachData';
import { AgentHqShell, goAgentTab } from '../components/agentHqShell';
import { Lesson, Quiz, Result } from './AgentCourse';
import type { GradeResult } from '../lib/api';
import '../truHqDark.css';

export default function AgentHq({ agent }: { agent: AgentIdentity }) {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const tab = parseAgentHqTab(route);

  const [mods, setMods] = useState<CourseModule[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assessed, setAssessed] = useState(false);
  const [oneOnOnes, setOneOnOnes] = useState<MyOneOnOne[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [player, setPlayer] = useState<'lesson' | 'quiz' | 'result'>('lesson');
  const [grade, setGrade] = useState<GradeResult | null>(null);

  const refresh = () => {
    void loadCourse(agent.id).then(setMods);
    void loadOwnProfile(agent.id).then((r) => { setProfile(r.profile); setAssessed(r.assessed); });
    void loadMyOneOnOnes(agent.id).then(setOneOnOnes).catch(() => setOneOnOnes([]));
    void loadCommitments(agent.id).then(setCommitments).catch(() => setCommitments([]));
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id]);

  const firstName = agent.name.split(' ')[0] || 'there';
  const active = useMemo(() => mods?.find((m) => m.id === activeId) ?? null, [mods, activeId]);

  const closePlayer = () => { setActiveId(null); setPlayer('lesson'); setGrade(null); void loadCourse(agent.id).then(setMods); };

  if (active && tab === 'training') {
    if (player === 'quiz') {
      return (
        <Quiz
          key={active.id}
          module={active}
          onExit={() => setPlayer('lesson')}
          onGraded={(r) => { setGrade(r); setPlayer('result'); void loadCourse(agent.id).then(setMods); }}
        />
      );
    }
    if (player === 'result' && grade) {
      return (
        <Result
          module={active}
          result={grade}
          onRetry={() => setPlayer('quiz')}
          onReview={() => setPlayer('lesson')}
          onHome={closePlayer}
        />
      );
    }
    return (
      <Lesson
        key={active.id}
        module={active}
        onDone={() => { active.qs.length ? setPlayer('quiz') : closePlayer(); }}
        onBack={closePlayer}
        doneLabel={active.qs.length ? 'Continue to quiz' : 'Back to Training'}
      />
    );
  }

  const openCommitments = [
    ...oneOnOnes.flatMap((oo) => oo.commitments.filter((c) => !c.status).map((c) => ({ id: c.id, text: c.body, kind: 'item' as const }))),
    ...commitments.filter((c) => !c.done).map((c) => ({ id: c.id, text: c.text, kind: 'sheet' as const })),
  ];
  const unfinishedZillow = (mods ?? [])
    .filter((m) => isZillowOnboarding(m) && m.status !== 'passed')
    .map((m) => ({ id: m.id, title: m.title }));
  const items = attentionItems({ assessed, unfinishedZillow, openCommitments });

  const title = tab === 'coach' ? 'Your Coach' : tab === 'training' ? 'Training' : `Welcome back, ${firstName}.`;
  const eyebrow = tab === 'home' ? 'Needs your attention' : tab === 'coach' ? 'Personal to you' : 'The bay';

  return (
    <div className="tru-dark">
      <AgentHqShell
        name={agent.name}
        eyebrow={eyebrow}
        title={title}
        onSignOut={() => signOutClean()}
        onGo={(next) => { setActiveId(null); goAgentTab(next); }}
      >
        <div className="ah-canvas">
          <div className="ah-ambient" aria-hidden />
          {tab === 'home' && (
            <HomeTab
              items={items}
              onGo={(t, moduleId) => {
                goAgentTab(t);
                if (moduleId) { setPlayer('lesson'); setGrade(null); setActiveId(moduleId); }
              }}
            />
          )}
          {tab === 'coach' && (
            <CoachTab
              assessed={assessed}
              profile={profile}
              openCommitments={openCommitments}
              onToggle={async (id, kind, done) => {
                try {
                  if (kind === 'item') await toggleCheckinCommitment(id, done);
                  else await toggleCommitment(id, done);
                  refresh();
                } catch { /* stay on the list; the tick did not persist */ }
              }}
            />
          )}
          {tab === 'training' && mods && (
            <TrainingTab
              mods={mods}
              onOpen={(m) => { if (canOpenModule(m)) { setPlayer('lesson'); setGrade(null); setActiveId(m.id); } }}
            />
          )}
          {tab === 'training' && !mods && <div className="center-wrap"><div className="spinner" /></div>}
        </div>
      </AgentHqShell>
    </div>
  );
}

function HomeTab({
  items,
  onGo,
}: {
  items: ReturnType<typeof attentionItems>;
  onGo: (tab: AgentHqTab, moduleId?: string) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="ah-empty reveal">
        <div className="ah-empty-ey">All clear</div>
        <h2>{AGENT_HQ_EMPTY}</h2>
      </section>
    );
  }
  return (
    <section className="ah-attn">
      {items.map((item, i) => (
        <button
          key={item.key}
          className="ah-card reveal"
          style={{ animationDelay: `${0.06 * i}s` }}
          onClick={() => onGo(item.tab, item.key.startsWith('training-') ? item.key.slice('training-'.length) : undefined)}
        >
          <span className="ah-card-ey">{item.tab === 'training' ? 'Training' : 'Coach'}</span>
          <span className="ah-card-title">{item.title}</span>
          <span className="ah-card-detail">{item.detail}</span>
        </button>
      ))}
    </section>
  );
}

function CoachTab({
  assessed,
  profile,
  openCommitments,
  onToggle,
}: {
  assessed: boolean;
  profile: Profile | null;
  openCommitments: { id: string; text: string; kind: 'item' | 'sheet' }[];
  onToggle: (id: string, kind: 'item' | 'sheet', done: boolean) => Promise<void>;
}) {
  if (!assessed || !profile) {
    return (
      <section className="ah-cta reveal">
        <div className="ah-empty-ey">Your Coach</div>
        <h2>Start with who you are.</h2>
        <p>Two short parts — you as a person, then how you work. When you finish, you land back here.</p>
        <button className="ah-btn" onClick={() => { window.location.hash = '/assess?self=1'; }}>
          Take your assessment
        </button>
      </section>
    );
  }

  const arch = ARCH[profile.code];
  const ag = AG[profile.code];
  const personal = profile.personalType;

  return (
    <div className="ah-coach">
      <section className="ah-hero reveal">
        <div className="ah-empty-ey">How you work</div>
        <h2>{arch?.emoji} {profile.archName}</h2>
        <p>{profile.tagline}</p>
        {personal && (
          <div className="ah-personal">
            <div className="ah-empty-ey">Who you are</div>
            <strong>{personal.name}</strong>
            <p>{personal.desc}</p>
          </div>
        )}
      </section>

      {ag && (
        <>
          <section className="ah-block reveal">
            <h3>{AGENT_COACH_HEADINGS.best}</h3>
            <p>{ag.sup}</p>
            {personal?.strengths?.length ? (
              <ul>{personal.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : null}
          </section>
          <section className="ah-block reveal">
            <h3>{AGENT_COACH_HEADINGS.worst}</h3>
            <p>{ag.watch}</p>
            {personal?.watch ? <p className="ah-watch">{personal.watch}</p> : null}
          </section>
          <section className="ah-block reveal">
            <h3>{AGENT_COACH_HEADINGS.strongest}</h3>
            <p>{ag.edge}</p>
            <p>{ag.challenge}</p>
          </section>
        </>
      )}

      <section className="ah-block reveal">
        <h3>Your commitments</h3>
        {openCommitments.length === 0 ? (
          <p className="ah-muted">Nothing open. When your next 1:1 sets one, it lands here.</p>
        ) : (
          <ul className="ah-checks">
            {openCommitments.map((c) => (
              <li key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    onChange={(e) => { void onToggle(c.id, c.kind, e.target.checked); }}
                  />
                  <span>{c.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TrainingTab({
  mods,
  onOpen,
}: {
  mods: CourseModule[];
  onOpen: (m: CourseModule) => void;
}) {
  const bay = trainingBay(mods);
  return (
    <div className="ah-bay">
      {bay.map((section) => (
        <section key={section.label} className="ah-section reveal">
          <h2>{section.label}</h2>
          {section.modules.length === 0 ? (
            <p className="ah-muted">Nothing in this bay yet.</p>
          ) : (
            <div className="ah-modlist">
              {section.modules.map((m) => {
                const done = m.status === 'passed';
                const openable = canOpenModule(m);
                return (
                  <button
                    key={`${section.label}-${m.id}`}
                    className={`ah-mod ${done ? 'done' : ''}`}
                    disabled={!openable}
                    onClick={() => onOpen(m)}
                  >
                    <span className="ah-mod-mark">{done ? '✓' : m.idx}</span>
                    <span>
                      <span className="ah-mod-title">{m.title}</span>
                      <span className="ah-mod-sub">
                        {done ? `Passed${m.score != null ? ` · ${m.score}%` : ''}` : openable ? 'Open' : 'Coming'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
