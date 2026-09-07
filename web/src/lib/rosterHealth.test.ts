import {it,expect} from 'vitest';
import {healthOf} from './rosterData';
it('does not mistake known zero-contract leads for zero volume',()=>{
 expect(healthOf(null,null,30,0)).toBe('no-volume');
 expect(healthOf(null,20,30,5)).toBe('past-line');
 expect(healthOf(null,20,30,30)).toBe('past-line');
 expect(healthOf(30,30,30,60)).toBe('holding');
 expect(healthOf(30.5,30,30,61)).toBe('past-line');
});
