// Official Training (Day 1) quiz — recoverable from the 18 zillow-day1 slides
// plus the record/practice teaching (stages, notes, tasks, People, four checks).
// Shared so the demo grader and worker /rep/grade fallback use the same key.
// Do not write these rows to the live database from a code PR.

export const OFFICIAL_TRAINING_ID = 'a6666666-6666-6666-6666-666666666666';
export const OFFICIAL_TRAINING_PASS_PCT = 80;

export const OFFICIAL_TRAINING_QUIZ: Array<{
  prompt: string;
  choices: string[];
  answer: number;
  explain: string;
}> = [
  {
    prompt: 'A new Zillow connection arrives. What do you do first?',
    choices: [
      'Call immediately',
      'Open the record and read what is already known',
      'Send a text',
      'Wait for the buyer to follow up',
    ],
    answer: 1,
    explain: 'People first — open the record and read the facts the buyer and the system already gave you, then choose a channel that fits them.',
  },
  {
    prompt: 'Your team handles a no-answer differently from what the deck shows. You should:',
    choices: [
      'Guess and keep moving',
      'Ask your team lead',
      'Invent a stage that fits',
      'Leave the record untouched',
    ],
    answer: 1,
    explain: 'Do not guess at a team rule and do not invent one. Asking once is faster than cleaning up a list nobody trusts.',
  },
  {
    prompt: "You picked the right stage on Avery's record. What is the step everyone misses?",
    choices: [
      'Telling your team lead',
      'Clicking the green check to save it, then reopening to confirm it stuck',
      'Adding a second note',
      'Moving them to a smart list',
    ],
    answer: 1,
    explain: 'Choosing a stage does not save it. Click the green check, then reopen the record and confirm it actually stuck.',
  },
  {
    prompt: 'The record shows the buyer viewed a home four times. You may safely write:',
    choices: [
      '"She loves this home."',
      '"FUB shows repeat views of this home."',
      '"She is ready to make an offer."',
      '"This is her favourite property."',
    ],
    answer: 1,
    explain: 'Home Activity is a signal, not certainty. It helps you ask a better question; it proves nothing about intent.',
  },
  {
    prompt: 'You talked with the buyer about what they need, but no time is set. The stage is:',
    choices: [
      'Lead',
      'Attempted Contact',
      'Spoke with Customer',
      'Appointment Set',
    ],
    answer: 2,
    explain: 'You learned something real, and there is still no appointment. Appointment Set needs a confirmed date and time — not "sometime this weekend."',
  },
  {
    prompt: 'You called and left a voicemail. No call back yet. The stage is:',
    choices: [
      'Lead',
      'Attempted Contact',
      'Spoke with Customer',
      'Appointment Set',
    ],
    answer: 1,
    explain: 'You tried. Trying is not talking. The stage only moves when something real actually happened.',
  },
  {
    prompt: 'A useful note answers which three things?',
    choices: [
      'Who, where, and how much',
      'What happened, what the buyer needs, what is next and when',
      'The buyer’s job, budget, and timeline',
      'Your opinion, your plan, and your schedule',
    ],
    answer: 1,
    explain: 'FUB does not enforce it — it is our habit, and it is what lets a teammate take over.',
  },
  {
    prompt: 'The buyer told you their timeframe. How should that go in the record?',
    choices: [
      'As a confirmed fact',
      'As their own words, not a verified fact',
      'As a reason to change the stage',
      'Leave it out',
    ],
    answer: 1,
    explain: 'Timeframe is self-reported. It is a reason to ask a better question, never an answer to one — and never quote it back as if it were verified.',
  },
  {
    prompt: 'A task differs from a note because it:',
    choices: [
      'Repeats the note for safety',
      'Is one specific future action with an owner, date, and time',
      'Is only for appointments',
      'Is optional once the note is good',
    ],
    answer: 1,
    explain: 'The note records the past; the task schedules the future. A promise with no date is not a next step.',
  },
  {
    prompt: 'Day 1 is finished when:',
    choices: [
      'You have called every lead',
      'The screen looks familiar',
      'Another agent could open your record and know what happened and what comes next',
      'The Smart List is empty',
    ],
    answer: 2,
    explain: 'The four checks: accurate, saved, understandable, scheduled. Smart List membership is never the finish line.',
  },
];

export interface OfficialTrainingGradeQ {
  idx: number;
  answer: number;
  explain: string | null;
}

export interface OfficialTrainingScore {
  score: number;
  passed: boolean;
  correct: number;
  total: number;
  review: Array<{
    idx: number;
    your: number;
    correct_index: number;
    is_correct: boolean;
    explain: string | null;
  }>;
}

export function scoreOfficialTraining(answers: number[]): OfficialTrainingScore {
  const key = OFFICIAL_TRAINING_QUIZ.map((q) => q.answer);
  let correct = 0;
  const review = key.map((ans, i) => {
    const your = typeof answers[i] === 'number' ? answers[i] : -1;
    const is_correct = your === ans;
    if (is_correct) correct++;
    return {
      idx: i + 1,
      your,
      correct_index: ans,
      is_correct,
      explain: OFFICIAL_TRAINING_QUIZ[i]?.explain ?? null,
    };
  });
  const total = key.length || 1;
  const score = Math.round((correct / total) * 100);
  return { score, passed: score >= OFFICIAL_TRAINING_PASS_PCT, correct, total, review };
}

/** Worker /rep/grade: keep live rows when present; otherwise grade the in-repo 10 Q. */
export function officialTrainingGradeQuestions(
  moduleId: string,
  dbQs: OfficialTrainingGradeQ[],
): OfficialTrainingGradeQ[] {
  if (dbQs.length) return dbQs;
  if (moduleId !== OFFICIAL_TRAINING_ID) return [];
  return OFFICIAL_TRAINING_QUIZ.map((q, i) => ({
    idx: i + 1,
    answer: q.answer,
    explain: q.explain,
  }));
}
