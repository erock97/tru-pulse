// TRU Rep — "Welcome to Zillow Preferred: Official Training" (Day 1) as ONE module.
// Usage: node rep_zillow_day1.mjs <path-to-secrets.json>
//
// WHAT THIS FILE IS. The module is Eric's own 18-slide Day 1 deck, rendered natively
// by the app, with the record exercises dropped in between the slides that teach them.
// The slide HTML does NOT live here — it lives in web/public/decks/zillow-day1.json,
// built by db/build-deck.py from the deck bundle. A `slide` card is only a pointer:
// { t:'slide', deck:'zillow-day1', slide:<n> }. That is why this file is short now.
//
// THE SEQUENCE IS THE LESSON. Each exercise follows the slide that teaches it and
// adds exactly one new thing. Do not reorder these without redoing that reasoning:
//
//   after the stage slides   -> set-appointment : change the stage, save it. That is all.
//   after the Notes slide    -> spoke-note      : stage + note, wording handed over,
//                               because WHERE the note goes is the skill here
//   after the Tasks slide    -> noanswer-task   : stage + note + task
//   after the Repair slide   -> avery-repair    : diagnose the record, THEN all three
//   after the deals text     -> offer-accepted  : all three plus the deal
//
// The first three climb on volume — one move, two, three — and each of them states
// the outcome plainly, because the skill there is working the controls. The last
// two climb on judgement instead: nothing names the stage, and in both the obvious
// answer is wrong. Once someone can drive the screen, longer is not harder.
//
// CUT, and worth knowing why so it does not come back:
//   - a "What you have just learned" text card between the four-checks slide and
//     the last two exercises. It restated the slide immediately before it, and in
//     a module made of slides it read as a leftover from the old text-only version.
//   - a "now do all three on your own" exercise. It was the THIRD consecutive lap
//     of stage-note-task with only the story changed. The repair before it and the
//     deal after it both already do all three, and both add something.
//
// Deals get a `text` card because the deck has no slide for them, and nothing is
// asked for before it has been taught.
//
// The scenario ids above are defined in web/src/pages/PracticeRecord.tsx and graded
// in worker/src/repLab/records.ts. avery-repair is graded in two halves: its
// diagnosis step by worker/src/repLab/avery.ts, its repair by records.ts like the rest.
//
// Production controls carried over from the facilitator script and honoured here:
//   - no target numbers for any performance category (the applicable standard is
//     not confirmed, so publishing one would be inventing it);
//   - an unanswered attempt is Attempted Contact — trying is not talking;
//   - a stage is not saved until the green check is clicked and it survives a reopen;
//   - a self-reported timeframe is recorded as the buyer's words, never as a fact;
//   - Day 1 stops at an accurate, usable record. Wording is Day 2, showing Day 3,
//     financing Day 4.
import { readFileSync } from 'node:fs';

const secrets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const BASE = secrets.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const H = {
  apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + secrets.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

export const MODULE_ID = 'a6666666-6666-6666-6666-666666666666';
const T_ZILL = 'b2222222-2222-2222-2222-222222222222';

const slide = (n, title) => ({ t: 'slide', deck: 'zillow-day1', slide: n, title });

export const CARDS = [
  // ── The lead arrives, and where it lands ──
  slide(1, 'Title'),
  slide(2, 'Two things'),
  slide(3, 'Four days'),
  slide(4, 'How a lead reaches you'),
  slide(5, 'People'),
  slide(6, 'Demo find the lead'),

  // ── Reading a record before you touch it ──
  slide(7, 'Four questions'),
  slide(8, 'Details panel'),
  slide(9, 'Context not story'),

  // ── The stage, then the first exercise: nothing but the stage ──
  slide(10, 'Stage truth'),
  slide(11, 'Your turn stages'),
  slide(12, 'The answers'),
  { t: 'practice', scenario: 'set-appointment' },

  // ── The note. The wording is handed over; placing it is the skill. ──
  slide(13, 'Notes'),
  { t: 'practice', scenario: 'spoke-note' },

  // ── The task. Now all three moves together. ──
  slide(14, 'Tasks'),
  { t: 'practice', scenario: 'noanswer-task' },

  // ── Avery's record is wrong on purpose. The slide sets it up; the exercise IS
  //    the slide's exercise, so it prints no title or body of its own. ──
  slide(15, 'Repair Avery'),
  { t: 'practice', scenario: 'avery-repair' },

  // ── The four checks, straight from the deck ──
  slide(16, 'Four checks'),

  // ── Deals: taught here because the deck has no slide for them ──
  {
    t: 'text',
    k: 'One more thing: deals',
    body: 'When an offer is accepted, moving the stage to Under contract is only half of it. Follow Up Boss does NOT prompt you to create the deal — it will sit there under contract with no deal attached, and it will not appear in anyone’s pipeline or commission numbers.\n\nThe deal lives in its own panel on the right of the record. It needs a name, a price and a close date.',
  },
  { t: 'practice', scenario: 'offer-accepted' },

  // ── Close ──
  slide(17, 'Way back tomorrow'),
  slide(18, 'Close'),
];

// Quiz — every answer is recoverable from the slides and exercises above, and none of
// it invents a target number or a stage label the script left unresolved.
export const QUESTIONS = [
  { idx: 1, prompt: 'A new Zillow connection arrives. What do you do first?', choices: ['Call immediately', 'Open the record and read what is already known', 'Send a text', 'Wait for the buyer to follow up'], answer: 1, explain: 'Read the facts the buyer and the system already gave you, then choose a channel that fits them.' },
  { idx: 2, prompt: 'Your team handles a no-answer differently from what the deck shows. You should:', choices: ['Guess and keep moving', 'Ask your team lead', 'Invent a stage that fits', 'Leave the record untouched'], answer: 1, explain: 'Do not guess at a team rule and do not invent one. Asking once is faster than cleaning up a list nobody trusts.' },
  { idx: 3, prompt: "You picked the right stage on Avery's record. What is the step everyone misses?", choices: ['Telling your team lead', 'Clicking the green check to save it, then reopening to confirm it stuck', 'Adding a second note', 'Moving them to a smart list'], answer: 1, explain: 'Choosing a stage does not save it. Click the green check, then reopen the record and confirm it actually stuck.' },
  { idx: 4, prompt: 'The record shows the buyer viewed a home four times. You may safely write:', choices: ['"She loves this home."', '"FUB shows repeat views of this home."', '"She is ready to make an offer."', '"This is her favourite property."'], answer: 1, explain: 'Home Activity is a signal, not certainty. It helps you ask a better question; it proves nothing about intent.' },
  { idx: 5, prompt: 'You talked with the buyer about what they need, but no time is set. The stage is:', choices: ['Lead', 'Attempted Contact', 'Spoke with Customer', 'Appointment Set'], answer: 2, explain: 'You learned something real, and there is still no appointment. Appointment Set needs a confirmed date and time — not "sometime this weekend."' },
  { idx: 6, prompt: 'You called and left a voicemail. No call back yet. The stage is:', choices: ['Lead', 'Attempted Contact', 'Spoke with Customer', 'Appointment Set'], answer: 1, explain: 'You tried. Trying is not talking. The stage only moves when something real actually happened.' },
  { idx: 7, prompt: 'A useful note answers which three things?', choices: ['Who, where, and how much', 'What happened, what the buyer needs, what is next and when', 'The buyer’s job, budget, and timeline', 'Your opinion, your plan, and your schedule'], answer: 1, explain: 'FUB does not enforce it — it is our habit, and it is what lets a teammate take over.' },
  { idx: 8, prompt: 'The buyer told you their timeframe. How should that go in the record?', choices: ['As a confirmed fact', 'As their own words, not a verified fact', 'As a reason to change the stage', 'Leave it out'], answer: 1, explain: 'Timeframe is self-reported. It is a reason to ask a better question, never an answer to one — and never quote it back as if it were verified.' },
  { idx: 9, prompt: 'A task differs from a note because it:', choices: ['Repeats the note for safety', 'Is one specific future action with an owner, date, and time', 'Is only for appointments', 'Is optional once the note is good'], answer: 1, explain: 'The note records the past; the task schedules the future. A promise with no date is not a next step.' },
  { idx: 10, prompt: 'Day 1 is finished when:', choices: ['You have called every lead', 'The screen looks familiar', 'Another agent could open your record and know what happened and what comes next', 'The Smart List is empty'], answer: 2, explain: 'Accurate, saved, understandable, scheduled. Smart List membership is never the finish line.' },
];

const MODULE = {
  id: MODULE_ID,
  org_id: null,
  idx: 6,
  title: 'Welcome to Zillow Preferred — Official Training',
  summary: 'Day 1: the record is the product. Eighteen slides, and five record exercises you work by hand rather than answer.',
  body: 'The official Day 1 program, self-paced — including the record exercises you are graded on.',
  cards: CARDS,
  pass_pct: 80,
  active: true,
  status: 'published',
  source: 'system',
  kind: 'lesson',
  duration_min: 60,
  level: 'core',
  tags: ['zillow', 'day-1', 'fub', 'stages', 'notes', 'official'],
  // core=false on purpose: switching this on changes the certification
  // denominator for every agent already at 100%. That is Eric's call, not a
  // side effect of publishing the content.
  core: false,
};

async function must(res, what) {
  if (!res.ok) throw new Error(`${what} ${res.status}: ${await res.text()}`);
}

const modRes = await fetch(`${BASE}/rep_modules?on_conflict=id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([MODULE]),
});
await must(modRes, 'module');

await fetch(`${BASE}/rep_questions?module_id=eq.${MODULE_ID}`, { method: 'DELETE', headers: H });
const qRes = await fetch(`${BASE}/rep_questions`, {
  method: 'POST',
  headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify(QUESTIONS.map((q) => ({ ...q, module_id: MODULE_ID }))),
});
await must(qRes, 'questions');

// First on the Zillow Preferred track.
const linkRes = await fetch(`${BASE}/rep_track_modules?on_conflict=track_id,module_id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{ track_id: T_ZILL, module_id: MODULE_ID, idx: 1, required: true }]),
});
await must(linkRes, 'track link');

console.log(`module: 1, cards: ${CARDS.length}, questions: ${QUESTIONS.length}`);
