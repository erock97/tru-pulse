import {it,expect} from 'vitest';
import {hasContractMilestone,rawConversionPercent} from './conversionMilestones';
it('counts under contract and closed once each, including a later return to nurture',()=>{
  const leads=[{stage:'Nurture',history:{uc:{},closed:{}}},{history:{closed:{}}},{history:{uc:{}}},{history:{offer:{}}}];
  const converted=leads.filter(hasContractMilestone).length;
  expect(converted).toBe(3);expect(rawConversionPercent(converted,leads.length)).toBe(75);
});
it('uses current stage only when historical evidence is absent',()=>{
  expect(hasContractMilestone({stage:'Pending'})).toBe(true);
  expect(hasContractMilestone({stage:'Closed'})).toBe(true);
  expect(hasContractMilestone({stage:'Lead'})).toBe(false);
  expect(hasContractMilestone({stage:'Closed',history:{}})).toBe(false);
  expect(rawConversionPercent(0,0)).toBeNull();
});
