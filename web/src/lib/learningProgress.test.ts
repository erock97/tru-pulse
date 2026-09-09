import { describe, expect, it } from 'vitest';
import { isLearningCertified, learningTitle } from './learningProgress';

describe('certification evidence', () => {
  it('does not certify quiz passes without a simulation and leader sign-off', () => {
    expect(isLearningCertified([{status:'passed',signed:false}], false)).toBe(false);
    expect(isLearningCertified([{status:'passed',signed:false}], true)).toBe(false);
    expect(isLearningCertified([{status:'passed',signed:true}], false)).toBe(false);
  });
  it('requires every current module, including newly added modules', () => {
    expect(isLearningCertified([{status:'passed',signed:true},{status:'not_started',signed:false}], true)).toBe(false);
    expect(isLearningCertified([], true)).toBe(false);
  });
  it('certifies when all three requirements have recorded evidence', () => {
    expect(isLearningCertified([{status:'passed',signed:true},{status:'passed',signed:true}], true)).toBe(true);
  });
});

describe('lesson display titles', () => {
  it('resolves the known Day 1 module without guessing from generic text', () => {
    expect(learningTitle({id:'a6666666-6666-6666-6666-666666666666',title:'Official Training'})).toBe('Welcome to Zillow Preferred');
    expect(learningTitle({id:'custom',title:'Official Training'})).toBe('Official Training');
    expect(learningTitle({id:'custom',title:'Team orientation'})).toBe('Team orientation');
  });
});
