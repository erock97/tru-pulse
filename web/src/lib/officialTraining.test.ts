import { describe, expect, it } from 'vitest';
import {
  canOpenModule,
  courseQuestionsFor,
  withOpenableOfficialTraining,
} from './agentHq';
import type { CourseModule } from './api';
import { demoCatalogTitles } from './api';
import {
  OFFICIAL_TRAINING_ANSWERS,
  OFFICIAL_TRAINING_ID,
  OFFICIAL_TRAINING_PASS_PCT,
  OFFICIAL_TRAINING_QS,
  OFFICIAL_TRAINING_TITLE,
  scoreOfficialTraining,
} from './officialTraining';

function officialStub(over: Partial<CourseModule> = {}): CourseModule {
  return {
    id: OFFICIAL_TRAINING_ID,
    idx: 1,
    title: OFFICIAL_TRAINING_TITLE,
    summary: null,
    body: null,
    pass_pct: OFFICIAL_TRAINING_PASS_PCT,
    questions: 0,
    status: 'not_started',
    score: null,
    passed_at: null,
    signed: false,
    cards: [],
    qs: [],
    ...over,
  };
}

describe('Official Training Day 1 quiz', () => {
  it('ships ten questions and an 80% pass bar', () => {
    expect(OFFICIAL_TRAINING_QS).toHaveLength(10);
    expect(OFFICIAL_TRAINING_ANSWERS).toHaveLength(10);
    expect(OFFICIAL_TRAINING_PASS_PCT).toBe(80);
    expect(OFFICIAL_TRAINING_QS.every((q) => q.prompt.trim() && q.choices.length >= 2)).toBe(true);
  });

  it('still opens Official Training when the live row has empty qs', () => {
    expect(canOpenModule({
      id: OFFICIAL_TRAINING_ID,
      title: OFFICIAL_TRAINING_TITLE,
      qs: [],
      cards: [],
    })).toBe(true);
  });

  it('attaches the in-repo quiz when live qs is empty — same fallback as cards', () => {
    expect(courseQuestionsFor({ id: OFFICIAL_TRAINING_ID, qs: [] })).toEqual(OFFICIAL_TRAINING_QS);
    const [filled] = withOpenableOfficialTraining([officialStub()]);
    expect(filled.qs).toEqual(OFFICIAL_TRAINING_QS);
    expect(filled.questions).toBe(10);
    expect(filled.pass_pct).toBe(80);
  });

  it('leaves a live quiz alone when the row already has questions', () => {
    const live = [{ id: 'live-q1', idx: 1, prompt: 'Live prompt', choices: ['A', 'B'] }];
    expect(courseQuestionsFor({ id: OFFICIAL_TRAINING_ID, qs: live })).toEqual(live);
  });

  it('passes at 8/10 and fails at 7/10', () => {
    const pass = scoreOfficialTraining(OFFICIAL_TRAINING_ANSWERS.map((a, i) => (i < 8 ? a : a === 0 ? 1 : 0)));
    expect(pass.correct).toBe(8);
    expect(pass.total).toBe(10);
    expect(pass.score).toBe(80);
    expect(pass.passed).toBe(true);

    const fail = scoreOfficialTraining(OFFICIAL_TRAINING_ANSWERS.map((a, i) => (i < 7 ? a : a === 0 ? 1 : 0)));
    expect(fail.correct).toBe(7);
    expect(fail.score).toBe(70);
    expect(fail.passed).toBe(false);
  });

  it('asks about stages, notes, tasks, People, and the four checks — not Day 2/3', () => {
    const blob = OFFICIAL_TRAINING_QS.map((q) => `${q.prompt} ${q.choices.join(' ')}`).join('\n');
    expect(blob).toMatch(/People|stage|note|task|four checks|Avery|record/i);
    expect(blob).not.toMatch(/LEAD is the whole first call|touring agreement/i);
    expect(demoCatalogTitles()).toContain(OFFICIAL_TRAINING_TITLE);
  });
});
