import {describe, expect, it} from 'vitest';
import {practiceAgenda, localDay} from './practiceAgenda';
import type {CoachingAssignment} from './coachingAssignments';
const action = (id:string, patch:Partial<CoachingAssignment> = {}):CoachingAssignment => ({
  id,agentId:'a',orgId:'o',createdBy:'c',createdAt:'2026-09-01T12:00:00Z',commitment:'Practice',
  moduleId:'m',moduleTitle:'Lesson',dueDate:'2026-09-07',practiceAt:null,reflection:'',reviewedAt:null,
  reviewNote:'',outcome:null,passedAt:null,trainingPassed:false,...patch,
});
describe('practice agenda',()=>{
  it('prioritizes submitted practice without requiring a quiz pass and avoids duplicate overdue rows',()=>{
    const result=practiceAgenda([action('submitted',{practiceAt:'2026-09-06T12:00:00Z'}),action('late')],'2026-09-08');
    expect(result.toReview.map(a=>a.id)).toEqual(['submitted']);
    expect(result.overdue.map(a=>a.id)).toEqual(['late']);
  });
  it('keeps reviewed attempts out until resubmitted, excluding closed and undated follow-ups',()=>{
    const result=practiceAgenda([
      action('continued',{outcome:'continue',practiceAt:'2026-09-04T12:00:00Z',reviewedAt:'2026-09-05T12:00:00Z'}),
      action('again',{outcome:'continue',practiceAt:'2026-09-06T12:00:00Z',reviewedAt:'2026-09-05T12:00:00Z'}),
      action('closed',{outcome:'complete',practiceAt:'2026-09-06T12:00:00Z'}),action('unknown',{dueDate:''}),
      action('today',{dueDate:'2026-09-08'}),
    ],'2026-09-08');
    expect(result.toReview.map(a=>a.id)).toEqual(['again']);
    expect(result.overdue.map(a=>a.id)).toEqual(['continued']);
  });
  it('sorts oldest agreed date first and formats browser-local dates without UTC shifts',()=>{
    expect(practiceAgenda([action('later',{dueDate:'2026-09-07'}),action('first',{dueDate:'2026-09-02'})],'2026-09-08').overdue.map(a=>a.id)).toEqual(['first','later']);
    expect(localDay(new Date(2026,8,8,23,59))).toBe('2026-09-08');
  });
});
