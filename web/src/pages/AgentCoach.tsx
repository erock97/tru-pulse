// Their side of the coaching: what the assessment says about them, and the wins and
// commitments their leader logged.
//
// The leader's private note and checklist live in checkin_leader, which this surface
// never even fetches — see db/hq_coach_1on1_structured.sql:52.
//
// Note on what this is: until now nothing showed an agent their own stored result.
// Assess.tsx has told people "sign in any time to revisit your result" while there
// was nowhere to revisit it. This is that place.
import { useEffect, useState } from 'react';
import { loadMyOneOnOnes, type MyOneOnOne } from '../lib/coachData';
import { MyOneOnOnes } from './AgentCourse';
import { ARCH, AG, PERSONAL_TYPES } from '../lib/assessmentData';
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

  const a = home.assessment;
  // Deliberately no fallback profile. Showing someone else's read of them because
  // their code didn't resolve would be worse than showing nothing.
  const arch = a ? ARCH[a.code] : undefined;
  const you = a ? AG[a.code] : undefined;
  const personal = a?.personal_code ? PERSONAL_TYPES[a.personal_code] : undefined;

  return (
    <main className="ac-main">
      {!a ? (
        <section className="ag-card">
          <h2 className="ag-h2">Your profile</h2>
          <p className="ag-empty">
            You haven’t taken the assessment yet. It takes about ten minutes and tells
            your team lead how to coach you the way you actually learn.
          </p>
        </section>
      ) : (
        <>
          {arch && (
            <div className="ac-hero2 fu">
              <div className="ac-hero2-txt">
                <div className="ac-hero2-ey">How you work</div>
                <h1>{arch.emoji} {arch.name}</h1>
                <p>{arch.tagline}</p>
              </div>
            </div>
          )}

          {you && (
            <section className="ag-card">
              <h2 className="ag-h2">What this means for you</h2>
              <dl className="ag-profile">
                <dt>Your superpower</dt><dd>{you.sup}</dd>
                <dt>Your growth edge</dt><dd>{you.edge}</dd>
                <dt>Watch for</dt><dd>{you.watch}</dd>
                <dt>The challenge</dt><dd>{you.challenge}</dd>
              </dl>
            </section>
          )}

          {personal && (
            <section className="ag-card">
              <h2 className="ag-h2">Outside of work — {personal.name}</h2>
              <p className="ag-profile-desc">{personal.desc}</p>
              <ul className="ag-strengths">
                {personal.strengths.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <p className="ag-empty">{personal.watch}</p>
            </section>
          )}

          {!arch && !you && (
            <section className="ag-card">
              <h2 className="ag-h2">Your profile</h2>
              <p className="ag-empty">
                Your result is saved but we couldn’t render it. Ask your team lead to
                walk you through it — they have the full read.
              </p>
            </section>
          )}

          <p className="ag-taken">
            Taken {new Date(a.taken_at).toLocaleDateString('en-US',
              { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </>
      )}

      {oneOnOnes && <MyOneOnOnes list={oneOnOnes} />}
    </main>
  );
}
