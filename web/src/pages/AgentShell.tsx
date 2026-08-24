// The agent's app. Before this, an agent signed in and landed in AgentCourse —
// the training shelf WAS the product as far as they were concerned. This is the
// shell that puts a home and their coaching alongside it.
//
// Tab state is local, not a hash route: an agent has one job at a time, and deep
// links into their own tabs buy nothing.
import { useEffect, useState } from 'react';
import {
  agentHome, signOutClean, type AgentHome, type AgentIdentity,
} from '../lib/api';
import { TruLogo } from '../components/TruLogo';
import { agentStage } from '../lib/agentStage';
import Assess from './Assess';
import AgentWelcome from './AgentWelcome';
import AgentCourse from './AgentCourse';
import AgentHomeView from './AgentHome';
import AgentCoach from './AgentCoach';
import AgentSmsStep from './AgentSms';

type Tab = 'home' | 'coach' | 'rep';
const LABEL: Record<Tab, string> = { home: 'Home', coach: 'Coach', rep: 'Training' };

export default function AgentShell({ agent }: { agent: AgentIdentity }) {
  const [tab, setTab] = useState<Tab>('home');
  const [home, setHome] = useState<AgentHome | null>(null);
  const [err, setErr] = useState('');
  // A lesson, quiz or live sim takes the whole screen — the course was built that
  // way and reads better for it. The shell steps out of the way while one is open.
  const [immersive, setImmersive] = useState(false);
  // "What's next" on Home opens a specific module rather than dropping them on the
  // shelf to find it again. Cleared by the course once it has acted on it.
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    agentHome().then(setHome).catch(() => setErr('Could not load your home. Refresh to try again.'));
  }, []);

  // The gate. A new agent sees the welcome, then the assessment, and cannot reach
  // Home, Coach or Training until it is done — no skip, no dismiss. An agent who
  // predates the cutover (`gated` false) never sees any of this.
  //
  // The text-message step that follows is deliberately NOT part of that gate: it
  // is offered once and can be walked past. See agentStage.ts.
  const stage = home
    ? agentStage({
        hasAssessment: !!home.assessment,
        welcomeSeen: !!home.welcome_seen_at,
        isNewAccount: home.gated,
        smsAsked: home.sms ? home.sms.prompted_at != null : null,
      })
    : null;

  if (home && stage === 'welcome') {
    return (
      <AgentWelcome
        onDone={() => setHome({ ...home, welcome_seen_at: new Date().toISOString() })}
      />
    );
  }

  if (home && stage === 'assessment') {
    return (
      <Assess
        token=""
        me={home.agent ?? { id: agent.id, name: agent.name }}
        onDone={() => { void agentHome().then(setHome); }}
      />
    );
  }

  if (home && stage === 'sms' && home.sms) {
    // Refetch rather than patching state locally: whether they said yes or no,
    // the authoritative answer to "have we asked" now lives in the database, and
    // guessing it here is how a consent screen ends up shown twice.
    return <AgentSmsStep sms={home.sms} onDone={() => { void agentHome().then(setHome); }} />;
  }

  const course = (
    <AgentCourse
      agent={agent}
      onImmersive={setImmersive}
      openModuleId={openModuleId}
      onOpened={() => setOpenModuleId(null)}
    />
  );

  if (immersive) return course;

  return (
    <div className="ac">
      <header className="ac-top">
        <TruLogo size={26} wordSize={19} sub="TRU" />
        <button className="link small" onClick={() => signOutClean()}>Sign out</button>
      </header>
      <nav className="ag-tabs" aria-label="Sections">
        {(Object.keys(LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            className={`ag-tab${tab === t ? ' is-on' : ''}`}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => setTab(t)}
          >
            {LABEL[t]}
          </button>
        ))}
      </nav>
      {err && <div className="ag-err">{err}</div>}
      {tab === 'home' && (
        <AgentHomeView
          agent={agent}
          home={home}
          onHome={setHome}
          onOpenModule={(id) => { setOpenModuleId(id); setTab('rep'); }}
        />
      )}
      {tab === 'coach' && <AgentCoach agent={agent} home={home} />}
      {tab === 'rep' && course}
    </div>
  );
}
