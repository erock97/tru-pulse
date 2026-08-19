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
import AgentCourse from './AgentCourse';
import AgentHomeView from './AgentHome';
import AgentCoach from './AgentCoach';

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
