import type { CourseQuestion, LessonCard } from './api';

export const WINNING_FIRST_CONVERSATION_ID = 'a8888888-8888-8888-8888-888888888888';
export const WINNING_FIRST_CONVERSATION_TITLE = 'Winning the First Conversation';
export const WINNING_FIRST_CONVERSATION_DECK = 'zillow-day2';

export const WINNING_FIRST_CONVERSATION_TITLES = [
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
] as const;

export const WINNING_FIRST_CONVERSATION_CARDS: LessonCard[] = WINNING_FIRST_CONVERSATION_TITLES.map((title, i) => ({
  t: 'slide',
  deck: WINNING_FIRST_CONVERSATION_DECK,
  slide: i + 1,
  title,
}));

const QUIZ: Array<{ prompt: string; choices: string[]; answer: number }> = [
  {
    prompt: 'LEAD is the whole first call. What do the four letters stand for, in order?',
    choices: [
      'Location, Empathy, Appointment, Details',
      'Lead, Extend, Ask, Deliver',
      'Listen, Explain, Ask, Decide',
      'Lead, Ask, Extend, Deliver',
    ],
    answer: 1,
  },
  {
    prompt: 'When do you ask for the appointment?',
    choices: [
      'After discovery, once they seem serious',
      'Before discovery — Extend comes before Ask',
      'Only after they are pre-approved',
      'At the end, after you deliver the summary',
    ],
    answer: 1,
  },
  {
    prompt: 'How do you extend the invitation?',
    choices: [
      '"Do you want to see it?"',
      'Two options, never yes-or-no — mornings or afternoons',
      'Wait until they ask to tour',
      'Email a calendar link and hang up',
    ],
    answer: 1,
  },
  {
    prompt: 'The fourth of the six moves when they start asking questions is:',
    choices: [
      'Answer the easiest question first',
      'Park — say you will get them addressed, then stop. Do not answer.',
      'Go to discovery immediately',
      'Ask about budget so you know if they are serious',
    ],
    answer: 1,
  },
  {
    prompt: 'What do you not ask on a first call?',
    choices: [
      'Have you had a chance to go see any other homes?',
      'Are you pre-approved, what is your budget, how much are you putting down',
      'Mornings or afternoons',
      'Permission to ask a couple of questions',
    ],
    answer: 1,
  },
  {
    prompt: 'Advocate, not gatekeeper means you:',
    choices: [
      'Screen for pre-approval before you serve them',
      'Serve, then learn — recommend from something they actually said',
      'Ask about money first',
      'Sell urgency nobody asked for',
    ],
    answer: 1,
  },
  {
    prompt: 'The voicemail when they do not pick up is:',
    choices: [
      'A new script with discovery questions',
      'L and E — who you are, why you called, and two times',
      'Just your name and “call me back”',
      'A full interview on the recording',
    ],
    answer: 1,
  },
  {
    prompt: 'When you cannot reach somebody, the first seven days do the work. How many attempts?',
    choices: [
      'One voicemail and you stop',
      '5–7 attempts across the first week, front-loaded',
      'Daily calls for thirty days',
      'Email only after two weeks',
    ],
    answer: 1,
  },
  {
    prompt: 'Every one of those follow-up attempts is:',
    choices: [
      'Optional if you remember the call',
      'A note and a dated task',
      'A calendar invite to yourself',
      'A comment on the Zillow lead',
    ],
    answer: 1,
  },
  {
    prompt: 'End every call by delivering the summary. What are the three parts?',
    choices: [
      'Price, rate, and pre-approval',
      'What we talked about, what they are looking for, what happens next and when',
      'Name, brokerage, and Zillow',
      'Stage, note, and a listing comment',
    ],
    answer: 1,
  },
];

export const WINNING_FIRST_CONVERSATION_QS: CourseQuestion[] = QUIZ.map((q, i) => ({
  id: `d2-q${i + 1}`,
  idx: i + 1,
  prompt: q.prompt,
  choices: q.choices,
}));

export const WINNING_FIRST_CONVERSATION_ANSWERS = QUIZ.map((q) => q.answer);
