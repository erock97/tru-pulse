// What to do today. Three blocks: what you committed to, how you're tracking, and
// what training is waiting on you.
//
// The dependency worth knowing: commitments are entered by the LEADER during the
// 1:1, from what the agent gave them. If a lead doesn't run 1:1s, this screen is
// empty — so the empty state says that plainly and points at them, rather than
// showing a cheerful zero that reads like the agent's own failure.
import { useEffect, useState } from 'react';
import {
  agentHome, loadCourse, setCommitmentDone,
  type AgentHome, type AgentIdentity, type CourseModule,
} from '../lib/api';
import SmsConsentForm from './AgentSms';
import { pace, PACE_LABEL } from '../lib/agentPace';

export default function AgentHomeView({ agent, home, onHome, onOpenModule }: {
  agent: AgentIdentity;
  home: AgentHome | null;
  onHome: (h: AgentHome) => void;
  onOpenModule: (moduleId: string | null) => void;
}) {
  const [mods, setMods] = useState<CourseModule[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    // The shelf failing must not take the whole home screen with it.
    void loadCourse(agent.id).then(setMods).catch(() => setMods([]));
  }, [agent.id]);

  if (!home) return <div className="center-wrap"><div className="spinner" /></div>;

  const p = pace(home.commitments);
  const firstName = (home.agent?.name ?? agent.name).split(' ')[0] || 'there';
  const nextUp = (mods ?? []).filter((m) => m.status !== 'passed').slice(0, 2);

  async function toggle(id: string, next: boolean) {
    if (!home) return;
    setErr('');
    // Optimistic: ticking a box should feel instant. Rolled back below if the
    // Worker refuses, so the screen never claims something the record doesn't.
    const before = home;
    onHome({
      ...home,
      commitments: home.commitments.map((c) => (c.id === id ? { ...c, agent_done: next } : c)),
    });
    try {
      await setCommitmentDone(id, next);
    } catch (e) {
      onHome(before);
      setErr(e instanceof Error ? e.message : 'That didn’t save — try again.');
    }
  }

  return (
    <main className="ac-main">
      <div className="ac-hero2 fu">
        <div className="ac-hero2-txt">
          <div className="ac-hero2-ey">Today</div>
          <h1>Hi {firstName}.</h1>
          <p>{p.state === 'none'
            ? 'Nothing is due from you yet. Your training library is open whenever you want it.'
            : p.state === 'complete'
              ? 'Everything you committed to is done. Tell your lead at your next 1:1.'
              : `You're ${p.done} of ${p.total} through what you committed to.`}</p>
        </div>
      </div>

      <section className="ag-card">
        <h2 className="ag-h2">Your commitments</h2>
        {p.state === 'none' ? (
          <p className="ag-empty">
            You don’t have any commitments yet. These come from your one-on-one with your
            team lead — they’ll show up here after your next one.
          </p>
        ) : (
          <>
            <ul className="ag-commits">
              {home.commitments.map((c) => (
                <li key={c.id} className={`ag-commit${c.agent_done ? ' is-done' : ''}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={c.agent_done}
                      onChange={(e) => void toggle(c.id, e.target.checked)}
                    />
                    <span>{c.body}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="ag-pace">
              <div className="ag-pace-bar"><div className="ag-pace-fill" style={{ width: `${p.pct}%` }} /></div>
              <div className="ag-pace-lbl">
                <strong>{p.done} of {p.total}</strong> · {PACE_LABEL[p.state]}
              </div>
            </div>
          </>
        )}
        {err && <div className="ag-err">{err}</div>}
      </section>

      <section className="ag-card">
        <h2 className="ag-h2">What’s next</h2>
        {nextUp.length === 0 ? (
          <p className="ag-empty">
            {mods === null
              ? 'Loading your training…'
              : 'Nothing outstanding — you’ve finished everything assigned to you.'}
          </p>
        ) : (
          <ul className="ag-next">
            {nextUp.map((m) => (
              <li key={m.id}>
                <button className="ag-next-btn" onClick={() => onOpenModule(m.id)}>
                  <span className="ag-next-title">{m.title}</span>
                  <span className="ag-next-go">
                    {m.status === 'in_progress' ? 'Continue ›' : 'Start ›'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Text messages. This card is not a nicety — an agent must be able to switch
        SMS off from inside the product at any moment, without emailing anyone and
        without hunting for it. Replying STOP works too, but somebody who has
        deleted the thread has no message left to reply to.

        Hidden entirely when `sms` is null, which means db/hq_sms_consent.sql has
        not been run in this environment yet.
      */}
      {home.sms && (
        <section className="ag-card">
          <h2 className="ag-h2">Text messages</h2>
          <SmsConsentForm
            sms={home.sms}
            onSaved={() => { void agentHome().then(onHome).catch(() => undefined); }}
          />
        </section>
      )}
    </main>
  );
}
