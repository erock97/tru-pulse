// A practice contact record built ON the real Follow Up Boss screen.
//
// Two rules from Eric, and they drive everything here:
//
// 1. No fabricated UI. The background is the actual FUB screenshot from the
//    training account, and every control sits exactly where FUB puts it.
// 2. NEVER crop to the control being practised. If the task is "leave a note",
//    the learner sees the WHOLE record and has to find the note composer. What a
//    new agent actually struggles with is "I opened a contact — now where do I
//    go?" Handing them a cropped note box teaches none of that.
//
// So nothing is highlighted by default. "Show me where" is opt-in, for someone
// genuinely stuck.
//
// Traced from the live product on 2026-08-15: the stage row becomes a bordered
// field with a chevron plus a green check and a red X; the stage list is
// searchable and sentence-case; Create task is a MODAL, not an inline panel; a
// posted note carries author, time and a pinned marker on the timeline; and
// going Under contract does NOT prompt you for a deal — you have to add it.
import { useState } from 'react';
import { gradeRecordPractice, isDemo, type RecordGrade } from '../lib/api';

const SHOT = '/rep-lab/detail-full.png';

// The real Signature Realty ladder, in the product's own order and casing.
const STAGES = [
  'Lead', 'Attempted contact', 'Spoke with customer', 'Appointment set',
  'Met with customer', 'Showing homes', 'Listing agreement', 'Active listing',
  'Submitting offers', 'Under contract', 'Nurture', 'Closed', 'Trash',
];

type Pack = {
  who: string;
  initials: string;
  subline: string;
  title: string;
  brief: string;
  situation: string;
  startStage: string;
};

export const PACKS: Record<string, Pack> = {
  'avery-new': {
    who: 'Avery Morgan', initials: 'AM', subline: 'No communication yet',
    title: 'A new lead just landed',
    brief: 'Avery just arrived from Zillow and nobody has spoken to them yet.',
    situation: 'It is 9:10 AM. You have not contacted Avery. Leave the record honest, and leave yourself a way back to it.',
    startStage: 'Lead',
  },
  'avery-spoke': {
    who: 'Avery Morgan', initials: 'AM', subline: 'Last Communication 4 minutes ago',
    title: 'You just got off the phone',
    brief: 'You reached Avery and learned what they are looking for. Nothing is booked.',
    situation: 'Avery is buying with their sister, wants Olympia or Lacey, at least 3 bedrooms, before November. They asked you to send a couple of options. No appointment was discussed.',
    startStage: 'Lead',
  },
  'avery-appointment': {
    who: 'Avery Morgan', initials: 'AM', subline: 'Last Communication 6 minutes ago',
    title: 'You booked the appointment',
    brief: 'Avery confirmed a time. Make the record say so, and leave what you owe them before you meet.',
    situation: 'Avery confirmed Saturday at 11:00 AM to walk 406 and 422 Juniper Ln. Two adults are coming, and they asked for access details beforehand.',
    startStage: 'Spoke with customer',
  },
  'avery-contract': {
    who: 'Avery Morgan', initials: 'AM', subline: 'Last Communication yesterday',
    title: 'The offer was accepted',
    brief: 'Avery is under contract. Moving the stage is only half the job.',
    situation: 'Avery’s offer on 456 Oak St was accepted last night at $265,000, closing September 30th. Follow Up Boss will not prompt you for anything else — the deal is yours to add.',
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
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
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
        <p>{pack.brief}</p>
        <div className="pr-situation"><b>What just happened:</b> {pack.situation}</div>
        <p className="pr-safe">
          This is the record exactly as it opens in Follow Up Boss — find what you need on it.
          Nothing here touches a real contact, so nothing you click can break anything.{' '}
          <button className="pr-hintbtn" onClick={() => setHint((h) => !h)}>
            {hint ? 'Hide the hints' : 'Stuck? Show me where'}
          </button>
        </p>
      </div>

      <div className={`fub${hint ? ' show-hints' : ''}`}>
        <img className="fub-shot" src={SHOT} alt={`A Follow Up Boss contact record for ${pack.who}`} />

        {/* the person — patched over the baked-in name so each scenario is someone else */}
        <div className="fub-hot fub-avatar">{pack.initials}</div>
        <div className="fub-hot fub-who">
          <span className="fub-name">{pack.who}</span>
          <span className="fub-sub">{pack.subline}</span>
        </div>

        {/* Stage, in the Details panel */}
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
        <button className="fub-hot fub-notebtn" onClick={addNote} disabled={!noteDraft.trim()}>Create Note</button>

        {/* Tasks panel */}
        <button className="fub-hot fub-taskadd hintable" onClick={() => setTaskModal(true)} title="Add a task">+</button>
        <div className="fub-hot fub-tasklist">
          {tasks.length === 0 ? <span className="fub-empty">No upcoming tasks</span> : tasks.map((t, i) => (
            <div key={i} className="fub-taskitem">
              <span className="fub-taskbox" />
              <div>
                <div className="fub-taskname">{t.title}</div>
                <div className="fub-taskmeta">{longDate(t.date) || 'no date'}{t.time ? ` at ${t.time}` : ''}</div>
                <div className="fub-taskmeta">Adam Terrason</div>
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
              <div className="fub-two narrow">
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

        {/* Create deal — same green/red confirm pattern on the name */}
        {dealModal && (
          <div className="fub-modalwrap" onClick={() => setDealModal(false)}>
            <div className="fub-modal wide" onClick={(e) => e.stopPropagation()}>
              <div className="fub-dealnamerow">
                <input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="Add name" />
                <span className="fub-ok" aria-hidden>✓</span>
                <button className="fub-cancel" onClick={() => setDealName('')} title="Clear the name">✕</button>
              </div>
              <div className="fub-crumb">Buyers › Start (temp stage)</div>
              <div className="fub-dealgrid">
                <label>Price<input value={dealPrice} onChange={(e) => setDealPrice(e.target.value)} placeholder="Add price" /></label>
                <label>Close date<input type="date" value={dealClose} onChange={(e) => setDealClose(e.target.value)} /></label>
                <span>Earnest money due<i>Add earnest money due date</i></span>
                <span>Mutual acceptance<i>Add mutual acceptance date</i></span>
                <span>Due diligence<i>Add due diligence date</i></span>
                <span>Final walk through<i>Add final walk through date</i></span>
                <span>Commission<i>Add commission</i></span>
                <span>Splits<i>Add agent split</i></span>
              </div>
              <div className="fub-modalfoot">
                <button className="fub-link" onClick={() => setDealModal(false)}>Cancel</button>
                <button className="fub-blue" onClick={addDeal} disabled={!dealName.trim()}>Create Deal</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pr-after">
        {grade && (
          <ul className="pr-checks">
            {grade.checks.map((c) => (
              <li key={c.id} className={c.pass ? 'ok' : 'no'}><b>{c.label}</b> — {c.message}</li>
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
