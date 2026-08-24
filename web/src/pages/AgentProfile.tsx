// The full personality profile — one agent, read like a case file.
//
// Eric's brief, after rejecting the first cut: no axis taxonomy, no framework
// vocabulary, no exhibits — "imagine you were a doctor handed a background on
// someone; it should read like a story, one part segueing into the next."
// So the spine of this page is PROSE: the recovered portrait flows into a
// plain-speech account of how they're wired and what changes at work, then the
// two structured moments that earn their structure (the trait evidence Eric
// liked, and the ranked channel list), each entered by a bridge sentence, and
// it closes on coaching guidance said in plain words.
//
// Content sources: lib/personalityDeep.ts (recovered originals), AG/CG
// (assessment write-ups; AG speaks to the agent as "you", so the page QUOTES
// it — "the assessment puts it to them straight" — instead of re-voicing).
import { useEffect, useState } from 'react';
import type { Profile, RosterAgent } from '../lib/coachData';
import { loadProfile } from '../lib/coachData';
import { AG, CG, PERSONAL_TYPES } from '../lib/assessmentData';
import {
  CHANNEL_NAMES,
  CHANNEL_RX,
  CHANNEL_WHY,
  PERSONAL_DEEP,
  PERSONAL_ESSAY,
  contrastLines,
} from '../lib/personalityDeep';

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
  const essay = personalCode ? PERSONAL_ESSAY[personalCode] : null;
  const personalName = personalCode ? PERSONAL_TYPES[personalCode]?.name : null;
  const first = agent.name.split(' ')[0];
  const rx = CHANNEL_RX[workCode];
  const ag = AG[workCode];
  const cg = CG[workCode];
  const contrasts = personalCode ? contrastLines(personalCode, workCode) : [];

  // The "what changes at work" sentence(s), woven rather than sectioned.
  const workShift = !personalCode ? null
    : contrasts.length === 0
      ? `And work doesn't change ${first} — the person in the office is the same one at home, which makes them easy to read and their pace sustainable.`
      : contrasts.length === 1
        ? `At work, one thing changes: ${contrasts[0].line}.`
        : `At work, ${contrasts.length === 2 ? 'two things change' : 'a few things change'}: ${contrasts.map((c) => c.line).join('. And ')}.`;

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

      {/* ── The read — one continuous opening ── */}
      <section className="pf-band pf-portrait-band">
        <span className="pf-k">Who {first} is</span>
        {deep ? (
          <>
            <p className="pf-portrait">{deep.desc}</p>
            {essay?.map((para, i) => (
              <p className="pf-lede" key={i}>{para}</p>
            ))}
            {workShift && <p className="pf-lede">{workShift}</p>}
          </>
        ) : (
          <>
            <p className="pf-portrait">{profile?.tagline ?? agent.archName}</p>
            <p className="pf-quiet">
              {first} hasn’t taken the baseline (life) assessment yet — once they do,
              this page opens with their full personal portrait and the read on how
              their work self differs from their natural one.
            </p>
          </>
        )}
      </section>

      {/* ── The evidence — the one structured moment Eric asked to keep ── */}
      {deep && (
        <section className="pf-band">
          <p className="pf-bridge">Here’s the same person, trait by trait — with the behavior you’ll actually see.</p>
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

      {/* ── The work chapter — quoted, because AG speaks to the agent ── */}
      {ag && (
        <section className="pf-band">
          <span className="pf-k">{first} at work</span>
          <p className="pf-prose">
            Put that person in a real-estate business and this is what happens. The
            assessment puts it to {first} straight: “{ag.sup}” The slip it flags:
            “{ag.watch}” And the work it prescribes: “{ag.edge}”
          </p>
          {profile?.signal && (
            <p className="pf-prose" style={{ marginTop: 12 }}>
              For you as their lead, the early warning sign reads: {profile.signal}
            </p>
          )}
        </section>
      )}

      {/* ── Where the business comes from — flows out of who they are ── */}
      {rx && (
        <section className="pf-band">
          <span className="pf-k">Where the business comes from</span>
          <p className="pf-bridge">All of that points {first}’s lead generation in one direction.</p>
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
              possible, but each deal there costs {first} more energy than the list above.
            </p>
          )}
        </section>
      )}

      {/* ── Coaching them — plain speech, no framework vocabulary ── */}
      {cg && (
        <section className="pf-band">
          <span className="pf-k">Coaching {first}</span>
          <ul className="pf-traits is-coach">
            <li><b>Talking with them</b><p>{cg.communicate}</p></li>
            <li><b>What moves them</b><p>{cg.motivate}</p></li>
            <li><b>Holding them to it</b><p>{cg.accountable}</p></li>
            <li><b>When it gets tense</b><p>{cg.conflict}</p></li>
            <li><b>A question worth asking</b><p>{cg.feedforward}</p></li>
          </ul>
        </section>
      )}
    </div>
  );
}
