import {it,expect} from 'vitest';
import {pauseRecommendation as pause} from './pauseRecommendation';
it('recommends a pause at the cap despite excellent conversion',()=>expect(pause({leads:30,perContract:10},30,15,15)).toContain('Monthly cap reached: 15/15'));
it('evaluates conversion before display rounding',()=>expect(pause({leads:301,perContract:30.1},30,null,15)).toContain('Conversion below minimum'));
it('includes both triggers',()=>{const result=pause({leads:34,perContract:34},30,16,15);expect(result).toContain('Monthly cap reached');expect(result).toContain('Conversion below minimum');});
it('does not equate missing data with a triggered threshold',()=>{expect(pause(undefined,30,null,15)).toBeNull();expect(pause({leads:0,perContract:null},30,null,15)).toBeNull();expect(pause({leads:30,perContract:30},30,14,15)).toBeNull();});
it('handles known zero-contract counts and unloaded settings',()=>{expect(pause({leads:5,perContract:null},30,null,15)).toContain('0 for 5');expect(pause({leads:5,perContract:null},null,null,null)).toBeNull();});
