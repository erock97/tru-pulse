// TRU Rep — "Show Like a Pro" (Day 3) as ONE module.
// Usage: node rep_zillow_day3.mjs <path-to-secrets.json>
//
// WHAT THIS FILE IS. The module is Eric's own 31-slide Day 3 deck, rendered
// natively by the app. The slide HTML does NOT live here — it lives in
// web/public/decks/zillow-day3.json. A `slide` card is only a pointer:
// { t:'slide', deck:'zillow-day3', slide:<n> }.
//
// This is NEW content. It is not a rename of Official Training (a6666) and it
// is not "Zillow Preferred Day 3 — The Showing." Drills on slides 25–27 stay
// slides. There are no Day 1 record / FUB sim / practice / dealslide cards.
//
// Track link is idx=3 on the Zillow Preferred track. idx 2 is left empty for Day 2.
//
// Do not run this against the live project as a side effect of a code PR.
// Propose it; Eric decides when it lands in Supabase.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const MODULE_ID = 'a7777777-7777-7777-7777-777777777777';
export const TRACK_ID = 'b2222222-2222-2222-2222-222222222222';
export const TITLE = 'Show Like a Pro';

const slide = (n, title) => ({ t: 'slide', deck: 'zillow-day3', slide: n, title });

export const TITLES = [
  'The showing.',
  'Before anything else — a question for the room.',
  'Before you go.',
  'The touring agreement goes out before you go.',
  'Show two or three. Never one.',
  'Inside the house.',
  'You opened the door. Now get out of the way.',
  'Available, not attached.',
  'The trap is your own taste.',
  'Say the real thing. Skip the rest.',
  'The sidewalk.',
  'One more before we go outside.',
  'Here is what most agents say.',
  'Instead: five questions, in order.',
  "One — did you see one you'd write on?",
  'Two — rate it, one to ten.',
  'Three — what would make it an eight?',
  'Four — cash under the bed, or a lender?',
  'Five — is that date a guess, or a deadline?',
  'Look at what you have, and what you never asked.',
  'Now the answer changes what you do.',
  'Work the date backwards, out loud, with them.',
  'Leave with an appointment. Not an intention.',
  'Now you say it.',
  'Drill one — the open, and the rating.',
  'Drill two — the timeline, and the permission line.',
  'Now the whole thing, start to finish.',
  'Back together — what happened out there?',
  'Before you drive away — three things.',
  'Before Day 4 — one written exercise.',
  'The houses were the easy part.',
];

export const CARDS = TITLES.map((title, i) => slide(i + 1, title));

// Quiz — every answer is recoverable from the 31 slides above. No Day 1 FUB questions.
export const QUESTIONS = [
  {
    idx: 1,
    prompt: 'Why show two or three homes, never one?',
    choices: [
      'Zillow requires three showings per lead',
      'The rating question is worthless with only one house',
      'Buyers get tired after a single house',
      'One house is easier to schedule',
    ],
    answer: 1,
    explain: 'Slide 5: in an hour you ask them to rate a house out of ten. That question does almost nothing if there is only one house to rate.',
  },
  {
    idx: 2,
    prompt: 'Available, not attached means you:',
    choices: [
      'Follow them room to room so you can answer instantly',
      'Stay on the sidewalk until they call you',
      'Let them walk in first and hold the kitchen or the entry',
      'Narrate every room so they do not feel ignored',
    ],
    answer: 2,
    explain: 'Slide 8: let them walk in first, stay near the kitchen or the entry, do not follow them upstairs.',
  },
  {
    idx: 3,
    prompt: 'Say the real thing. Skip the rest. What is worth saying out loud?',
    choices: [
      'A chip in the wall and paint you would not have chosen',
      'Anything that changes the price or safety',
      'The ceiling fans and a kitchen layout you dislike',
      'Whatever the photos already showed',
    ],
    answer: 1,
    explain: 'Slide 10: structural problems, water where it should not be, price, safety — skip the rest.',
  },
  {
    idx: 4,
    prompt: 'What is the first sidewalk question?',
    choices: [
      'How did you like them?',
      "Did you see one you'd write on?",
      'What is your budget?',
      'Are you pre-approved?',
    ],
    answer: 1,
    explain: 'Slide 15: did you see any homes you want to write an offer on? You are expecting a no.',
  },
  {
    idx: 5,
    prompt: 'Why ask them to rate the homes one to ten?',
    choices: [
      'A number is vague and keeps things light',
      'A number aims question three at a specific house',
      'You skip the rest of the closeout if they say seven',
      'It replaces the need for an appointment',
    ],
    answer: 1,
    explain: 'Slide 16: a ranking, and a specific house to aim the next question at. "How did you like them?" gets you "they were fine."',
  },
  {
    idx: 6,
    prompt: 'How do you ask what would make it an eight?',
    choices: [
      'Ask their wish list directly',
      'As a hypothetical — take a trip with me',
      'Tell them what to change',
      'Skip to financing',
    ],
    answer: 1,
    explain: 'Slide 17: "Take a trip with me. Let\'s pretend this home was an eight." Nobody defends a hypothetical.',
  },
  {
    idx: 7,
    prompt: 'Cash under the bed, or a lender — what are you actually finding out?',
    choices: [
      'What they earn',
      'How they pay',
      'Whether they are serious',
      'Their credit score',
    ],
    answer: 1,
    explain: 'Slide 18: still hypothetical. You did not ask what they earn or whether they are serious. They told you how they pay anyway.',
  },
  {
    idx: 8,
    prompt: 'Before you ask whether the date is a guess or a deadline, you:',
    choices: [
      'Take the number at face value',
      'Use the permission line first',
      'Push a lender immediately',
      'Skip the question if they said six months',
    ],
    answer: 1,
    explain: 'Slide 19: "I don\'t want you to feel like I\'m interrogating you…" — the permission line first, then probe the number.',
  },
  {
    idx: 9,
    prompt: 'Leave with an appointment. What makes it an appointment, not an intention?',
    choices: [
      '"I\'ll follow up"',
      'A date, a time, and a purpose',
      'An MLS search',
      '"Let me know if you see anything"',
    ],
    answer: 1,
    explain: 'Slide 23: does it have a date, a time, and does the buyer know what it is for? If any one is missing, you have a feeling.',
  },
  {
    idx: 10,
    prompt: 'Before you drive away, which three things do you do in the car?',
    choices: [
      'Call your team lead, send a recap, wait until tonight',
      'Move the stage, write the note, set the task',
      'Post the showing, email comparables, close the lead',
      'Rate the houses yourself, then follow up tomorrow',
    ],
    answer: 1,
    explain: 'Slide 29: stage to Showing Homes, note what they liked and the real timeline, task the appointment you just agreed to.',
  },
];

export const MODULE = {
  id: MODULE_ID,
  org_id: null,
  idx: 8,
  title: TITLE,
  summary: 'The showing, touring agreement before you go, two or three homes never one, sidewalk five questions, leave with an appointment.',
  body: 'Day 3 of Zillow Preferred onboarding — Show Like a Pro. Thirty-one slides. No record lab.',
  cards: CARDS,
  pass_pct: 80,
  active: true,
  status: 'published',
  source: 'system',
  kind: 'lesson',
  duration_min: 90,
  level: 'core',
  tags: ['zillow', 'day-3', 'showing', 'official'],
  // core=false on purpose: switching this on changes the certification
  // denominator for every agent already at 100%. That is Eric's call, not a
  // side effect of publishing the content.
  core: false,
};

export const TRACK_LINK = {
  track_id: TRACK_ID,
  module_id: MODULE_ID,
  idx: 3,
  required: true,
};

async function must(res, what) {
  if (!res.ok) throw new Error(`${what} ${res.status}: ${await res.text()}`);
}

async function seed() {
  if (!process.argv[2]) throw new Error('Usage: node rep_zillow_day3.mjs <path-to-secrets.json>');
  const secrets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const BASE = secrets.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const H = {
    apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + secrets.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

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

  const linkRes = await fetch(`${BASE}/rep_track_modules?on_conflict=track_id,module_id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([TRACK_LINK]),
  });
  await must(linkRes, 'track link');

  console.log(`module: 1, cards: ${CARDS.length}, questions: ${QUESTIONS.length}`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  await seed();
}
