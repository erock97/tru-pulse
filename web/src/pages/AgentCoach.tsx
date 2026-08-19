// Their side of the coaching: what the assessment says about them, and the wins and
// commitments their leader logged. The leader's private note and checklist live in
// checkin_leader, which this surface never even fetches — see
// db/hq_coach_1on1_structured.sql:52.
//
// The assessment result render is Task 5 of the agent-experience plan.
import { useEffect, useState } from 'react';
import { loadMyOneOnOnes, type MyOneOnOne } from '../lib/coachData';
import { MyOneOnOnes } from './AgentCourse';
import type { AgentHome, AgentIdentity } from '../lib/api';

export default function AgentCoach({ agent, home }: {
  agent: AgentIdentity;
  home: AgentHome | null;
}) {
  const [oneOnOnes, setOneOnOnes] = useState<MyOneOnOne[] | null>(null);

  useEffect(() => {
    // A failure here must never blank the tab — an empty list reads the same as
    // "no 1:1s yet", which is the honest thing to show when we can't load them.
    void loadMyOneOnOnes(agent.id).then(setOneOnOnes).catch(() => setOneOnOnes([]));
  }, [agent.id]);

  if (!home) return <div className="center-wrap"><div className="spinner" /></div>;

  return (
    <main className="ac-main">
      {oneOnOnes && <MyOneOnOnes list={oneOnOnes} />}
    </main>
  );
}
