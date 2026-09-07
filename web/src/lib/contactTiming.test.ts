import {describe,it,expect} from 'vitest';
import {contactTimingSummary,elapsedContact} from './contactTiming';
import type {ContactAgentResult} from '../../../shared/contactSpeed';
const agent=(times:number[],total=times.length)=>({averageSeconds:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,responseCount:times.length,averageIsUpperBound:true,total,measured:0,results:times.map(seconds=>({seconds,first:{},status:'response_recorded'}))}) as ContactAgentResult;
describe('collapsed contact times',()=>{
 it('shows the single verified bound without opening the row',()=>expect(contactTimingSummary(agent([39]))).toBe('Within 39s average · 1/1 leads'));
 it('shows every available bound and the coverage, not just the fastest',()=>expect(contactTimingSummary(agent([60,120],3))).toBe('Within 1m 30s average · 2/3 leads'));
 it('labels exact averages and their denominator',()=>expect(contactTimingSummary({...agent([39],4),averageSeconds:39,measured:1,averageIsUpperBound:false,responseCount:1})).toBe('39s average · 1/4 leads'));
 it('does not invent a time for missing evidence',()=>expect(contactTimingSummary(agent([],4))).toBe('See contact findings'));
 it('retains seconds consistently without understating bounds',()=>{expect(elapsedContact(3599,true)).toBe('59m 59s');expect(elapsedContact(39.1,true)).toBe('40s');expect(elapsedContact(0)).toBe('0s');});
});
