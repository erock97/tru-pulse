import {describe,it,expect} from 'vitest';
import {coachingDue} from './todayActions';
describe('coaching cadence actions',()=>{
  it('retains old check-ins including the legacy 99-day sentinel value',()=>{
    const people=[{lastDays:99,hasRecordedCheckin:true},{lastDays:140,hasRecordedCheckin:true},{lastDays:99,hasRecordedCheckin:false}];
    expect(coachingDue(people,14).map(a=>a.lastDays)).toEqual([140,99]);
  });
  it('uses the saved cadence boundary and excludes unknown history',()=>{
    expect(coachingDue([{lastDays:13,hasRecordedCheckin:true},{lastDays:14,hasRecordedCheckin:true},{lastDays:80}],14)).toEqual([{lastDays:14,hasRecordedCheckin:true}]);
  });
});
