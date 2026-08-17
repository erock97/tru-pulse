import type { CourseQuestion, LessonCard } from './api';

export const SHOW_LIKE_A_PRO_ID = 'a7777777-7777-7777-7777-777777777777';
export const SHOW_LIKE_A_PRO_TITLE = 'Show Like a Pro';
export const SHOW_LIKE_A_PRO_DECK = 'zillow-day3';

export const SHOW_LIKE_A_PRO_TITLES = [
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
] as const;

export const SHOW_LIKE_A_PRO_CARDS: LessonCard[] = SHOW_LIKE_A_PRO_TITLES.map((title, i) => ({
  t: 'slide',
  deck: SHOW_LIKE_A_PRO_DECK,
  slide: i + 1,
  title,
}));

const QUIZ: Array<{ prompt: string; choices: string[]; answer: number }> = [
  {
    prompt: 'Why show two or three homes, never one?',
    choices: [
      'Zillow requires three showings per lead',
      'The rating question is worthless with only one house',
      'Buyers get tired after a single house',
      'One house is easier to schedule',
    ],
    answer: 1,
  },
  {
    prompt: 'Available, not attached means you:',
    choices: [
      'Follow them room to room so you can answer instantly',
      'Stay on the sidewalk until they call you',
      'Let them walk in first and hold the kitchen or the entry',
      'Narrate every room so they do not feel ignored',
    ],
    answer: 2,
  },
  {
    prompt: 'Say the real thing. Skip the rest. What is worth saying out loud?',
    choices: [
      'A chip in the wall and paint you would not have chosen',
      'Anything that changes the price or safety',
      'The ceiling fans and a kitchen layout you dislike',
      'Whatever the photos already showed',
    ],
    answer: 1,
  },
  {
    prompt: 'What is the first sidewalk question?',
    choices: [
      'How did you like them?',
      "Did you see one you'd write on?",
      'What is your budget?',
      'Are you pre-approved?',
    ],
    answer: 1,
  },
  {
    prompt: 'Why ask them to rate the homes one to ten?',
    choices: [
      'A number is vague and keeps things light',
      'A number aims question three at a specific house',
      'You skip the rest of the closeout if they say seven',
      'It replaces the need for an appointment',
    ],
    answer: 1,
  },
  {
    prompt: 'How do you ask what would make it an eight?',
    choices: [
      'Ask their wish list directly',
      'As a hypothetical — take a trip with me',
      'Tell them what to change',
      'Skip to financing',
    ],
    answer: 1,
  },
  {
    prompt: 'Cash under the bed, or a lender — what are you actually finding out?',
    choices: [
      'What they earn',
      'How they pay',
      'Whether they are serious',
      'Their credit score',
    ],
    answer: 1,
  },
  {
    prompt: 'Before you ask whether the date is a guess or a deadline, you:',
    choices: [
      'Take the number at face value',
      'Use the permission line first',
      'Push a lender immediately',
      'Skip the question if they said six months',
    ],
    answer: 1,
  },
  {
    prompt: 'Leave with an appointment. What makes it an appointment, not an intention?',
    choices: [
      '"I\'ll follow up"',
      'A date, a time, and a purpose',
      'An MLS search',
      '"Let me know if you see anything"',
    ],
    answer: 1,
  },
  {
    prompt: 'Before you drive away, which three things do you do in the car?',
    choices: [
      'Call your team lead, send a recap, wait until tonight',
      'Move the stage, write the note, set the task',
      'Post the showing, email comparables, close the lead',
      'Rate the houses yourself, then follow up tomorrow',
    ],
    answer: 1,
  },
];

export const SHOW_LIKE_A_PRO_QS: CourseQuestion[] = QUIZ.map((q, i) => ({
  id: `d3-q${i + 1}`,
  idx: i + 1,
  prompt: q.prompt,
  choices: q.choices,
}));

export const SHOW_LIKE_A_PRO_ANSWERS = QUIZ.map((q) => q.answer);
