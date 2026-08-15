// A safe, working contact record the learner actually operates.
//
// The point is muscle memory, not recall: pick a stage and save it, write a
// note, schedule a dated task, and watch the record change the way a real one
// would. Nothing here can break anything, so there is no reason to be careful.
//
// The grading is server-side (POST /rep/record/grade) — the expected stage,
// note and task never reach the browser, so the answer cannot be read out of
// the page.
import { useState } from 'react';
import { gradeRecordPractice, isDemo, type RecordGrade } from '../lib/api';

// The full ladder from slide 10. Offering only the plausible few would make the
// honest answer easier to guess than it is in the real product.
const STAGES = [
  'Lead', 'Attempted Contact', 'Spoke with Customer', 'Appointment Set',
  'Met with Customer', 'Showing Homes', 'Submitting Offers', 'Under Contract', 'Closed',
];

type Fact = [string, string];

type Pack = {
  title: string;
  brief: string;
  situation: string;
  startStage: string;
  startNote?: string;
  facts: Fact[];
  activity: string[];
};

export const PACKS: Record<string, Pack> = {
  'avery-new': {
    title: 'A new lead just landed',
    brief: 'Avery Morgan has just arrived from Zillow. Nobody has spoken to them. Leave the record honest, and leave yourself a way back to it.',
    situation: 'You have not contacted Avery yet. It is 9:10 AM.',
    startStage: 'Lead',
    facts: [
      ['Contact', 'Avery Morgan'],
      ['Source', 'Zillow property inquiry'],
      ['Property', '406 Juniper Ln'],
      ['Arrived', 'Today, 9:04 AM'],
    ],
    activity: ['9:04 AM — Lead created from Zillow property inquiry'],
  },
  'avery-spoke': {
    title: 'You just got off the phone',
    brief: 'You reached Avery and learned what they are looking for. Nothing is booked. Leave a record another agent could pick up.',
    situation: 'Call ended 2 minutes ago. Avery is buying with their sister, wants Olympia or Lacey, at least 3 bedrooms, before November. They asked you to send a couple of options. No appointment was discussed.',
    startStage: 'Lead',
    facts: [
      ['Contact', 'Avery Morgan'],
      ['Source', 'Zillow property inquiry'],
      ['Property', '406 Juniper Ln'],
      ['Reached', 'Today, 4:46 PM'],
    ],
    activity: ['4:46 PM — Outgoing call, 6 min', '9:04 AM — Lead created from Zillow property inquiry'],
  },
  'avery-appointment': {
    title: 'You booked the appointment',
    brief: 'Avery confirmed a time. Make the record say so — and leave the thing you owe them before you meet.',
    situation: 'You spoke with Avery and confirmed Saturday at 11:00 AM to walk 406 and 422 Juniper Ln. Two adults are coming. They asked for access details beforehand.',
    startStage: 'Spoke with Customer',
    facts: [
      ['Contact', 'Avery Morgan'],
      ['Source', 'Zillow property inquiry'],
      ['Property', '406 Juniper Ln'],
      ['Confirmed', 'Saturday, 11:00 AM'],
    ],
    activity: ['6:18 PM — Outgoing call, 9 min', '4:46 PM — Outgoing call, 6 min', '9:04 AM — Lead created'],
  },
};

export type PracticeScenario = keyof typeof PACKS;

type Entry = { when: string; text: string; kind: 'stage' | 'note' | 'task' };

const stamp = () =>
  new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function PracticeRecord({
  scenario, onPassed, record = true,
}: {
  scenario: PracticeScenario;
  onPassed?: () => void;
  record?: boolean;
}) {
  const pack = PACKS[scenario];
  const [stage, setStage] = useState(pack.startStage);
  const [savedStage, setSavedStage] = useState(pack.startStage);
  const [noteDraft, setNoteDraft] = useState('');
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [tasks, setTasks] = useState<Array<{ title: string; date: string; time: string }>>([]);
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [grade, setGrade] = useState<RecordGrade | null>(null);

  const dirty = stage !== savedStage;

  const saveStage = () => {
    setSavedStage(stage);
    setLog((l) => [{ when: stamp(), text: `Stage changed to ${stage}`, kind: 'stage' }, ...l]);
  };

  const addNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    setNote(text);
    setNoteDraft('');
    setLog((l) => [{ when: stamp(), text, kind: 'note' }, ...l]);
  };

  const addTask = () => {
    const t = taskTitle.trim();
    if (!t) return;
    setTasks((x) => [...x, { title: t, date: taskDate, time: taskTime }]);
    setLog((l) => [{
      when: stamp(),
      text: `Task created — ${t}${taskDate ? ` · due ${taskDate}${taskTime ? ` ${taskTime}` : ''}` : ''}`,
      kind: 'task',
    }, ...l]);
    setTaskTitle(''); setTaskDate(''); setTaskTime('');
  };

  const check = async () => {
    if (isDemo) { setErr('This grades on the server. Sign in to submit.'); return; }
    setBusy(true); setErr('');
    try {
      const g = await gradeRecordPractice(scenario, {
        stage: savedStage,
        stageSaved: !dirty && log.some((e) => e.kind === 'stage'),
        note,
        task: tasks.length
          ? { title: tasks[0].title, dueDate: tasks[0].date, dueTime: tasks[0].time }
          : undefined,
      }, { record });
      setGrade(g);
      if (g.passed) onPassed?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not check this. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pr">
      <div className="pr-brief">
        <h3 className="pr-brieftitle">{pack.title}</h3>
        <p>{pack.brief}</p>
        <div className="pr-situation"><b>What just happened:</b> {pack.situation}</div>
      </div>

      <div className="pr-grid">
        {/* ── the record ── */}
        <section className="pr-record">
          <header className="pr-head">
            <div className="pr-avatar">AM</div>
            <div className="pr-who">
              <div className="pr-name">Avery Morgan</div>
              <div className="pr-src">Zillow property inquiry · Training Source</div>
            </div>
            <span className={`pr-stagepill${dirty ? ' dirty' : ''}`}>{savedStage}</span>
          </header>

          <div className="pr-details">
            {pack.facts.map(([k, v]) => (
              <div key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>

          {tasks.length > 0 && (
            <div className="pr-tasks">
              <h4>Tasks</h4>
              {tasks.map((t, i) => (
                <div key={i} className="pr-task">
                  <span className="pr-taskdot" />
                  <span className="pr-tasktitle">{t.title}</span>
                  <span className="pr-taskdue">{t.date ? `${t.date}${t.time ? ` · ${t.time}` : ''}` : 'no date'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pr-timeline">
            <h4>Activity</h4>
            {log.map((e, i) => (
              <div key={i} className={`pr-event is-${e.kind}`}>
                <span className="pr-when">{e.when}</span>
                <span className="pr-what">{e.text}</span>
              </div>
            ))}
            {pack.activity.map((a) => (
              <div key={a} className="pr-event is-old"><span className="pr-what">{a}</span></div>
            ))}
          </div>
        </section>

        {/* ── the controls ── */}
        <section className="pr-work">
          <div className="pr-block">
            <h4>Stage</h4>
            <div className="pr-stagerow">
              <select value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className={`pr-save${dirty ? ' on' : ''}`} onClick={saveStage} disabled={!dirty}>
                ✓ Save
              </button>
            </div>
            {dirty && <p className="pr-warn">Not saved yet — choosing a stage does not save it.</p>}
          </div>

          <div className="pr-block">
            <h4>Create note</h4>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={6}
              placeholder="Start with your initials. What happened, what they need, what happens next and when."
            />
            <button className="pr-btn" onClick={addNote} disabled={!noteDraft.trim()}>Create note</button>
          </div>

          <div className="pr-block">
            <h4>Create task</h4>
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Your initials — then what you will do"
            />
            <div className="pr-taskrow">
              <label>Due date<input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} /></label>
              <label>Time<input type="time" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} /></label>
            </div>
            <button className="pr-btn" onClick={addTask} disabled={!taskTitle.trim()}>Create task</button>
          </div>

          {grade && (
            <ul className="pr-checks">
              {grade.checks.map((c) => (
                <li key={c.id} className={c.pass ? 'ok' : 'no'}>
                  <b>{c.label}</b> — {c.message}
                </li>
              ))}
            </ul>
          )}
          {grade?.passed && <p className="lab-ok">That is a record someone else could pick up. {grade.score}/{grade.max}.</p>}
          {err && <div className="err">{err}</div>}

          <button className="btn ac-btn" onClick={() => void check()} disabled={busy}>
            {busy ? 'Checking…' : grade?.passed ? 'Check again' : 'Check my record'}
          </button>
        </section>
      </div>
    </div>
  );
}
