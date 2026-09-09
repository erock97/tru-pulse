import { learningTitle } from '../lib/learningProgress';
import CoachingAssignments from '../components/CoachingAssignments';
import PersonalProfile from './PersonalProfile';
import { workshopDay } from '../workshops/types';
import { useEffect, useMemo, useState } from 'react';
import { RepWorkshopLibrary } from '../components/RepWorkshopLibrary';
import {
  loadCourse, signOutClean, type AgentIdentity, type CourseModule,
} from '../lib/api';
import {
  AGENT_COACH_HEADINGS,
  agentCoachCopy,
  canOpenModule,
  parseAgentHqTab,
  trainingBay,
  type AgentHqTab,
} from '../lib/agentHq';
import { ARCH } from '../lib/assessmentData';
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
import SmsConsent from './SmsConsent';
import { smsState, type AgentSms } from '../lib/api';
import './smsConsent.css';
import { Lesson, Quiz, Result } from './AgentCourse';
import type { GradeResult } from '../lib/api';
import '../truHqDark.css';

export default function AgentHq({ agent }: { agent: AgentIdentity }) {
  const [profileDirty, setProfileDirty] = useState(false);
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const on = () => {
      const next = window.location.hash.replace(/^#/, '') || '/';
      if (next !== route && profileDirty && !window.confirm('Leave without saving your profile changes?')) {
        window.history.replaceState(null, '', `#${route}`);
        return;
      }
      setRoute(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [profileDirty, route]);
  const tab = parseAgentHqTab(route);
  const [loadError,setLoadError]=useState('');
  const [commitmentError,setCommitmentError]=useState('');
  const [mods, setMods] = useState<CourseModule[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assessed, setAssessed] = useState(false);
  const [oneOnOnes, setOneOnOnes] = useState<MyOneOnOne[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [player, setPlayer] = useState<'lesson' | 'quiz' | 'result'>('lesson');
  const [grade, setGrade] = useState<GradeResult | null>(null);
  // Null for anyone who is not an agent, and until the first read returns. Either
  // way the card simply does not render — there is nothing to opt into.
  const [sms, setSms] = useState<AgentSms | null>(null);
  const refreshSms = () => { void smsState().then(setSms).catch(() => undefined); };
  useEffect(refreshSms, []);

  const refresh = () => {
    setLoadError('');
    void Promise.all([
      loadCourse(agent.id).then(setMods),
      loadOwnProfile(agent.id).then(r=>{setProfile(r.profile);setAssessed(r.assessed);}),
      loadMyOneOnOnes(agent.id).then(setOneOnOnes),
      loadCommitments(agent.id).then(setCommitments),
    ]).catch(()=>setLoadError('Some of your training or coaching information could not be loaded.'));
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id]);

  const firstName = agent.name.split(' ')[0] || 'there';
  const active = useMemo(() => mods?.find((m) => m.id === activeId) ?? null, [mods, activeId]);

  const closePlayer = () => { setActiveId(null); setPlayer('lesson'); setGrade(null); void loadCourse(agent.id).then(setMods).catch(()=>setLoadError('Training could not be refreshed.')); };

  if (active && tab === 'training') {
    if (player === 'quiz') {
      return (
        <Quiz
          key={active.id}
          module={active}
          onExit={() => setPlayer('lesson')}
          onGraded={(r) => { setGrade(r); setPlayer('result'); void loadCourse(agent.id).then(setMods).catch(()=>setLoadError('Training could not be refreshed.')); }}
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
  const title = tab === 'profile' ? 'Your profile' : tab === 'coach' ? 'Your Coach' : tab === 'training' ? 'Training' : `Welcome back, ${firstName}.`;
  const eyebrow = tab === 'profile' ? 'Personal profile' : tab === 'home' ? 'Your HQ' : tab === 'coach' ? 'Personal to you' : 'The bay';

  return (
    <div className="tru-dark">
      <AgentHqShell
        name={agent.name}
        eyebrow={eyebrow}
        title={title}
        onSignOut={() => { if (!profileDirty || window.confirm('Leave without saving your profile changes?')) signOutClean(); }}
        onGo={(next) => { setActiveId(null); goAgentTab(next); }}
      >
        <div className="ah-canvas">
          <div className="ah-ambient" aria-hidden />
          {loadError&&tab!=='profile'&&<p className="ah-home-error" role="alert">{loadError}<button onClick={refresh}>Retry</button></p>}
          {tab === 'profile' && <PersonalProfile key={agent.id} name={agent.name} onDirtyChange={setProfileDirty} />}
          {tab === 'home' && (
            <HomeTab
              agentId={agent.id}
              mods={mods}
              commitments={openCommitments}
              assessed={assessed}
              sms={sms}
              onSmsChanged={refreshSms}
              onGo={(t, moduleId) => {
                goAgentTab(t);
                if (moduleId) { setPlayer('lesson'); setGrade(null); setActiveId(moduleId); }
              }}
            />
          )}
          {tab === 'coach' && (<>
            <CoachingAssignments key={agent.id} agentId={agent.id} onOpen={id=>{goAgentTab('training');setPlayer('lesson');setActiveId(id);}}/>
            {commitmentError&&<p role="alert" className="ah-home-error">{commitmentError}</p>}
            <CoachTab
              assessed={assessed}
              profile={profile}
              openCommitments={openCommitments}
              onToggle={async (id, kind, done) => {
                setCommitmentError('');
                try {
                  if (kind === 'item') await toggleCheckinCommitment(id, done);
                  else await toggleCommitment(id, done);
                  refresh();
                } catch { setCommitmentError('This commitment could not be saved. Please retry.'); }
              }}
            />
          </>)}
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

function HomeTab({agentId,mods,commitments,assessed,sms,onSmsChanged,onGo}:{
 agentId:string;mods:CourseModule[]|null;commitments:{id:string;text:string}[];assessed:boolean;
 sms:AgentSms|null;onSmsChanged:()=>void;onGo:(tab:AgentHqTab,moduleId?:string)=>void;
}){
 const next=mods?.filter(m=>m.status!=='passed'&&canOpenModule(m)).sort((a,b)=>a.idx-b.idx)[0];
 const recent=mods?.filter(m=>m.status==='passed').sort((a,b)=>(b.passed_at??'').localeCompare(a.passed_at??''))[0];
 return <div className="ah-home-next">
  <CoachingAssignments key={agentId} agentId={agentId} compact onOpen={id=>onGo('training',id)}/>
  <div className="ah-next-grid">
   <section className="ah-next-section"><h2>Continue training</h2>{mods===null?<p>Loading training…</p>:next?<><h3>{learningTitle(next)}</h3><p>{next.summary}</p><button className="ah-btn" onClick={()=>onGo('training',next.id)}>Open {learningTitle(next)} →</button></>:<><h3>You’re up to date.</h3><p>Return to a lesson whenever you need a refresher.</p><button className="ah-btn" onClick={()=>onGo('training')}>Browse training</button></>}</section>
   {recent&&<section className="ah-next-section"><h2>Recent accomplishment</h2><h3>{learningTitle(recent)}</h3><p>Quiz passed{recent.passed_at?` · ${new Date(recent.passed_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`:''}</p></section>}
   <section className="ah-next-section"><h2>Agreed at your 1:1</h2>{commitments.length?<ul className="ah-next-checks">{commitments.slice(0,2).map(c=><li key={c.id}>{c.text}</li>)}</ul>:<p>No open commitments from your 1:1 notes.</p>}<button className="ah-btn" onClick={()=>onGo('coach')}>Open Coach{commitments.length>2?` · ${commitments.length} commitments`:''}</button></section>
   {!assessed&&<section className="ah-next-section"><h2>Before your next coaching meeting</h2><h3>Complete your assessment.</h3><p>Give your coach a better understanding of how you work.</p><button className="ah-btn" onClick={()=>{window.location.hash='/assess?self=1';}}>Take assessment</button></section>}
  </div>
  {sms&&<section className="ah-section sms-card"><h2 className="sms-card-h">Text messages</h2><SmsConsent sms={sms} onSaved={onSmsChanged}/></section>}
 </div>;
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
  const commitmentList=<section className="ah-block ah-commitments-first"><h3>Your commitments</h3>{openCommitments.length===0?<p className="ah-muted">No open commitments from your 1:1 notes.</p>:<ul className="ah-checks">{openCommitments.map(c=><li key={c.id}><label><input type="checkbox" checked={false} onChange={()=>{void onToggle(c.id,c.kind,true);}}/><span>{c.text}</span></label></li>)}</ul>}</section>;
  if (!assessed || !profile) {
    return (
      <>{commitmentList}<section className="ah-cta">
        <div className="ah-empty-ey">Your Coach</div>
        <h2>Start with who you are.</h2>
        <p>Two short parts — you as a person, then how you work. When you finish, you land back here.</p>
        <button className="ah-btn" onClick={() => { window.location.hash = '/assess?self=1'; }}>
          Take your assessment
        </button>
      </section></>
    );
  }

  const arch = ARCH[profile.code];
  const personal = profile.personalType;
  const copy = agentCoachCopy({ workCode: profile.code, personalCode: profile.personalCode });

  return (
    <div className="ah-coach">
      {commitmentList}
      <section className="ah-hero">
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

      {copy && (
        <>
          <section className="ah-block">
            <h3>{AGENT_COACH_HEADINGS.best}</h3>
            <p>{copy.best.work}</p>
            {copy.best.personal.length ? (
              <ul>{copy.best.personal.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : null}
          </section>
          <section className="ah-block">
            <h3>{AGENT_COACH_HEADINGS.worst}</h3>
            <p>{copy.worst.work}</p>
            {copy.worst.personal ? <p className="ah-watch">{copy.worst.personal}</p> : null}
          </section>
          <section className="ah-block">
            <h3>{AGENT_COACH_HEADINGS.strongest}</h3>
            <p>{copy.strongest.edge}</p>
            <p>{copy.strongest.challenge}</p>
          </section>
        </>
      )}


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
  const bay = trainingBay(mods.filter(m=>!workshopDay(m))).filter(section=>section.modules.length>0);
  return (
    <div className="ah-bay">
      <RepWorkshopLibrary entries={mods.flatMap(m=>{
        const day=workshopDay(m);
        return day && day<=3 ? [{day,onOpen:()=>onOpen(m),disabled:!canOpenModule(m),status:m.status==='passed'?`Quiz passed${m.score!=null?` · ${m.score}%`:''}`:`${m.questions} quiz questions · Pass at ${m.pass_pct}%`}] : [];
      })} />
      {bay.map((section) => (
        <section key={section.label} className="ah-section">
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
                      <span className="ah-mod-title">{learningTitle(m)}</span>
                      <span className="ah-mod-sub">
                        {done ? `Quiz passed${m.score != null ? ` · ${m.score}%` : ''}` : openable ? 'Open' : 'Coming'}
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
