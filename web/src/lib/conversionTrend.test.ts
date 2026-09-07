import {describe,it,expect} from 'vitest';
import {conversionTrend} from './conversionTrend';
import type {LeadRow} from './api';
const now=new Date('2026-09-06T12:00:00Z');
const history={through:'2026-09-05',capturedAt:'2026-09-06',sourceStarts:{Zillow:'2026-01-01'},rosterPolicy:'current'};
const event=(date:string)=>({date,eventId:'1',description:'Stage changed',kind:'observed',basis:'observed',direction:'to'});
const lead=(created:string,uc?:string,closed?:string):LeadRow=>({team_id:'team',assigned_to:'Agent',source_family:'Zillow',flag:null,fub_created:created,history:{uc:uc?event(uc):null,closed:closed?event(closed):null}});
describe('dated conversion trend',()=>{
 it('recognizes the first contract as improvement from zero for fifteen',()=>{
  const leads=Array.from({length:15},(_,i)=>lead('2026-02-01',i===0?'2026-07-01':undefined,i===0?'2026-08-01':undefined));
  const trend=conversionTrend(leads,{leads:15,contracts:1,perContract:15},90,history,now);
  expect(trend.prior).toEqual({leads:15,contracts:0,perContract:null});
  expect(trend.direction).toBe('Improving');
 });
 it('changes the earlier counts when Coach changes the comparison period',()=>{
  const leads=[lead('2026-02-01','2026-07-01'),lead('2026-08-01')];
  const current={leads:2,contracts:1,perContract:2};
  expect(conversionTrend(leads,current,90,history,now).direction).toBe('Improving');
  expect(conversionTrend(leads,current,14,history,now).direction).toBe('Unchanged');
 });
 it('excludes later leads, counts UC and closing once, and detects deterioration',()=>{
  const leads=[lead('2026-02-01','2026-03-01','2026-04-01'),lead('2026-08-01')];
  const trend=conversionTrend(leads,{leads:2,contracts:1,perContract:2},90,history,now);
  expect(trend.prior).toEqual({leads:1,contracts:1,perContract:1});
  expect(trend.direction).toBe('Declining');
 });
 it('counts an observed closing as contract evidence without double counting',()=>{
  const trend=conversionTrend([lead('2026-02-01',undefined,'2026-07-01')],{leads:1,contracts:1,perContract:1},90,history,now);
  expect(trend.direction).toBe('Improving');
 });
 it('does not invent a baseline outside coverage or from an undated milestone',()=>{
  expect(conversionTrend([lead('2026-02-01')],{leads:1,contracts:0,perContract:null},365,history,now).prior).toBeNull();
  expect(conversionTrend([lead('2026-02-01','bad-date')],{leads:1,contracts:1,perContract:1},90,history,now).prior).toBeNull();
 });
});

it('refuses a comparison whose current and historical cohorts differ',()=>{
 expect(conversionTrend([lead('2026-02-01')],{leads:2,contracts:1,perContract:2},90,history,now).prior).toBeNull();
});
it('counts transferred leads under the current owner consistently, rather than treating an event actor as the owner',()=>{
 const transferred={...lead('2026-02-01','2026-07-01'),assigned_to:'Current owner',history:{uc:{...event('2026-07-01'),description:'Stage changed by another agent'}}};
 const result=conversionTrend([transferred],{leads:1,contracts:1,perContract:1},90,history,now);
 expect(result.prior?.contracts).toBe(0);expect(result.direction).toBe('Improving');
});
it('retains zero contracts as an unchanged zero rate even as lead volume grows',()=>{
 const result=conversionTrend([lead('2026-02-01'),lead('2026-08-01')],{leads:2,contracts:0,perContract:null},90,history,now);
 expect(result.prior).toEqual({leads:1,contracts:0,perContract:null});expect(result.direction).toBe('Unchanged');
});
