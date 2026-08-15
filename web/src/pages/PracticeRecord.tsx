// A practice contact record built ON the real Follow Up Boss screen.
//
// Eric's rule: no fabricated UI. A learner has to recognise the product when
// they open it for real, so the background here is the actual FUB screenshot
// from the training account and the controls sit exactly where FUB puts them —
// the stage in the Details panel, the note composer at the top, the Tasks panel
// on the right. Everything is a real control; nothing writes anywhere real.
//
// Hotspots are percentages of the screenshot's own 1810×869, so the whole thing
// scales with the image and stays aligned at any width.
import { useState } from 'react';
import { gradeRecordPractice, isDemo, type RecordGrade } from '../lib/api';

const SHOT = '/rep-lab/detail-full.png';

// The ladder from slide 10 of the Day 1 deck.
const STAGES = [
  'Lead', 'Attempted Contact', 'Spoke with Customer', 'Appointment Set',
  'Met with Customer', 'Showing Homes', 'Submitting Offers', 'Under Contract', 'Closed',
];

type Pack = {
  title: string;
  brief: string;
  situation: string;
  startStage: string;
};

export const PACKS: Record<string, Pack> = {
  'avery-new': {
    title: 'A new lead just landed',
    brief: 'Avery Morgan just arrived from Zillow and nobody has spoken to them. Leave the record honest, and leave yourself a way back to it.',
    situation: 'It is 9:10 AM. You have not contacted Avery yet.',
    startStage: 'Lead',
  },
  'avery-spoke': {
    title: 'You just got off the phone',
    brief: 'You reached Avery and learned what they are looking for. Nothing is booked.',
    situation: 'Avery is buying with their sister, wants Olympia or Lacey, at least 3 bedrooms, before November. They asked you to send a couple of options. No appointment was discussed.',
    startStage: 'Lead',
  },
  'avery-appointment': {
    title: 'You booked the appointment',
    brief: 'Avery confirmed a time. Make the record say so — and leave the thing you owe them before you meet.',
    situation: 'Avery confirmed Saturday at 11:00 AM to walk 406 and 422 Juniper Ln. Two adults are coming. They asked for access details beforehand.',
    startStage: 'Spoke with Customer',
  },
};

export type PracticeScenario = keyof typeof PACKS;

type Entry = { when: string; text: string; kind: 'stage' | 'note' | 'task' };

const stamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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
  const [stageOpen, setStageOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [everSaved, setEverSaved] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [note, setNote] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [tasks, setTasks] = useState<Array<{ title: string; date: string; time: string }>>([]);
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [grade, setGrade] = useState<RecordGrade | null>(null);

  const dirty = stage !== savedStage;

  // Green check commits. Red X throws the change away, exactly as it does in FUB.
  const commitStage = () => {
    setEditing(false);
    setStageOpen(false);
    if (stage === savedStage) return;
    setSavedStage(stage);
    setEverSaved(true);
    setLog((l) => [{ when: stamp(), text: `Stage changed to ${stage}`, kind: 'stage' }, ...l]);
  };

  const cancelStage = () => {
    setStage(savedStage);
    setEditing(false);
    setStageOpen(false);
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
    setTaskTitle(''); setTaskDate(''); setTaskTime(''); setTaskOpen(false);
  };

  const check = async () => {
    if (isDemo) { setErr('This grades on the server. Sign in to submit.'); return; }
    setBusy(true); setErr('');
    try {
      const g = await gradeRecordPractice(scenario, {
        stage: savedStage,
        stageSaved: everSaved && !dirty,
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
        <p className="pr-safe">
          This is the real Follow Up Boss screen. Everything on it works, and nothing you do here
          touches a real contact — so click around.
        </p>
      </div>

      <div className="fub">
        <img className="fub-shot" src={SHOT} alt="A Follow Up Boss contact record for Avery Morgan" />

        {/* ── Stage, in the Details panel, editing exactly the way FUB does it:
             the row turns into a bordered field with a chevron, and a green
             check and a red X appear beside it. Nothing is committed until the
             green check — which is the mistake the deck says everyone makes. ── */}
        {!editing ? (
          <button className="fub-hot fub-stageread" onClick={() => { setEditing(true); setStageOpen(true); }}>
            {savedStage}
          </button>
        ) : (
          <div className="fub-hot fub-stageedit">
            <button className="fub-stagefield" onClick={() => setStageOpen((o) => !o)}>
              <b>Stage</b><span className="fub-stagepick">{stage}</span>
              <span className="fub-caret">⌄</span>
            </button>
            <button className="fub-ok" onClick={commitStage} title="Save">✓</button>
            <button className="fub-cancel" onClick={cancelStage} title="Cancel">✕</button>
            {stageOpen && (
              <ul className="fub-menu">
                {STAGES.map((s) => (
                  <li key={s}>
                    <button
                      className={s === stage ? 'on' : ''}
                      onClick={() => { setStage(s); setStageOpen(false); }}
                    >{s}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── The note composer at the top of the record ── */}
        <textarea
          className="fub-hot fub-note"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Add notes or type @name to notify"
        />
        <button className="fub-hot fub-notebtn" onClick={addNote} disabled={!noteDraft.trim()}>
          Create Note
        </button>

        {/* ── The Tasks panel on the right ── */}
        <button className="fub-hot fub-taskadd" onClick={() => setTaskOpen((o) => !o)} title="Add a task">+</button>
        <div className="fub-hot fub-tasklist">
          {tasks.length === 0 ? (
            <span className="fub-empty">No upcoming tasks</span>
          ) : tasks.map((t, i) => (
            <div key={i} className="fub-taskrow">
              <span className="fub-taskname">{t.title}</span>
              <span className="fub-taskdue">{t.date ? `${t.date}${t.time ? ` · ${t.time}` : ''}` : 'no date'}</span>
            </div>
          ))}
        </div>
        {taskOpen && (
          <div className="fub-hot fub-taskform">
            <label>Task<input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Your initials — then what you will do" /></label>
            <div className="fub-taskrow2">
              <label>Due<input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} /></label>
              <label>Time<input type="time" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} /></label>
            </div>
            <div className="fub-taskbtns">
              <button className="fub-ghost" onClick={() => setTaskOpen(false)}>Cancel</button>
              <button className="fub-primary" onClick={addTask} disabled={!taskTitle.trim()}>Save task</button>
            </div>
          </div>
        )}

        {/* ── What you did, in the record's own timeline ── */}
        {log.length > 0 && (
          <div className="fub-hot fub-log">
            {log.map((e, i) => (
              <div key={i} className={`fub-logrow is-${e.kind}`}>
                <span className="fub-logwhen">{e.when}</span>
                <span className="fub-logtext">{e.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pr-after">
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
      </div>
    </div>
  );
}
