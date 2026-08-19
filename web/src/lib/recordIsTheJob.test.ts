import { describe, expect, it } from 'vitest';
import { demoCatalogTitles } from './api';
import {
  isOfficialTraining,
  isRecordIsTheJob,
  isZillowOnboarding,
  trainingBay,
} from './agentHq';
import { OFFICIAL_TRAINING_CARDS, OFFICIAL_TRAINING_ID, OFFICIAL_TRAINING_QS, OFFICIAL_TRAINING_TITLE } from './officialTraining';
import { SHOW_LIKE_A_PRO_CARDS, SHOW_LIKE_A_PRO_ID, SHOW_LIKE_A_PRO_TITLE } from './showLikeAPro';
import {
  RECORD_IS_THE_JOB_ANSWERS,
  RECORD_IS_THE_JOB_CARDS,
  RECORD_IS_THE_JOB_ID,
  RECORD_IS_THE_JOB_PASS_PCT,
  RECORD_IS_THE_JOB_QS,
  RECORD_IS_THE_JOB_TITLE,
  scoreRecordIsTheJob,
} from './recordIsTheJob';
import { PACKS } from '../pages/PracticeRecord';
import { WINNING_FIRST_CONVERSATION_CARDS, WINNING_FIRST_CONVERSATION_ID, WINNING_FIRST_CONVERSATION_TITLE } from './winningFirstConversation';

const OFFICIAL_TRAINING_UUID = 'a6666666-6666-6666-6666-666666666666';
const DAY2_ID = 'a8888888-8888-8888-8888-888888888888';
const DAY3_ID = 'a7777777-7777-7777-7777-777777777777';
const TRACK_ID = 'b2222222-2222-2222-2222-222222222222';
const JULY = [
  'Welcome to Preferred',
  'The ALMS Call Framework',
  'The TRU Way: Speed to Lead',
  'Working a Paid Lead End to End',
  'Follow-Up Discipline & the CRM',
];

type Seed = {
  MODULE_ID: string;
  TITLE: string;
  CARDS: Array<{ t: string; scenario?: string; title?: string }>;
  QUESTIONS: Array<{ prompt: string; choices: string[]; answer: number; explain: string }>;
  MODULE: {
    id: string; title: string; kind: string; status: string; active: boolean;
    source: string; org_id: null; tags: string[]; summary: string; body: string;
    pass_pct: number; duration_min: number; level: string; core: boolean; idx: number;
  };
  TRACK_LINK?: unknown;
};

async function loadSeed(): Promise<Seed> {
  // @ts-expect-error runtime import of the seed file
  return import('../../../db/rep_record_is_the_job.mjs');
}

describe('The Record Is the Job', () => {
  it('ships twelve AgentCourse cards and a ten-question 80% quiz', async () => {
    const seed = await loadSeed();
    expect(RECORD_IS_THE_JOB_TITLE).toBe('The Record Is the Job');
    expect(RECORD_IS_THE_JOB_ID).toBe('a9999999-9999-9999-9999-999999999999');
    expect(RECORD_IS_THE_JOB_CARDS).toHaveLength(12);
    expect(RECORD_IS_THE_JOB_QS).toHaveLength(10);
    expect(RECORD_IS_THE_JOB_ANSWERS).toHaveLength(10);
    expect(RECORD_IS_THE_JOB_PASS_PCT).toBe(80);
    expect(RECORD_IS_THE_JOB_QS.map((q) => q.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ritj-q${i + 1}`),
    );
    expect(seed.CARDS).toHaveLength(12);
    expect(seed.QUESTIONS).toHaveLength(10);
    expect(seed.MODULE.pass_pct).toBe(80);
    expect(seed.MODULE.duration_min).toBe(30);
    expect(seed.MODULE.kind).toBe('lesson');
    expect(seed.MODULE.level).toBe('core');
    expect(seed.MODULE.core).toBe(false);
    expect(seed.MODULE.active).toBe(true);
    expect(seed.MODULE.status).toBe('published');
    expect(seed.MODULE.source).toBe('system');
    expect(seed.MODULE.org_id).toBeNull();
    expect(seed.MODULE.idx).toBe(9);
    expect(seed.MODULE.tags).toEqual(['fub', 'crm', 'new-agent']);
    expect(seed.MODULE.summary).toBe(
      'Follow Up Boss is how this team runs. Honest stages, a note from today, one dated next task.',
    );
    expect(seed.MODULE.body).toBe(
      'Day 1 taught you how to work one record. This is the operating system: what a stage is allowed to mean, what belongs in a note vs a task, and what gets you paused.',
    );
  });

  it('uses only existing AgentCourse card types and the two new practice packs', () => {
    const allowed = new Set(['section', 'callout', 'compare', 'steps', 'drill', 'practice', 'text']);
    expect(RECORD_IS_THE_JOB_CARDS.every((c) => allowed.has(c.t))).toBe(true);
    expect(RECORD_IS_THE_JOB_CARDS.some((c) => c.t === 'slide' || c.t === 'dealslide' || c.t === 'lab')).toBe(false);
    const practices = RECORD_IS_THE_JOB_CARDS.filter((c) => c.t === 'practice');
    expect(practices.map((c) => c.scenario)).toEqual(['honest-stage', 'day-close']);
    expect(practices.map((c) => c.title)).toEqual(['The stage is a lie', 'Close the day on this file']);
  });

  it('is not on the Zillow track and is not Official Training', async () => {
    const seed = await loadSeed();
    expect(seed.TRACK_LINK).toBeUndefined();
    expect(JSON.stringify(seed)).not.toContain(TRACK_ID);
    expect(seed.MODULE_ID).not.toBe(OFFICIAL_TRAINING_UUID);
    expect(seed.MODULE_ID).not.toBe(DAY2_ID);
    expect(seed.MODULE_ID).not.toBe(DAY3_ID);
    expect(isOfficialTraining({ id: RECORD_IS_THE_JOB_ID, title: RECORD_IS_THE_JOB_TITLE })).toBe(false);
    expect(isZillowOnboarding({ id: RECORD_IS_THE_JOB_ID, title: RECORD_IS_THE_JOB_TITLE })).toBe(false);
    expect(isRecordIsTheJob({ id: RECORD_IS_THE_JOB_ID, title: RECORD_IS_THE_JOB_TITLE })).toBe(true);
  });

  it('appears under New agents and Additional, not Zillow onboarding', () => {
    const bay = trainingBay([
      { id: OFFICIAL_TRAINING_ID, title: OFFICIAL_TRAINING_TITLE },
      { id: WINNING_FIRST_CONVERSATION_ID, title: WINNING_FIRST_CONVERSATION_TITLE },
      { id: SHOW_LIKE_A_PRO_ID, title: SHOW_LIKE_A_PRO_TITLE },
      { id: RECORD_IS_THE_JOB_ID, title: RECORD_IS_THE_JOB_TITLE },
    ]);
    expect(bay[0].modules.map((m) => m.id)).toContain(RECORD_IS_THE_JOB_ID);
    expect(bay[1].modules.map((m) => m.id)).not.toContain(RECORD_IS_THE_JOB_ID);
    expect(bay[2].modules.map((m) => m.id)).toContain(RECORD_IS_THE_JOB_ID);
  });

  it('is in the demo catalog with Days 1–3, and July modules stay hidden', () => {
    const titles = demoCatalogTitles();
    expect(titles).toContain(RECORD_IS_THE_JOB_TITLE);
    expect(titles).toContain(OFFICIAL_TRAINING_TITLE);
    expect(titles).toContain(WINNING_FIRST_CONVERSATION_TITLE);
    expect(titles).toContain(SHOW_LIKE_A_PRO_TITLE);
    for (const title of JULY) expect(titles).not.toContain(title);
  });

  it('leaves Days 1–3 cards and quizzes unchanged', () => {
    expect(OFFICIAL_TRAINING_CARDS).toHaveLength(24);
    expect(OFFICIAL_TRAINING_QS).toHaveLength(10);
    expect(WINNING_FIRST_CONVERSATION_CARDS).toHaveLength(31);
    expect(WINNING_FIRST_CONVERSATION_CARDS.every((c) => c.t === 'slide' && c.deck === 'zillow-day2')).toBe(true);
    expect(SHOW_LIKE_A_PRO_CARDS).toHaveLength(31);
    expect(SHOW_LIKE_A_PRO_CARDS.every((c) => c.t === 'slide' && c.deck === 'zillow-day3')).toBe(true);
    expect(isZillowOnboarding({ id: OFFICIAL_TRAINING_ID, title: OFFICIAL_TRAINING_TITLE })).toBe(true);
    expect(isZillowOnboarding({ id: WINNING_FIRST_CONVERSATION_ID, title: WINNING_FIRST_CONVERSATION_TITLE })).toBe(true);
    expect(isZillowOnboarding({ id: SHOW_LIKE_A_PRO_ID, title: SHOW_LIKE_A_PRO_TITLE })).toBe(true);
  });

  it('passes at 8/10 and fails at 7/10', () => {
    const pass = scoreRecordIsTheJob(RECORD_IS_THE_JOB_ANSWERS.map((a, i) => (i < 8 ? a : a === 0 ? 1 : 0)));
    expect(pass.correct).toBe(8);
    expect(pass.score).toBe(80);
    expect(pass.passed).toBe(true);
    const fail = scoreRecordIsTheJob(RECORD_IS_THE_JOB_ANSWERS.map((a, i) => (i < 7 ? a : a === 0 ? 1 : 0)));
    expect(fail.correct).toBe(7);
    expect(fail.score).toBe(70);
    expect(fail.passed).toBe(false);
  });

  it('adds honest-stage and day-close packs without an audit gate or noteToCopy', () => {
    expect(PACKS['honest-stage'].title).toBe('The stage is a lie');
    expect(PACKS['honest-stage'].startStage).toBe('Appointment set');
    expect(PACKS['honest-stage'].audit).toBeUndefined();
    expect(PACKS['honest-stage'].noteToCopy).toBeUndefined();
    expect(PACKS['honest-stage'].steps.map((s) => s.id)).toEqual(['stage', 'note', 'task']);
    expect(PACKS['day-close'].title).toBe('Close the day on this file');
    expect(PACKS['day-close'].startStage).toBe('Spoke with customer');
    expect(PACKS['day-close'].steps.map((s) => s.id)).toEqual(['note', 'task']);
    expect(PACKS['day-close'].noteToCopy).toBeUndefined();
    expect(PACKS['day-close'].audit).toBeUndefined();
  });

  it('keeps client cards and quiz in lockstep with the seed', async () => {
    const seed = await loadSeed();
    expect(seed.CARDS.map((c) => c.t)).toEqual(RECORD_IS_THE_JOB_CARDS.map((c) => c.t));
    expect(seed.QUESTIONS.map((q) => q.prompt)).toEqual(RECORD_IS_THE_JOB_QS.map((q) => q.prompt));
    expect(seed.QUESTIONS.map((q) => q.answer)).toEqual(RECORD_IS_THE_JOB_ANSWERS);
    expect(seed.QUESTIONS.map((q) => q.choices)).toEqual(RECORD_IS_THE_JOB_QS.map((q) => q.choices));
  });

  it('locks Kayla quiz choices verbatim — do not shorten', () => {
    expect(RECORD_IS_THE_JOB_ANSWERS).toEqual([1, 1, 2, 1, 2, 1, 1, 1, 2, 1]);
    expect(RECORD_IS_THE_JOB_QS[0].choices).toEqual([
      'When the call went well and they said they want to see homes',
      'When a date and time are on the calendar',
      'When you left a voicemail about a showing',
      'When they asked you to send times',
    ]);
    expect(RECORD_IS_THE_JOB_QS[1].choices).toEqual([
      'Note is the next step. Task is what already happened.',
      'Note is what happened. Task is what is next, with a date.',
      'Both are optional if the stage is right.',
      'The note can say “follow up later” instead of a task.',
    ]);
    expect(RECORD_IS_THE_JOB_QS[4].choices[2]).toBe(
      'Stage Attempted contact, a note that you called and left a VM, and a dated retry',
    );
    expect(RECORD_IS_THE_JOB_QS[6].choices[1]).toBe(
      'Records that do not match reality — empty notes, no next task, stages that lie',
    );
    expect(RECORD_IS_THE_JOB_QS[9].choices[1]).toBe(
      'An honest stage, a note from today, and one dated next task',
    );
  });
});
