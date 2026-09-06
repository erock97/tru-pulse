import day1 from '../../public/workshops/day1.json';
import day2 from '../../public/workshops/day2.json';
import day3 from '../../public/workshops/day3.json';
import day4 from '../../public/workshops/day4.json';
import guide1 from '../../public/workshops/day1-guide.html?raw';
import guide2 from '../../public/workshops/day2-guide.html?raw';
import guide3 from '../../public/workshops/day3-guide.html?raw';
import guide4 from '../../public/workshops/day4-guide.html?raw';
import {describe,it,expect} from 'vitest';
import {workshopDay, type WorkshopData} from './types';
import {workshopQuestion} from './questionCopy';
import {allowedIndex} from './runtime';
import {OFFICIAL_TRAINING_CARDS} from '../lib/officialTraining';
import {WINNING_FIRST_CONVERSATION_QS,WINNING_FIRST_CONVERSATION_ANSWERS} from '../lib/winningFirstConversation';
import {SHOW_LIKE_A_PRO_QS,SHOW_LIKE_A_PRO_ANSWERS} from '../lib/showLikeAPro';
const data=(day:number)=>[day1,day2,day3,day4][day-1] as WorkshopData;
describe('Rep workshop integration',()=>{
 it('prevents agenda and keyboard jumps past unfinished record exercises',()=>{
   const slides=data(1).slides;const passed=new Set<number>();
   expect(allowedIndex(slides,passed,23,false)).toBe(12);
   passed.add(12);expect(allowedIndex(slides,passed,23,false)).toBe(14);
   expect(allowedIndex(slides,passed,3,false)).toBe(3);
   expect(allowedIndex(slides,passed,23,true)).toBe(23);
   slides.forEach((s,i)=>{if(s.native==='practice')passed.add(i);});
   expect(allowedIndex(slides,passed,23,false)).toBe(23);
 });
 it('preserves every existing Day 1 native exercise in order',()=>{
   expect(data(1).slides.filter(s=>s.native==='practice').map(s=>s.scenario)).toEqual(OFFICIAL_TRAINING_CARDS.filter(s=>s.t==='practice').map(s=>s.scenario));
   expect(data(1).slides.filter(s=>s.native==='deal')).toHaveLength(1);
   expect(data(1).slides).toHaveLength(24);
 });
 it('leaves unknown and custom modules in the existing player',()=>{
   expect(workshopDay({id:'custom',cards:[{deck:'custom-deck'}]})).toBeNull();
   expect(workshopDay({id:'a6666666-6666-6666-6666-666666666666'})).toBe(1);
 });
 it('keeps quiz identity and grading positions while removing conflicting legacy advice',()=>{
   for(const [day,qs,answers] of [[2,WINNING_FIRST_CONVERSATION_QS,WINNING_FIRST_CONVERSATION_ANSWERS],[3,SHOW_LIKE_A_PRO_QS,SHOW_LIKE_A_PRO_ANSWERS]] as const){
     for(const [i,q]of qs.entries()){
       const revised=workshopQuestion(q,day);
       expect(revised.id).toBe(q.id);expect(revised.idx).toBe(q.idx);
       expect(revised.choices).toHaveLength(q.choices.length);
       expect(revised.choices[answers[i]]).toBeTruthy();
     }
   }
   expect(workshopQuestion(WINNING_FIRST_CONVERSATION_QS[3],2).choices[1]).toMatch(/needs checking/);
   expect(workshopQuestion(WINNING_FIRST_CONVERSATION_QS[7],2).choices[1]).toMatch(/At least five/);
   expect(workshopQuestion(SHOW_LIKE_A_PRO_QS[0],3).choices[1]).toMatch(/Comparisons/);
 });
 it('does not rewrite an unrelated custom question with similar wording',()=>{
   const q=WINNING_FIRST_CONVERSATION_QS[3];expect(workshopQuestion(q,null)).toBe(q);
 });
 it('provides complete facilitator cues and practice cases for all workshops',()=>{
   for(let day=1;day<=4;day++){
     const d=data(day);expect(d.slides.length).toBeGreaterThan(10);
     for(const slide of d.slides){expect(slide.title).toBeTruthy();expect(slide.notes).toBeTruthy();expect(slide.cue).toBeTruthy();expect(slide.time).toBeGreaterThan(0);}
     expect(d.slides.some(s=>s.body.includes('data-save="recall'))).toBe(true);
     if(day===2||day===3)expect(d.cases).toHaveLength(3);
     expect([guide1,guide2,guide3,guide4][day-1]).toContain(d.title);
   }
 });
});
