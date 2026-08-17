// TRU Rep — "Winning the First Conversation" (Day 2) as ONE module.
// Usage: node rep_zillow_day2.mjs <path-to-secrets.json>
//
// WHAT THIS FILE IS. The module is Eric's own 31-slide Day 2 deck, rendered
// natively by the app. The slide HTML does NOT live here — it lives in
// web/public/decks/zillow-day2.json. A `slide` card is only a pointer:
// { t:'slide', deck:'zillow-day2', slide:<n> }.
//
// This is NEW content. It is not a rename of Official Training (a6666) and it
// is not ALMS or any hidden July module. Drills on slides 22–25 stay slides.
// There are no Day 1 record / FUB sim / practice / dealslide cards.
//
// Track link is idx=2 on the Zillow Preferred track. Day 3 stays idx=3.
// Official Training stays idx=1.
//
// Do not run this against the live project as a side effect of a code PR.
// The live insert is already done. This file is the in-repo record.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const MODULE_ID = 'a8888888-8888-8888-8888-888888888888';
export const TRACK_ID = 'b2222222-2222-2222-2222-222222222222';
export const TITLE = 'Winning the First Conversation';

const slide = (n, title) => ({ t: 'slide', deck: 'zillow-day2', slide: n, title });

export const TITLES = [
  'The first conversation.',
  'Before anything else — a question for the room.',
  'They are asking one question.',
  'Quick round — the worst sales call you have ever gotten.',
  'The fastest way to lose an online lead.',
  'Advocate, not gatekeeper.',
  'Before you dial — ten minutes.',
  'The whole call is about five minutes.',
  'Before we go on — when do you ask for the appointment?',
  'Four beats. That is the whole call.',
  'Lead with who you are.',
  'Extend the invitation.',
  'Ask and listen.',
  'Quick one — would you stay in that store?',
  'What you do not ask on a first call.',
  'Deliver the summary.',
  'What they actually say.',
  'Six moves. The fourth one is the whole thing.',
  'Then bring them back at the end.',
  'When the home is already under contract.',
  'Now you talk.',
  'Drill 1 — the introduction.',
  'Drill 2 — the appointment ask.',
  'Drill 3 — parking the questions.',
  'Now the whole call, start to finish.',
  'Back together — what happened?',
  'Most of them will not pick up.',
  'Then text them.',
  'How many times do you follow up before you stop?',
  'The first seven days do the work.',
  'Your own words, not mine.',
];

export const CARDS = TITLES.map((title, i) => slide(i + 1, title));

// Quiz — every answer is recoverable from the 31 slides above. No Day 1 / Day 3 FUB questions.
export const QUESTIONS = [
  {
    idx: 1,
    prompt: 'LEAD is the whole first call. What do the four letters stand for, in order?',
    choices: [
      'Location, Empathy, Appointment, Details',
      'Lead, Extend, Ask, Deliver',
      'Listen, Explain, Ask, Decide',
      'Lead, Ask, Extend, Deliver',
    ],
    answer: 1,
    explain: 'Slide 10: L Lead with who you are, E Extend the invitation, A Ask and listen, D Deliver the summary. In that order.',
  },
  {
    idx: 2,
    prompt: 'When do you ask for the appointment?',
    choices: [
      'After discovery, once they seem serious',
      'Before discovery — Extend comes before Ask',
      'Only after they are pre-approved',
      'At the end, after you deliver the summary',
    ],
    answer: 1,
    explain: 'Slide 10 and 12: the appointment ask comes before discovery, not after it. Ask before you ask them a single thing about themselves.',
  },
  {
    idx: 3,
    prompt: 'How do you extend the invitation?',
    choices: [
      '"Do you want to see it?"',
      'Two options, never yes-or-no — mornings or afternoons',
      'Wait until they ask to tour',
      'Email a calendar link and hang up',
    ],
    answer: 1,
    explain: 'Slide 12: "Do you want to see it?" invites a no. "Mornings or afternoons?" invites a choice.',
  },
  {
    idx: 4,
    prompt: 'The fourth of the six moves when they start asking questions is:',
    choices: [
      'Answer the easiest question first',
      'Park — say you will get them addressed, then stop. Do not answer.',
      'Go to discovery immediately',
      'Ask about budget so you know if they are serious',
    ],
    answer: 1,
    explain: 'Slide 18: the fourth move is the whole thing — park, do not answer. Most agents blow the call at move four.',
  },
  {
    idx: 5,
    prompt: 'What do you not ask on a first call?',
    choices: [
      'Have you had a chance to go see any other homes?',
      'Are you pre-approved, what is your budget, how much are you putting down',
      'Mornings or afternoons',
      'Permission to ask a couple of questions',
    ],
    answer: 1,
    explain: 'Slide 15: none of that is yours yet. Financing is Day 4, after the appointment — not in front of it.',
  },
  {
    idx: 6,
    prompt: 'Advocate, not gatekeeper means you:',
    choices: [
      'Screen for pre-approval before you serve them',
      'Serve, then learn — recommend from something they actually said',
      'Ask about money first',
      'Sell urgency nobody asked for',
    ],
    answer: 1,
    explain: 'Slide 6: an advocate serves then learns. Every recommendation traces back to something the buyer actually said.',
  },
  {
    idx: 7,
    prompt: 'The voicemail when they do not pick up is:',
    choices: [
      'A new script with discovery questions',
      'L and E — who you are, why you called, and two times',
      'Just your name and “call me back”',
      'A full interview on the recording',
    ],
    answer: 1,
    explain: 'Slide 27: the voicemail is not a new script. It is L and E, with nobody on the other end. No discovery — there is nobody to discover.',
  },
  {
    idx: 8,
    prompt: 'When you cannot reach somebody, the first seven days do the work. How many attempts?',
    choices: [
      'One voicemail and you stop',
      '5–7 attempts across the first week, front-loaded',
      'Daily calls for thirty days',
      'Email only after two weeks',
    ],
    answer: 1,
    explain: 'Slide 30: 5–7 attempts across the first week. Front-load it. After week one the odds drop off sharply.',
  },
  {
    idx: 9,
    prompt: 'Every one of those follow-up attempts is:',
    choices: [
      'Optional if you remember the call',
      'A note and a dated task',
      'A calendar invite to yourself',
      'A comment on the Zillow lead',
    ],
    answer: 1,
    explain: 'Slide 30: every attempt is a note and a dated task. A call with no note is a call nobody can see.',
  },
  {
    idx: 10,
    prompt: 'End every call by delivering the summary. What are the three parts?',
    choices: [
      'Price, rate, and pre-approval',
      'What we talked about, what they are looking for, what happens next and when',
      'Name, brokerage, and Zillow',
      'Stage, note, and a listing comment',
    ],
    answer: 1,
    explain: 'Slide 16: what we talked about, what you are looking for in their words, and what happens next and when.',
  },
];

export const MODULE = {
  id: MODULE_ID,
  org_id: null,
  idx: 7,
  title: TITLE,
  summary: 'The first conversation, advocate not gatekeeper, four beats (LEAD), appointment on the first call, follow-up when they don’t pick up.',
  body: 'Day 2 of Zillow Preferred onboarding — Winning the First Conversation. Thirty-one slides.',
  cards: CARDS,
  pass_pct: 80,
  active: true,
  status: 'published',
  source: 'system',
  kind: 'lesson',
  duration_min: 90,
  level: 'core',
  tags: ['zillow', 'day-2', 'conversation', 'official'],
  // core=false on purpose: switching this on changes the certification
  // denominator for every agent already at 100%. That is Eric's call, not a
  // side effect of publishing the content.
  core: false,
};

export const TRACK_LINK = {
  track_id: TRACK_ID,
  module_id: MODULE_ID,
  idx: 2,
  required: true,
};

async function must(res, what) {
  if (!res.ok) throw new Error(`${what} ${res.status}: ${await res.text()}`);
}

async function seed() {
  if (!process.argv[2]) throw new Error('Usage: node rep_zillow_day2.mjs <path-to-secrets.json>');
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
