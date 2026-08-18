import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_TRAINING_ID,
  officialTrainingGradeQuestions,
  scoreOfficialTraining,
} from '../../shared/officialTrainingQuiz.js';

describe('Official Training /rep/grade fallback', () => {
  it('uses the in-repo ten answers when the live question list is empty', () => {
    const qs = officialTrainingGradeQuestions(OFFICIAL_TRAINING_ID, []);
    expect(qs).toHaveLength(10);
    expect(qs.every((q) => typeof q.answer === 'number')).toBe(true);

    const key = qs.map((q) => q.answer);
    const pass = scoreOfficialTraining(key.map((a, i) => (i < 8 ? a : a === 0 ? 1 : 0)));
    expect(pass.passed).toBe(true);
    const fail = scoreOfficialTraining(key.map((a, i) => (i < 7 ? a : a === 0 ? 1 : 0)));
    expect(fail.passed).toBe(false);
  });

  it('does not replace a live quiz that already has rows', () => {
    const live = [{ idx: 1, answer: 0, explain: 'live' }];
    expect(officialTrainingGradeQuestions(OFFICIAL_TRAINING_ID, live)).toEqual(live);
  });

  it('does not invent a quiz for any other module', () => {
    expect(officialTrainingGradeQuestions('aaaaaaaa-1111-4111-8111-111111111111', [])).toEqual([]);
  });
});
