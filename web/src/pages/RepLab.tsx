// The practice-record exercises from Day 1 — Avery (slide 15 of the deck, the
// main exercise) and Elena (an extra record, not part of the Day 1 deck).
//
// These are NOT standalone activities. `LabExercise` renders with no page chrome
// so it can sit inside a lesson at the point in the training where it belongs;
// `LabView` is the thin full-page wrapper kept for the leader's test drive.
//
// Layout is deliberately ONE column. The earlier two-column split put a
// full-width Follow Up Boss screenshot into roughly 290px of a 600px page, which
// is unreadable — the whole point of using the real screen is that you can read
// it. Screenshots open full size in a new tab.
import { useState } from 'react';
import { gradeLab, isDemo, type LabGrade } from '../lib/api';

const RISKS: Array<{ id: string; label: string }> = [
  { id: 'wrong_stage', label: 'The saved stage does not match the outcome' },
  { id: 'weak_note', label: 'The note would not let a teammate take over' },
  { id: 'missing_task', label: 'There is no dated next action' },
  { id: 'ignored_activity', label: 'Visible home activity is not used as context' },
];

// One shot, not two. The separate close-up of the note composer was noise: the
// composer is already visible on the record, and a second image of it made the
// record itself smaller, which is the opposite of the point.
const SHOTS = [
  { src: '/rep-lab/detail-full.png', cap: 'The contact record',
    alt: 'Follow Up Boss contact record from the training account' },
];

// The full ladder as taught on slide 10 of the Day 1 deck. Showing only the
// first three would make the honest answer easier to guess than it should be.
const STAGES = [
  'Lead',
  'Attempted Contact',
  'Spoke with Customer',
  'Appointment Set',
  'Met with Customer',
  'Showing Homes',
  'Submitting Offers',
  'Under Contract',
  'Closed',
];

// Avery's repair used to live here. It moved onto the practice-record surface —
// the full-width Follow Up Boss screen the rest of Day 1 uses — because a
// full-width record squeezed into a lesson column is unreadable, and because
// grading her note on whether it contained the word "Thursday" failed correct work.
const PACKS = {
  'elena-homework': {
    title: 'Elena asked for a next step. Leave the proof.',
    blurb: 'Complete the record from the facts. 8 out of 10, no critical miss.',
    audit: false,
    contactHint: 'Elena Brooks — L03',
    startStage: 'Lead',
    startNote: '',
    facts: [
      ['Contact', 'Elena Brooks — L03'],
      ['Source', 'Zillow property inquiry · 908 Alder Creek Rd, Olympia, WA'],
      ['How she asked to be reached', 'Phone · after 4:30 PM'],
      ['Home Activity', 'Viewed 908 twice and saved it. Viewed 875 Alder Creek Rd once.'],
      ['What actually happened', 'Reached at 4:46 PM. Buying with her sister. Wants Olympia or Lacey, 3+ bedrooms, before November. No appointment. She asked for a side-by-side of the two Alder Creek homes by Monday morning.'],
    ] as Array<[string, string]>,
  },
};

export type LabScenario = keyof typeof PACKS;

/** The exercise itself, with no page chrome — embeddable inside a lesson. */
export function LabExercise({
  scenario = 'elena-homework', record = true, onPassed, onDone, compact = false,
}: {
  scenario?: LabScenario;
  record?: boolean;
  onPassed?: () => void;
  /** Called by the finish button when the exercise is standalone. */
  onDone?: () => void;
  /** Inside a lesson: drop the big title block, the lesson already framed it. */
  compact?: boolean;
}) {
  const pack = PACKS[scenario];
  const [phase, setPhase] = useState<'audit' | 'repair'>(pack.audit ? 'audit' : 'repair');
  const [contactName, setContactName] = useState('');
  const [risks, setRisks] = useState<string[]>([]);
  const [stage, setStage] = useState(pack.startStage);
  const [note, setNote] = useState(pack.startNote);
  const [channel, setChannel] = useState(scenario === 'elena-homework' ? 'phone' : '');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [grade, setGrade] = useState<LabGrade | null>(null);
  const [auditDone, setAuditDone] = useState(!pack.audit);
  // Zoom happens IN PLACE. The record has to stay on screen while you type.
  const [zoom, setZoom] = useState<string | null>(null);

  function toggleRisk(id: string) {
    setRisks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit() {
    if (isDemo) {
      setErr('This practice grades on the server. Sign in to submit.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const g = await gradeLab(
        scenario,
        phase === 'audit'
          ? { phase: 'audit', contactName, risks }
          : { phase: 'repair', contactName, stage, note, task: { title, owner, due }, channel },
        { record },
      );
      setGrade(g);
      if (g.passed && phase === 'audit') setAuditDone(true);
      if (g.passed && phase === 'repair') onPassed?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not grade this. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const failed = grade?.checks.filter((c) => !c.pass) ?? [];
  const canRepair = auditDone && phase === 'repair';
  const nextDead = phase === 'repair' && !(grade?.passed && grade.phase === 'repair');

  // Spelled out, and ticked off as they go. Someone landing on a contact record
  // should never have to guess what is being asked of them.
  const jobs = pack.audit
    ? [
        { text: 'Tick every problem you can see with this record. You cannot edit anything until this passes.', done: auditDone },
        { text: 'Change the stage to the one that matches what actually happened.', done: canRepair && stage !== pack.startStage },
        { text: 'Replace the note so a teammate could pick this up tomorrow.', done: canRepair && note.trim() !== pack.startNote },
        { text: 'Add a task with an owner and a date on it.', done: !!title.trim() && !!due.trim() },
      ]
    : [
        { text: 'Choose the stage that matches what actually happened.', done: stage !== pack.startStage },
        { text: 'Write the note.', done: note.trim().length > 0 },
        { text: 'Add a task with an owner and a date on it.', done: !!title.trim() && !!due.trim() },
      ];

  return (
    <div className="lab">
      {!compact && (
        <div className="lab-head">
          <div className="ac-hero2-ey">Practice · keep a lead</div>
          <h1>{pack.title}</h1>
          <p>{pack.blurb}</p>
        </div>
      )}

      <div className="pr-jobs lab-jobs">
        <h4>Your job — {jobs.filter((j) => j.done).length} of {jobs.length} done</h4>
        <ol>
          {jobs.map((j, i) => (
            <li key={j.text} className={j.done ? 'is-done' : ''}>
              <span className="pr-tick">{j.done ? '✓' : i + 1}</span>
              <span>{j.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <section className="lab-record">
        <h3>The real screen</h3>
        <p className="lab-hint">
          Follow Up Boss from the training account. The name in the shot is not the person in this
          exercise — work from the facts underneath. Click a shot to zoom it without losing your place.
        </p>
        <div className="lab-shots">
          {SHOTS.map((shot) => (
            <figure key={shot.src}>
              <button
                type="button"
                className={`lab-shot${zoom === shot.src ? ' zoomed' : ''}`}
                onClick={() => setZoom(zoom === shot.src ? null : shot.src)}
                aria-label={zoom === shot.src ? `Shrink ${shot.cap}` : `Enlarge ${shot.cap}`}
              >
                <img src={shot.src} alt={shot.alt} />
              </button>
              <figcaption>
                <span>{shot.cap}</span>
                <span>{zoom === shot.src ? 'Click to shrink' : 'Click to zoom'}</span>
                <a href={shot.src} target="_blank" rel="noreferrer">Open full size ↗</a>
              </figcaption>
            </figure>
          ))}
        </div>

        <h3>What you know</h3>
        <dl className="lab-facts">
          {pack.facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="lab-work">
        {pack.audit && (
          <div className="lab-phases">
            <button className={phase === 'audit' ? 'on' : ''} onClick={() => { setPhase('audit'); setGrade(null); }}>
              1. Find the problems
            </button>
            <button className={phase === 'repair' ? 'on' : ''} disabled={!auditDone} onClick={() => { setPhase('repair'); setGrade(null); }}>
              2. Repair the record
            </button>
          </div>
        )}

        {phase === 'audit' ? (
          <>
            <label>
              Whose record is this?
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={pack.contactHint} />
            </label>
            <p className="lab-hint">Check every problem you can see. Editing stays locked until this passes.</p>
            <ul className="lab-risks">
              {RISKS.map((r) => (
                <li key={r.id}>
                  <label>
                    <input type="checkbox" checked={risks.includes(r.id)} onChange={() => toggleRisk(r.id)} />
                    {r.label}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <label>
              Whose record is this?
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={pack.contactHint} />
            </label>
            {scenario === 'elena-homework' && (
              <label>
                Channel used
                <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Phone, or name the practice substitute" />
              </label>
            )}
            <label>
              Stage
              <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={!canRepair}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Note — start with your initials, then what happened, what they need, what is next and when
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={8} disabled={!canRepair} />
            </label>
            <label>
              Task
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What will you do?" disabled={!canRepair} />
            </label>
            <div className="lab-row">
              <label>
                Owner
                <input value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!canRepair} />
              </label>
              <label>
                Due
                <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="Date and time" disabled={!canRepair} />
              </label>
            </div>
          </>
        )}

        {failed.length > 0 && (
          <ul className="lab-fail">
            {failed.map((c) => <li key={c.id}>{c.message}</li>)}
          </ul>
        )}
        {grade?.passed && phase === 'audit' && (
          <p className="lab-ok">You found the problems. Repair the record next.</p>
        )}
        {grade?.passed && phase === 'repair' && (
          <p className="lab-ok">
            This record would let a teammate take over.
            {grade.score != null && grade.max != null ? ` ${grade.score}/${grade.max}.` : ' That’s the standard.'}
          </p>
        )}
        {err && <div className="err">{err}</div>}

        <button
          className="btn ac-btn"
          disabled={busy}
          onClick={() => {
            if (phase === 'repair' && grade?.passed) { onDone?.(); return; }
            if (phase === 'audit' && grade?.passed) { setPhase('repair'); setGrade(null); return; }
            void submit();
          }}
        >
          {busy ? 'Checking…' : phase === 'audit' ? (grade?.passed ? 'Repair the record' : 'Check my diagnosis') : (grade?.passed ? 'Done' : 'Check the record')}
        </button>
        {phase === 'repair' && nextDead && !busy && (
          <p className="lab-hint">The stage, note, and dated task all have to pass before this counts.</p>
        )}
      </section>
    </div>
  );
}

/** Full-page wrapper — the leader's test drive from the Rep dashboard. */
export function LabView({
  onBack, onPassed, record = true, scenario = 'elena-homework',
}: {
  onBack: () => void;
  onPassed?: () => void;
  record?: boolean;
  scenario?: LabScenario;
}) {
  return (
    <div className="ac">
      <header className="ac-top">
        <button className="link small" onClick={onBack}>‹ Back</button>
      </header>
      <main className="ac-main ac-main-wide">
        <LabExercise scenario={scenario} record={record} onPassed={onPassed} onDone={onBack} />
      </main>
    </div>
  );
}
