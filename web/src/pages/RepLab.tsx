import { useState } from 'react';
import { gradeLab, isDemo, type LabGrade } from '../lib/api';

const RISKS: Array<{ id: string; label: string }> = [
  { id: 'wrong_stage', label: 'The saved stage does not match the outcome' },
  { id: 'weak_note', label: 'The note would not let a teammate take over' },
  { id: 'missing_task', label: 'There is no dated next action' },
  { id: 'ignored_activity', label: 'Visible home activity is not used as context' },
];

const STAGES = ['Lead', 'Spoke with customer', 'Appointment set'];

const PACKS = {
  'priya-repair': {
    title: 'Priya’s record looks finished. It isn’t.',
    blurb: 'Find what is wrong before you edit. Then leave a record a teammate could work tomorrow.',
    audit: true,
    contactHint: 'Priya Shah — L03',
    startStage: 'Appointment set',
    startNote: 'Talked. Interested. Follow up later.',
    facts: [
      ['Contact', 'Priya Shah — L03'],
      ['Source', 'Zillow property inquiry · 406 Juniper Ln, Puyallup, WA'],
      ['Home Activity', 'Viewed 406 Juniper Ln 4 times. Saved 422 Juniper Ln. Viewed 510 Pinecrest Ct.'],
      ['What actually happened', 'Reached Tue Aug 11 at 7:41 PM. Comparing Puyallup homes with her spouse. Needs at least 3 bedrooms. No appointment date or time. She asked for a Thursday-morning comparison of 406 and 422 Juniper Ln.'],
      ['Saved stage', 'Appointment set'],
      ['Note', 'Talked. Interested. Follow up later.'],
      ['Task', 'None'],
    ] as Array<[string, string]>,
  },
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

export function LabView({
  onBack, onPassed, record = true, scenario = 'priya-repair',
}: {
  onBack: () => void;
  onPassed?: () => void;
  record?: boolean;
  scenario?: keyof typeof PACKS;
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

  return (
    <div className="ac">
      <header className="ac-top">
        <button className="link small" onClick={onBack}>‹ All modules</button>
      </header>
      <main className="ac-main ac-lab">
        <div className="ac-lab-head">
          <div className="ac-hero2-ey">Library · keep a lead</div>
          <h1>{pack.title}</h1>
          <p>{pack.blurb}</p>
        </div>

        <div className="ac-lab-split">
          <section className="ac-lab-record">
            <h2>The real screen</h2>
            <p className="ac-lab-hint">Training-account Follow Up Boss. The name in the shot is not the lab person. Use the facts below.</p>
            <div className="ac-lab-shots">
              <figure>
                <img src="/rep-lab/detail-full.png" alt="Follow Up Boss contact record from the training account" />
                <figcaption>Contact record</figcaption>
              </figure>
              <figure>
                <img src="/rep-lab/detail-note-composer.png" alt="Follow Up Boss create-note composer" />
                <figcaption>Note</figcaption>
              </figure>
            </div>
            <h2>Facts for this lab</h2>
            <dl>
              {pack.facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="ac-lab-work">
            {pack.audit && (
              <div className="ac-lab-phases">
                <button className={phase === 'audit' ? 'on' : ''} onClick={() => { setPhase('audit'); setGrade(null); }}>1. Find the problems</button>
                <button className={phase === 'repair' ? 'on' : ''} disabled={!auditDone} onClick={() => { setPhase('repair'); setGrade(null); }}>2. Repair the record</button>
              </div>
            )}

            {phase === 'audit' ? (
              <>
                <label>
                  Whose record is this?
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={pack.contactHint} />
                </label>
                <p className="ac-lab-hint">Check every problem you can see. Editing stays locked until this passes.</p>
                <ul className="ac-lab-risks">
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
                  Note
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={7} disabled={!canRepair} />
                </label>
                <label>
                  Task
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What will you do?" disabled={!canRepair} />
                </label>
                <div className="ac-lab-row">
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
              <ul className="ac-lab-fail">
                {failed.map((c) => <li key={c.id}>{c.message}</li>)}
              </ul>
            )}
            {grade?.passed && phase === 'audit' && (
              <p className="ac-lab-ok">You found the problems. Repair the record next.</p>
            )}
            {grade?.passed && phase === 'repair' && (
              <p className="ac-lab-ok">
                Record would let a teammate take over.
                {grade.score != null && grade.max != null ? ` ${grade.score}/${grade.max}.` : ' That’s the standard.'}
              </p>
            )}
            {err && <div className="err">{err}</div>}

            <button
              className="btn ac-btn"
              disabled={busy}
              onClick={() => {
                if (phase === 'repair' && grade?.passed) { onBack(); return; }
                if (phase === 'audit' && grade?.passed) { setPhase('repair'); setGrade(null); return; }
                void submit();
              }}
            >
              {busy ? 'Checking…' : phase === 'audit' ? (grade?.passed ? 'Repair the record' : 'Check my diagnosis') : (grade?.passed ? 'Done' : 'Check the record')}
            </button>
            {phase === 'repair' && nextDead && !busy && (
              <p className="ac-lab-hint">Next stays locked until the stage, note, and dated task all pass.</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
