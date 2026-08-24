// The full personality profile — one agent, read properly.
//
// This page exists because the deep readout matters to Eric and to team leads
// ("that read me to a T") but does NOT belong in the weekly workflow's face.
// The 1:1 prep sheet links here; this page takes the room a real portrait
// needs. Composition is a typeset dossier in calm full-width bands — portrait
// first, then the axes, then where life and work diverge, then what to DO with
// all of it (channels, coaching) — never a mosaic of equal-weight cards.
//
// The portrait content is the RECOVERED original (lib/personalityDeep.ts):
// per-type character paragraph + evidenced strengths and blind spots, keyed by
// the agent's personal (life) code, with the professional archetype supplying
// the work-self half.
import { useEffect, useState } from 'react';
import type { Profile, RosterAgent } from '../lib/coachData';
import { loadProfile } from '../lib/coachData';
import { AG, CG, PERSONAL_TYPES, WORK_LABELS, type Pole } from '../lib/assessmentData';
import {
  CHANNEL_NAMES,
  CHANNEL_RX,
  CHANNEL_WHY,
  PERSONAL_DEEP,
  contrastProse,
} from '../lib/personalityDeep';
import type { Axis } from '../lib/assessmentData';

const AXIS_ROWS: Array<{ axis: Axis; title: string; poles: [Pole, Pole] }> = [
  { axis: 'energy', title: 'Energy', poles: ['P', 'T'] },
  { axis: 'approach', title: 'Drive', poles: ['Pro', 'Rec'] },
  { axis: 'deal', title: 'Bonds', poles: ['R', 'V'] },
  { axis: 'decision', title: 'Decisions', poles: ['D', 'I'] },
];

function letterAt(code: string, axisIndex: number): Pole | null {
  return (code.split('-')[axisIndex] as Pole) ?? null;
}

export default function AgentProfile({ agent, onBack }: {
  agent: RosterAgent;
  onBack: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let live = true;
    loadProfile(agent.id)
      .then((p) => { if (live) setProfile(p); })
      .catch(() => { /* the page degrades to the roster's own code below */ });
    return () => { live = false; };
  }, [agent.id]);

  const workCode = profile?.code ?? agent.code;
  const personalCode = profile?.personalCode ?? agent.personalCode ?? null;
  const deep = personalCode ? PERSONAL_DEEP[personalCode] : null;
  const personalName = personalCode ? PERSONAL_TYPES[personalCode]?.name : null;
  const first = agent.name.split(' ')[0];
  const rx = CHANNEL_RX[workCode];
  const diverging = personalCode
    ? AXIS_ROWS.filter((_r, i) => letterAt(personalCode, i) !== letterAt(workCode, i))
    : [];

  return (
    <div className="pf">
      <header className="dk-mast">
        <div>
          <span className="dk-eyebrow"><i />The full profile</span>
          <h1>{agent.name}</h1>
          <p className="dk-sub">{agent.archName} at work{personalName ? ` · ${personalName.toLowerCase()} at heart` : ''}</p>
        </div>
        <div className="dk-mast-do">
          <button className="btn btn-ghost" onClick={onBack}>← Back to {first}’s 1:1 sheet</button>
        </div>
      </header>

      {/* ── The portrait — who they are, before any job title ── */}
      {deep ? (
        <section className="pf-band pf-portrait-band">
          <span className="pf-k">Who {first} is</span>
          <p className="pf-portrait">{deep.desc}</p>
        </section>
      ) : (
        <section className="pf-band">
          <span className="pf-k">Who {first} is</span>
          <p className="pf-portrait">{profile?.tagline ?? agent.archName}</p>
          <p className="pf-quiet">
            {first} hasn’t taken the baseline (life) assessment yet — when they do, this
            page gains their full personal portrait, trait evidence, and the read on how
            their work self differs from their natural one.
          </p>
        </section>
      )}

      {/* ── The traits, with the behavior you'd actually see ── */}
      {deep && (
        <section className="pf-band">
          <div className="pf-cols">
            <div>
              <span className="pf-k">At their best</span>
              <ul className="pf-traits is-best">
                {deep.best.map((tr) => (
                  <li key={tr.t}><b>{tr.t}</b><p>{tr.d}</p></li>
                ))}
              </ul>
            </div>
            <div>
              <span className="pf-k">The flip side</span>
              <ul className="pf-traits is-worst">
                {deep.worst.map((tr) => (
                  <li key={tr.t}><b>{tr.t}</b><p>{tr.d}</p></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* ── The four axes — where they sit, at work and in life ── */}
      <section className="pf-band">
        <span className="pf-k">The four axes</span>
        {personalCode && (
          <p className="pf-legend">
            <i className="pf-dot is-work" /> at work · <i className="pf-dot is-life" /> in life
          </p>
        )}
        <div className="pf-axes">
          {AXIS_ROWS.map((row, i) => {
            const work = letterAt(workCode, i);
            const life = personalCode ? letterAt(personalCode, i) : null;
            return (
              <div className="pf-axis" key={row.axis}>
                <span className="pf-axis-title">{row.title}</span>
                <span className={work === row.poles[0] ? 'pf-pole is-on' : 'pf-pole'}>{WORK_LABELS[row.poles[0]]}</span>
                <span className="pf-track" aria-hidden>
                  {work && <i className={`pf-dot is-work ${work === row.poles[0] ? 'at-left' : 'at-right'}`} />}
                  {life && life !== work && <i className={`pf-dot is-life ${life === row.poles[0] ? 'at-left' : 'at-right'}`} />}
                  {life && life === work && <i className={`pf-dot is-life is-stacked ${life === row.poles[0] ? 'at-left' : 'at-right'}`} />}
                </span>
                <span className={work === row.poles[1] ? 'pf-pole is-on' : 'pf-pole'}>{WORK_LABELS[row.poles[1]]}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Where life and work part ways ── */}
      {personalCode && (
        <section className="pf-band">
          <span className="pf-k">Work self, life self</span>
          {diverging.length === 0 ? (
            <p className="pf-prose">
              {first} works the way they live — all four axes aligned. What you see in
              the office is who they actually are, which makes them easy to read and
              their pace sustainable.
            </p>
          ) : (
            <ul className="pf-contrast">
              {diverging.map((row) => (
                <li key={row.axis}>
                  <b>{row.title}</b>
                  <p>{contrastProse(row.axis, personalCode, workCode)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── The work self ── */}
      {AG[workCode] && (
        <section className="pf-band">
          <span className="pf-k">On the job — {agent.archName}</span>
          <ul className="pf-traits is-work-swot">
            <li><b>Where they do well</b><p>{AG[workCode].sup}</p></li>
            <li><b>Where they slip</b><p>{AG[workCode].watch}</p></li>
            <li><b>The work with them</b><p>{AG[workCode].edge}</p></li>
            {profile?.signal && <li><b>Warning sign</b><p>{profile.signal}</p></li>}
          </ul>
        </section>
      )}

      {/* ── Where they'll win business ── */}
      {rx && (
        <section className="pf-band">
          <span className="pf-k">Where {first} will win business</span>
          <ol className="pf-channels">
            {rx.top.map((key) => (
              <li key={key}>
                <b>{CHANNEL_NAMES[key] ?? key}</b>
                <p>{CHANNEL_WHY[key] ?? ''}</p>
              </li>
            ))}
          </ol>
          <p className="pf-prose pf-rx-note">{rx.note}</p>
          {rx.avoid.length > 0 && (
            <p className="pf-quiet">
              Against the grain: {rx.avoid.map((k) => CHANNEL_NAMES[k] ?? k).join(' · ')} —
              possible, but it costs {first} more energy per deal than the list above.
            </p>
          )}
        </section>
      )}

      {/* ── How to coach them ── */}
      {CG[workCode] && (
        <section className="pf-band">
          <span className="pf-k">How to coach {first}</span>
          <ul className="pf-traits is-coach">
            <li><b>Communicate</b><p>{CG[workCode].communicate}</p></li>
            <li><b>Motivate</b><p>{CG[workCode].motivate}</p></li>
            <li><b>Hold accountable</b><p>{CG[workCode].accountable}</p></li>
            <li><b>In conflict</b><p>{CG[workCode].conflict}</p></li>
            <li><b>FeedForward ask</b><p>{CG[workCode].feedforward}</p></li>
          </ul>
        </section>
      )}
    </div>
  );
}
