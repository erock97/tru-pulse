// A practice contact record built ON the real Follow Up Boss screen.
//
// Three rules, all of them Eric's, all of them learned the hard way:
//
// 1. No fabricated UI. The background is the actual FUB screenshot from the
//    training account and every control sits where FUB puts it.
// 2. Never crop to the control being practised. "I opened a contact — now where
//    do I go?" is the real problem, so the whole record is always on screen and
//    nothing is highlighted unless the learner asks.
// 3. EVERYTHING SCALES WITH THE SCREENSHOT, not with the browser window. The
//    first version sized the overlay in vw units, so on a wide monitor the stage
//    text and the save buttons rendered enormous over a small image and the
//    whole thing looked painted on. One measured factor, --k, drives every size
//    here: --k is (rendered image width / 1810), so a 13px control in Follow Up
//    Boss is 13px here at any width.
import { useCallback, useEffect, useRef, useState } from 'react';
import { gradeRecordPractice, isDemo, type RecordGrade } from '../lib/api';

const SHOT = '/rep-lab/detail-full.png';
const SHOT_W = 1810;

// The real Signature Realty ladder, in the product's own order and casing.
const STAGES = [
  'Lead', 'Attempted contact', 'Spoke with customer', 'Appointment set',
  'Met with customer', 'Showing homes', 'Listing agreement', 'Active listing',
  'Submitting offers', 'Under contract', 'Nurture', 'Closed', 'Trash',
];

type Pack = {
  subline: string;
  title: string;
  situation: string;
  /** Plain, numbered, no jargon — and never naming the stage they should pick. */
  steps: string[];
  startStage: string;
};

export const PACKS: Record<string, Pack> = {
  'avery-new': {
    subline: 'No communication yet',
    title: 'A new lead just landed',
    situation: 'It is 9:10 AM. Avery Morgan just came in from Zillow and nobody has contacted them yet.',
    steps: [
      'Set the stage so it matches what has actually happened so far, and save it.',
      'Create a task so this lead comes back to you, with a date on it.',
    ],
    startStage: 'Lead',
  },
  'avery-spoke': {
    subline: 'Last Communication 4 minutes ago',
    title: 'You just got off the phone',
    situation: 'You reached Avery. They are buying with their sister, want Olympia or Lacey, at least 3 bedrooms, before November, and asked you to send a couple of options. Nothing was booked.',
    steps: [
      'Set the stage to match what happened on that call, and save it.',
      'Leave a note for whoever opens this record next.',
      'Create a task for what you promised, with a date on it.',
    ],
    startStage: 'Lead',
  },
  'avery-appointment': {
    subline: 'Last Communication 6 minutes ago',
    title: 'You booked the appointment',
    situation: 'Avery confirmed Saturday at 11:00 AM to walk 406 and 422 Juniper Ln. Two adults are coming, and they asked for access details beforehand.',
    steps: [
      'Set the stage to match a confirmed date and time, and save it.',
      'Leave a note.',
      'Create a task for what you owe them before Saturday, with a date on it.',
    ],
    startStage: 'Spoke with customer',
  },
  'avery-contract': {
    subline: 'Last Communication yesterday',
    title: 'The offer was accepted',
    situation: 'Avery’s offer on 456 Oak St was accepted last night at $265,000, closing September 30th.',
    steps: [
      'Set the stage to match an accepted offer, and save it.',
      'Leave a note.',
      'Create a task with a date on it.',
      'Add the deal — Follow Up Boss will not prompt you for it. Give it a price and a close date.',
    ],
    startStage: 'Submitting offers',
  },
};

export type PracticeScenario = keyof typeof PACKS;

type Entry = { when: string; text: string; kind: 'stage' | 'note' | 'task' | 'deal' };

const stamp = () =>
  new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/** "2026-08-18" -> "Aug 18th 2026", the way the Tasks panel writes it. */
function longDate(d: string): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, day || 1);
  const n = dt.getDate();
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd'
    : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${dt.toLocaleDateString('en-US', { month: 'short' })} ${n}${suffix} ${dt.getFullYear()}`;
}

export function PracticeRecord({
  scenario, onPassed, record = true,
}: {
  scenario: PracticeScenario;
  onPassed?: () => void;
  record?: boolean;
}) {
  const pack = PACKS[scenario];
  const shotRef = useRef<HTMLDivElement | null>(null);
  const [k, setK] = useState(0);

  const [stage, setStage] = useState(pack.startStage);
  const [savedStage, setSavedStage] = useState(pack.startStage);
  const [editing, setEditing] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [stageQuery, setStageQuery] = useState('');
  const [everSaved, setEverSaved] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [note, setNote] = useState('');
  const [taskModal, setTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [tasks, setTasks] = useState<Array<{ title: string; date: string; time: string }>>([]);
  const [dealModal, setDealModal] = useState(false);
  const [dealName, setDealName] = useState('');
  const [dealPrice, setDealPrice] = useState('');
  const [dealClose, setDealClose] = useState('');
  const [deals, setDeals] = useState<Array<{ name: string; price: string; close: string }>>([]);
  const [log, setLog] = useState<Entry[]>([]);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [grade, setGrade] = useState<RecordGrade | null>(null);

  // One measured factor. Every size in the overlay is px * var(--k).
  const measure = useCallback(() => {
    const el = shotRef.current;
    if (el) setK(el.clientWidth / SHOT_W);
  }, []);
  useEffect(() => {
    measure();
    const el = shotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const dirty = stage !== savedStage;
  const shownStages = STAGES.filter((s) => s.toLowerCase().includes(stageQuery.toLowerCase()));

  const commitStage = () => {
    setEditing(false); setStageOpen(false); setStageQuery('');
    if (stage === savedStage) return;
    setSavedStage(stage);
    setEverSaved(true);
    setLog((l) => [{ when: stamp(), text: `Stage changed to ${stage}`, kind: 'stage' }, ...l]);
  };
  const cancelStage = () => {
    setStage(savedStage); setEditing(false); setStageOpen(false); setStageQuery('');
  };

  const addNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    setNote(text); setNoteDraft('');
    setLog((l) => [{ when: stamp(), text, kind: 'note' }, ...l]);
  };

  const addTask = () => {
    const t = taskTitle.trim();
    if (!t) return;
    setTasks((x) => [...x, { title: t, date: taskDate, time: taskTime }]);
    setLog((l) => [{ when: stamp(), text: `Task created — ${t}`, kind: 'task' }, ...l]);
    setTaskTitle(''); setTaskDate(''); setTaskTime(''); setTaskModal(false);
  };

  const addDeal = () => {
    const n = dealName.trim();
    if (!n) return;
    setDeals((d) => [...d, { name: n, price: dealPrice, close: dealClose }]);
    setLog((l) => [{ when: stamp(), text: `Deal created — ${n}`, kind: 'deal' }, ...l]);
    setDealName(''); setDealPrice(''); setDealClose(''); setDealModal(false);
  };

  const check = async () => {
    if (isDemo) { setErr('This grades on the server. Sign in to submit.'); return; }
    setBusy(true); setErr('');
    try {
      const g = await gradeRecordPractice(scenario, {
        stage: savedStage,
        stageSaved: everSaved && !dirty,
        note,
        task: tasks.length ? { title: tasks[0].title, dueDate: tasks[0].date, dueTime: tasks[0].time } : undefined,
        deal: deals.length ? { name: deals[0].name, price: deals[0].price, closeDate: deals[0].close } : undefined,
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
        <p className="pr-situation">{pack.situation}</p>
        <div className="pr-jobs">
          <h4>Your job</h4>
          <ol>{pack.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
        <p className="pr-safe">
          This is the record as it opens in Follow Up Boss — find what you need on it. Nothing here
          touches a real contact.{' '}
          <button className="pr-hintbtn" onClick={() => setHint((h) => !h)}>
            {hint ? 'Hide the hints' : 'Stuck? Show me where'}
          </button>
        </p>
      </div>

      <div
        className={`fub${hint ? ' show-hints' : ''}`}
        ref={shotRef}
        style={{ ['--k' as string]: String(k) }}
      >
        <img className="fub-shot" src={SHOT} alt="A Follow Up Boss contact record for Avery Morgan" />

        {k > 0 && (
          <>
            {/* the header line, so the record reflects this situation */}
            <div className="fub-hot fub-sub">{pack.subline}</div>

            {/* Stage — in the Details panel, edited the way FUB edits it */}
            {!editing ? (
              <button className="fub-hot fub-stageread hintable" onClick={() => { setEditing(true); setStageOpen(true); }}>
                {savedStage}
              </button>
            ) : (
              <div className="fub-hot fub-stageedit">
                <button className="fub-stagefield" onClick={() => setStageOpen((o) => !o)}>
                  <b>Stage</b><span className="fub-stagepick">{stage}</span><span className="fub-caret">⌄</span>
                </button>
                <button className="fub-ok" onClick={commitStage} title="Save">✓</button>
                <button className="fub-cancel" onClick={cancelStage} title="Cancel">✕</button>
                {stageOpen && (
                  <div className="fub-menu">
                    <input
                      className="fub-menusearch" autoFocus placeholder="Search"
                      value={stageQuery} onChange={(e) => setStageQuery(e.target.value)}
                    />
                    <ul>
                      <li className="fub-menuhead">Select an Option</li>
                      {shownStages.map((s) => (
                        <li key={s}>
                          <button className={s === stage ? 'on' : ''} onClick={() => { setStage(s); setStageOpen(false); }}>
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* the note composer */}
            <textarea
              className="fub-hot fub-note hintable"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add notes or type @name to notify"
            />
            <button className="fub-hot fub-notebtn" onClick={addNote} disabled={!noteDraft.trim()}>
              Create Note
            </button>

            {/* Tasks panel */}
            <button className="fub-hot fub-taskadd hintable" onClick={() => setTaskModal(true)} title="Add a task">+</button>
            <div className="fub-hot fub-tasklist">
              {tasks.length === 0 ? <span className="fub-empty">No upcoming tasks</span> : tasks.map((t, i) => (
                <div key={i} className="fub-taskitem">
                  <span className="fub-taskbox" />
                  <div>
                    <div className="fub-taskname">{t.title}</div>
                    <div className="fub-taskmeta">{longDate(t.date) || 'no date'}{t.time ? ` at ${t.time}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Deals panel */}
            <button className="fub-hot fub-dealadd hintable" onClick={() => setDealModal(true)} title="Add a deal">+</button>
            <div className="fub-hot fub-deallist">
              {deals.length === 0 ? <span className="fub-empty">No deals yet</span> : deals.map((d, i) => (
                <div key={i} className="fub-dealitem">
                  <span className="fub-dealname">{d.name}</span>
                  <span className="fub-dealmeta">
                    {d.price ? `$${d.price}` : 'no price'}{d.close ? ` · closes ${d.close}` : ''}
                  </span>
                </div>
              ))}
            </div>

            {/* what you did, on the record's own timeline */}
            {log.length > 0 && (
              <div className="fub-hot fub-log">
                {log.map((e, i) => (
                  <div key={i} className={`fub-item is-${e.kind}`}>
                    <span className="fub-pin" />
                    <div className="fub-itembody">
                      <div className="fub-itemhead">
                        <span className="fub-itemav">AT</span>
                        <span className="fub-itemwho">Adam Terrason</span>
                        <span className="fub-itemwhen">{e.when}</span>
                      </div>
                      <div className="fub-itemtext">{e.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create task — a modal, the way FUB does it */}
            {taskModal && (
              <div className="fub-modalwrap" onClick={() => setTaskModal(false)}>
                <div className="fub-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="fub-modalhead">
                    <span>Create task</span>
                    <button onClick={() => setTaskModal(false)}>✕</button>
                  </div>
                  <input className="fub-full" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task Name" />
                  <div className="fub-two">
                    <select defaultValue="Follow Up"><option>Follow Up</option><option>Call</option><option>Email</option></select>
                    <select defaultValue="Adam Terrason"><option>Adam Terrason</option></select>
                  </div>
                  <div className="fub-two">
                    <input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} />
                    <input type="time" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} />
                  </div>
                  <div className="fub-modalfoot">
                    <button className="fub-link" onClick={() => setTaskModal(false)}>Cancel</button>
                    <button className="fub-blue" onClick={addTask} disabled={!taskTitle.trim()}>Create task</button>
                  </div>
                </div>
              </div>
            )}

            {/* Create deal */}
            {dealModal && (
              <div className="fub-modalwrap" onClick={() => setDealModal(false)}>
                <div className="fub-modal wide" onClick={(e) => e.stopPropagation()}>
                  <div className="fub-modalhead">
                    <span>Create deal</span>
                    <button onClick={() => setDealModal(false)}>✕</button>
                  </div>
                  <input className="fub-full" value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="Add name" />
                  <div className="fub-crumb">Buyers › Start (temp stage)</div>
                  <div className="fub-two">
                    <label>Price<input value={dealPrice} onChange={(e) => setDealPrice(e.target.value)} placeholder="Add price" /></label>
                    <label>Close date<input type="date" value={dealClose} onChange={(e) => setDealClose(e.target.value)} /></label>
                  </div>
                  <div className="fub-modalfoot">
                    <button className="fub-link" onClick={() => setDealModal(false)}>Cancel</button>
                    <button className="fub-blue" onClick={addDeal} disabled={!dealName.trim()}>Create Deal</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="pr-after">
        {grade && (
          <ul className="pr-checks">
            {grade.checks.map((c) => (
              <li key={c.id} className={c.pass ? 'ok' : 'no'}>
                <b>{c.pass ? '✓' : '✕'} {c.label}</b>
                {c.pass ? '' : ` — ${c.message}`}
              </li>
            ))}
          </ul>
        )}
        {grade?.passed && <p className="lab-ok">Done — that is a record someone else could pick up.</p>}
        {err && <div className="err">{err}</div>}
        <button className="btn ac-btn" onClick={() => void check()} disabled={busy}>
          {busy ? 'Checking…' : grade?.passed ? 'Check again' : 'Check my record'}
        </button>
      </div>
    </div>
  );
}
