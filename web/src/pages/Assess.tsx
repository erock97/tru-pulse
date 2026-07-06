import { useEffect, useState } from 'react';
import { resolveCohortRoster } from '../lib/api';
import '../truHqDark.css';
import './assess.css';

type Stage = 'pick'|'intro'|'personal'|'personalResult'|'pro'|'proResult'|'register'|'done';

export default function Assess({ token }: { token: string }) {
  const [roster, setRoster] = useState<{ id: string; name: string }[] | null>(null);
  const [err, setErr] = useState('');
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [stage, setStage] = useState<Stage>('pick');

  useEffect(() => {
    setErr('');
    if (!token) { setErr('This link is missing its team code. Ask your team lead for a fresh link.'); return; }
    resolveCohortRoster(token).then(setRoster).catch(() => setErr('This team link could not be opened. Ask your team lead for a fresh link.'));
  }, [token]);

  if (err) return <div className="asx-shell tru-dark"><div className="asx-card asx-msg">{err}</div></div>;
  if (!roster) return <div className="asx-shell tru-dark"><div className="spinner" /></div>;

  if (stage === 'pick') {
    return (
      <div className="asx-shell tru-dark">
        <div className="asx-card">
          <div className="asx-eyebrow">TRU · Behavioral Assessment</div>
          <h1 className="asx-h1">Which one is you?</h1>
          <p className="asx-sub">Pick your name to begin. Two quick parts — who you are, then how you work.</p>
          <div className="asx-picklist">
            {roster.map((r) => (
              <button key={r.id} className="asx-pick" onClick={() => { setAgent(r); setStage('intro'); }}>{r.name}</button>
            ))}
            {roster.length === 0 && <div className="asx-msg">No one’s been added to coaching for this team yet. Check with your team lead.</div>}
          </div>
        </div>
      </div>
    );
  }
  // stages 'intro'..'done' implemented in Task 6/7
  return <AssessFlow token={token} agent={agent!} stage={stage} setStage={setStage} />;
}

function AssessFlow(_: any) { return <div className="asx-shell tru-dark"><div className="asx-card">Coming in Task 6</div></div>; }
