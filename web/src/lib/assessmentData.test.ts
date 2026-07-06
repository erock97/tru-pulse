import { expect, test } from 'vitest';
import { scorePersonal, scorePro, PERSONAL_QUESTIONS, PRO_QUESTIONS, divergence, ARCH, PERSONAL_TYPES } from './assessmentData';

test('20 personal + 32 pro questions, 5/8 per axis', () => {
  expect(PERSONAL_QUESTIONS).toHaveLength(20);
  expect(PRO_QUESTIONS).toHaveLength(32);
  for (const ax of ['energy','approach','deal','decision'] as const) {
    expect(PERSONAL_QUESTIONS.filter(q => q.axis === ax)).toHaveLength(5);
    expect(PRO_QUESTIONS.filter(q => q.dim === ax)).toHaveLength(8);
  }
});

test('scorePersonal: all-max toward first pole gives that letter at 100%', () => {
  // answer +3 to every statement; letters mix by keys, so score net respects q.keys direction
  const ans = PERSONAL_QUESTIONS.map(() => 3);
  const r = scorePersonal(ans);
  expect(r.axes.energy.pct).toBe(100);
  expect(typeof r.code).toBe('string');
  expect(r.code.split('-')).toHaveLength(4);
});

test('scorePro: alternating slider indices yield a 4-letter code and 50-100 pct', () => {
  const ans = PRO_QUESTIONS.map((_, i) => (i % 2 === 0 ? 0 : 5));
  const r = scorePro(ans);
  expect(r.code.split('-')).toHaveLength(4);
  for (const ax of ['energy','approach','deal','decision'] as const) {
    expect(r.axes[ax].pct).toBeGreaterThanOrEqual(50);
    expect(r.axes[ax].pct).toBeLessThanOrEqual(100);
  }
});

test('every code maps to an ARCH and a PERSONAL_TYPE', () => {
  const poles = { energy:['P','T'], approach:['Pro','Rec'], deal:['R','V'], decision:['D','I'] } as const;
  for (const e of poles.energy) for (const a of poles.approach) for (const d of poles.deal) for (const de of poles.decision) {
    const code = `${e}-${a}-${d}-${de}`;
    expect(ARCH[code], `ARCH ${code}`).toBeTruthy();
    expect(PERSONAL_TYPES[code], `PERSONAL_TYPES ${code}`).toBeTruthy();
  }
});

test('no name collision between personal and professional sets', () => {
  const proNames = new Set(Object.values(ARCH).map(a => a.name));
  for (const p of Object.values(PERSONAL_TYPES)) {
    expect(proNames.has(p.name), `collision: ${p.name}`).toBe(false);
  }
});

test('divergence flags axes where personal and pro letters differ', () => {
  const personal = scorePersonal(PERSONAL_QUESTIONS.map(() => 3));
  const pro = scorePro(PRO_QUESTIONS.map(() => 0));
  expect(Array.isArray(divergence(personal, pro))).toBe(true);
});
