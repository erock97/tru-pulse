import {
  OFFICIAL_TRAINING_ID as SHARED_OFFICIAL_TRAINING_ID,
  OFFICIAL_TRAINING_PASS_PCT,
  OFFICIAL_TRAINING_QUIZ,
  scoreOfficialTraining,
} from '../../../shared/officialTrainingQuiz';
import type { CourseQuestion, LessonCard } from './api';

export const OFFICIAL_TRAINING_ID = SHARED_OFFICIAL_TRAINING_ID;
export const OFFICIAL_TRAINING_TITLE = 'Official Training';
export const OFFICIAL_TRAINING_DECK = 'zillow-day1';
export { OFFICIAL_TRAINING_PASS_PCT, scoreOfficialTraining };

const SLIDE_TITLES = [
  'Title',
  'Two things',
  'Four days',
  'How a lead reaches you',
  'People',
  'Demo find the lead',
  'Four questions',
  'Details panel',
  'Context not story',
  'Stage truth',
  'Your turn stages',
  'The answers',
  'Notes',
  'Tasks',
  'Repair Avery',
  'Four checks',
  'Way back tomorrow',
  'Close',
] as const;

function slide(n: number): LessonCard {
  return { t: 'slide', deck: OFFICIAL_TRAINING_DECK, slide: n, title: SLIDE_TITLES[n - 1] };
}

/** Day 1 slides with the live practice / dealslide cards interleaved after Notes. */
export const OFFICIAL_TRAINING_CARDS: LessonCard[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(slide),
  { t: 'practice', scenario: 'set-appointment', title: 'You set an appointment' },
  slide(13),
  { t: 'practice', scenario: 'spoke-note', title: 'You spoke with the client' },
  slide(14),
  { t: 'practice', scenario: 'noanswer-task', title: 'You called and they did not pick up' },
  slide(15),
  { t: 'practice', scenario: 'avery-repair', title: 'Repair the record' },
  slide(16),
  { t: 'dealslide', title: 'Deals' },
  { t: 'practice', scenario: 'offer-accepted', title: 'The offer went through' },
  slide(17),
  slide(18),
];

export const OFFICIAL_TRAINING_QS: CourseQuestion[] = OFFICIAL_TRAINING_QUIZ.map((q, i) => ({
  id: `d1-q${i + 1}`,
  idx: i + 1,
  prompt: q.prompt,
  choices: q.choices,
}));

export const OFFICIAL_TRAINING_ANSWERS = OFFICIAL_TRAINING_QUIZ.map((q) => q.answer);
