import {describe,it,expect} from 'vitest';
import {stageEnvelope,retainStageEnvelope} from './stageEnvelope.js';
const payload=(eventId='one',stage='Nurture')=>({event:'peopleStageUpdated',eventId,eventCreated:'2026-09-12T01:00:00+00:00',resourceIds:[42],data:{stage}});
function store(){
 const rows=new Map<string,unknown>();
 const storage={transaction:async(fn:any)=>{const next=new Map(rows);await fn({get:async(k:string)=>next.get(k),put:async(k:string,v:unknown)=>{next.set(k,v);}});rows.clear();next.forEach((v,k)=>rows.set(k,v));}} as unknown as DurableObjectStorage;
 return {rows,storage};
}
describe('stage receipts survive notification coalescing',()=>{
 it('retains repeated transitions and deduplicates replay after restart',async()=>{
  const {rows,storage}=store();
  for(const p of [payload('3'),payload('1'),payload('2','Appointment'),payload('1')])await retainStageEnvelope(storage,stageEnvelope(p)!,'team','org');
  expect(rows.size).toBe(6);expect([...rows.entries()].filter(([k,v]:any)=>k.startsWith('stage-receipt:')&&v.stage==='Nurture')).toHaveLength(2);
 });
 it('fails closed on conflicting event identity without overwriting receipts',async()=>{
  const {rows,storage}=store();await retainStageEnvelope(storage,stageEnvelope(payload())!,'team','org');
  await expect(retainStageEnvelope(storage,stageEnvelope(payload('one','Closed'))!,'team','org')).rejects.toThrow('Conflicting');expect(rows.size).toBe(2);
 });
 it('requires event identity, offset, stage and numeric people',()=>{
  for(const patch of [{eventId:''},{eventCreated:'2026-01-01'},{resourceIds:['42&org=other']},{data:{stage:''}}])expect(()=>stageEnvelope({...payload(),...patch})).toThrow();
 });
 it('separates each person in batched notifications',async()=>{
  const {rows,storage}=store();await retainStageEnvelope(storage,stageEnvelope({...payload(),resourceIds:[42,43,42]})!,'team','org');expect(rows.size).toBe(4);
 });
});
