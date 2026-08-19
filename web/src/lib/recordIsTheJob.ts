import type { CourseQuestion, LessonCard } from './api';

export const RECORD_IS_THE_JOB_ID = 'a9999999-9999-9999-9999-999999999999';
export const RECORD_IS_THE_JOB_TITLE = 'The Record Is the Job';
export const RECORD_IS_THE_JOB_PASS_PCT = 80;

export const RECORD_IS_THE_JOB_CARDS: LessonCard[] = [
  {
    t: 'section',
    n: '01',
    title: 'The record is the job',
    body: 'Your leader does not grade the call they did not hear. They open Follow Up Boss. If the file is a lie, the work did not happen.',
  },
  {
    t: 'callout',
    body: 'Pause, unpause, and the 1:1 are read off this file — not off your memory. If they opened any record right now, they should know what happened and what happens next.',
  },
  {
    t: 'compare',
    good: [
      'Stage matches the last real outcome. Appointment set only when a date and time are on the calendar.',
      'A teammate could pick this up cold and not look foolish.',
    ],
    bad: [
      'Stage says Appointment set because the call “went well.”',
      'Stage sits on Lead after you already spoke, because you forgot to move it.',
    ],
  },
  {
    t: 'steps',
    title: 'Three writes. That is the whole system.',
    steps: [
      'Note — what happened. Facts a teammate can use. Not a diary. Not “talked, interested.”',
      'Task — what is next, and when. A date on it. “Follow up later” is not a task.',
      'Appointment — only if it is actually on the calendar. The stage then matches.',
    ],
  },
  {
    t: 'drill',
    prompt: 'You just hung up. They want to see homes this weekend but they did not pick a time. What do you write?',
    choices: [
      'Stage Appointment set, note “wants to see homes this weekend,” no task',
      'Stage Spoke with customer, a note with what they want, and a dated task to send times',
      'Leave the stage on Lead so you do not get ahead of yourself',
      'Create an appointment for Saturday at 10 and confirm later',
    ],
    answer: 1,
    explain: 'Nothing is on the calendar, so Appointment set is a lie. Spoke with customer plus a real note plus a dated next task is the honest file.',
  },
  {
    t: 'callout',
    body: 'The clock is in minutes, not hours. First attempt goes on the record before you put the phone down — even when they do not pick up.',
  },
  {
    t: 'drill',
    prompt: 'New paid lead. You called, it rang out, you left a voicemail. What is on the record before you touch the next lead?',
    choices: [
      'Nothing yet — you will log a batch of attempts at lunch',
      'Stage still Lead, no note, a task for “sometime this week”',
      'Stage Attempted contact, a note that you called and left a VM, and a dated retry',
      'Stage Spoke with customer, because a voicemail counts as a conversation',
    ],
    answer: 2,
    explain: 'A voicemail is an attempt, not a conversation. The note and the dated retry are the proof. Batching it later is how leads go cold with a clean-looking file.',
  },
  {
    t: 'practice',
    scenario: 'honest-stage',
    title: 'The stage is a lie',
  },
  {
    t: 'steps',
    title: 'What a clean day looks like',
    steps: [
      'Every lead you touched has a stage that matches the last real outcome.',
      'Every one of those has a note from today — what happened, in facts.',
      'Every one of those has one dated next task. Nothing sitting on “follow up later.”',
      'You can hand the phone to a teammate at 5:00 and they will not get blindsided.',
    ],
  },
  {
    t: 'compare',
    good: [
      'You called, no answer, VM, dated retry tomorrow morning. Stage is Attempted contact.',
      'You spoke, nothing booked, note has the facts, task is “send two times by Thursday.”',
    ],
    bad: [
      'Empty notes and a stage that looks busy.',
      'A task with no date.',
      'Appointment set because you are “pretty sure they will confirm.”',
    ],
  },
  {
    t: 'practice',
    scenario: 'day-close',
    title: 'Close the day on this file',
  },
  {
    t: 'callout',
    body: 'If your leader opened any record right now, they should know what happened and what happens next. That is the job.',
  },
];

const QUIZ: Array<{ prompt: string; choices: string[]; answer: number; explain: string }> = [
  {
    prompt: 'When is Appointment set a legal stage?',
    choices: [
      'The call went well',
      'A date and time are on the calendar',
      'A voicemail about a showing',
      'They asked you to send times',
    ],
    answer: 1,
    explain: 'Appointment set means it is booked. Wanting to see homes is still Spoke with customer.',
  },
  {
    prompt: 'What belongs in a note vs a task?',
    choices: [
      'Note is the next step',
      'Note is what happened. Task is next, with a date',
      'Both are optional',
      'The note can say follow up later',
    ],
    answer: 1,
    explain: 'The note is the record of the conversation. The task is the promise. “Follow up later” is neither.',
  },
  {
    prompt: 'A record says “Follow up later” and has no date on a task. What failed?',
    choices: [
      'The stage',
      'The source field',
      'The next task',
      'The deal',
    ],
    answer: 2,
    explain: 'That phrase is not a next action. A task without a date is how work disappears.',
  },
  {
    prompt: 'First attempt on a new paid lead is measured in what?',
    choices: [
      'Hours — same day',
      'Minutes — on the record before you put the phone down',
      'Next business morning',
      'Batch at lunch',
    ],
    answer: 1,
    explain: 'Paid leads go cold in minutes. The file has to show the attempt immediately, even if they did not pick up.',
  },
  {
    prompt: 'You called, no answer, left a voicemail. What is on the record before you touch the next lead?',
    choices: [
      'Spoke with customer, no task',
      'Nothing — catch up in the afternoon',
      'Attempted contact, a note that you left a VM, and a dated retry',
      'An appointment for a callback',
    ],
    answer: 2,
    explain: 'A voicemail is an attempt. The note and the dated retry are the proof. Batching it later is how the clock is faked.',
  },
  {
    prompt: 'What does a leader look at first when they open your file?',
    choices: [
      'Call count',
      'Stage, last note, and the next task',
      'The source field',
      'The Zillow email',
    ],
    answer: 1,
    explain: 'Those three tell them what happened and what happens next. That is the 1:1 and the pause decision.',
  },
  {
    prompt: 'What gets an agent paused?',
    choices: [
      'Lunch',
      'Records that do not match reality — empty notes, no next task, stages that lie',
      'Asking for help',
      'A lead not converted',
    ],
    answer: 1,
    explain: 'Pause is not punishment for a slow week. It is what happens when the file cannot be trusted.',
  },
  {
    prompt: 'There is an appointment on the calendar. The stage still says Lead. What is wrong?',
    choices: [
      'Nothing — the calendar is the truth',
      'The stage lags the truth',
      'Delete the appointment',
      'Move to Nurture',
    ],
    answer: 1,
    explain: 'The stage has to match the last real outcome. A booked appointment and a Lead stage is two different stories.',
  },
  {
    prompt: 'You had a real conversation. Nothing is booked. What is the honest stage?',
    choices: [
      'Appointment set',
      'Lead',
      'Spoke with customer',
      'Under contract',
    ],
    answer: 2,
    explain: 'A conversation with nothing on the calendar is Spoke with customer. Appointment set is a lie.',
  },
  {
    prompt: 'End of day. Every lead you touched must have which three things?',
    choices: [
      'A logged call, a smile, and an email',
      'An honest stage, a note from today, and one dated next task',
      'Appointment set, a long note, no task',
      'Lead, no note, a task for sometime',
    ],
    answer: 1,
    explain: 'That is a clean day. A teammate could take any one of those files at 5:00 and not get blindsided.',
  },
];

export const RECORD_IS_THE_JOB_QS: CourseQuestion[] = QUIZ.map((q, i) => ({
  id: `ritj-q${i + 1}`,
  idx: i + 1,
  prompt: q.prompt,
  choices: q.choices,
}));

export const RECORD_IS_THE_JOB_ANSWERS = QUIZ.map((q) => q.answer);
export const RECORD_IS_THE_JOB_EXPLAINS = QUIZ.map((q) => q.explain);

export function scoreRecordIsTheJob(answers: number[]): { correct: number; total: number; score: number; passed: boolean } {
  const total = RECORD_IS_THE_JOB_ANSWERS.length;
  const correct = RECORD_IS_THE_JOB_ANSWERS.reduce((n, ans, i) => n + (answers[i] === ans ? 1 : 0), 0);
  const score = Math.round((correct / total) * 100);
  return { correct, total, score, passed: score >= RECORD_IS_THE_JOB_PASS_PCT };
}
