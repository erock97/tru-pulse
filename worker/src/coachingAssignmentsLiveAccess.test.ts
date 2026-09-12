import {beforeEach,describe,it,expect,vi} from 'vitest';
import {handleCoachingAssignments} from './coachingAssignments.js';
import type {Env} from './env.js';
import type {UserClient} from './asUser.js';
const service=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./db.js',()=>({db:()=>service}));
const agentId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const select=vi.fn(),rpc=vi.fn(),get=vi.fn(),put=vi.fn(),list=vi.fn();
const env={REP_LIVE_SESSIONS:'1',SESSIONS:{get,put,list}} as unknown as Env;
const user={userId:'global-admin',select,rpc} as unknown as UserClient;
const record={id,agentId,sessionId,coachId:user.userId,dueDate:'2026-10-01',createdAt:'2026-09-12T00:00:00Z',reflection:'Saved practice'};
const call=(body?:unknown)=>handleCoachingAssignments(new Request(`https://api.truhq.co/data/coaching-assignments?agentId=${agentId}`,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),env,user,{},true);
beforeEach(()=>{
 vi.clearAllMocks();env.REP_LIVE_SESSIONS='1';
 rpc.mockResolvedValue({ok:true,data:true});service.rpc.mockResolvedValue({ok:true,patch:{id,reviewNote:'Observed the correction'}});
 select.mockImplementation(async(table:string,query:string)=>table==='rep_live_followups'?(query.includes('session_id')?[{id,session_id:sessionId}]:[{id,record}]):[]);
});
describe('live follow-up access when production agent RLS hides a global admin',()=>{
 it('reads only authorized durable assignments and offers review without legacy creation',async()=>{
  const result=await call();expect(result.status).toBe(200);
  expect(await result.json()).toEqual({assignments:[record],canAssign:false,canReview:true});
  expect(select).toHaveBeenCalledWith('rep_live_followups',`select=id,record&agent_id=eq.${agentId}`,{strict:true});
  expect(get).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
 it('reviews through live row RLS and the named-coach transaction',async()=>{
  const body={action:'review',id,reviewNote:'Observed the correction',outcome:'complete',applicationObserved:true};
  expect((await call(body)).status).toBe(200);
  expect(service.rpc).toHaveBeenCalledWith('rep_live_mutate',{p_actor:user.userId,p_session:sessionId,p_action:'followup',p_body:body});
  expect(get).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
 it('does not fall through to legacy storage for an unknown or inaccessible live assignment',async()=>{
  select.mockResolvedValue([]);
  expect((await call({action:'review',id,reviewNote:'x',outcome:'complete'})).status).toBe(404);
  expect(service.rpc).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
 it('does not create legacy assignments or impersonate learner practice',async()=>{
  expect((await call({action:'create',id})).status).toBe(403);
  expect((await call({action:'practice',id,reflection:'x'})).status).toBe(403);
  expect(service.rpc).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
 it('denies non-admins and keeps the feature flag boundary intact',async()=>{
  rpc.mockResolvedValue({ok:true,data:false});expect((await call()).status).toBe(403);
  expect(select).not.toHaveBeenCalledWith('rep_live_followups',expect.anything(),expect.anything());
  rpc.mockResolvedValue({ok:false,data:null});expect((await call()).status).toBe(403);
  env.REP_LIVE_SESSIONS='0';rpc.mockResolvedValue({ok:true,data:true});expect((await call()).status).toBe(403);
  expect(get).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
 });
 it('bounds review bodies and surfaces source errors without silently dropping assignments',async()=>{
  expect((await call({action:'review',id,reviewNote:'x'.repeat(9000)})).status).toBe(413);
  select.mockImplementation(async(table:string)=>{if(table==='rep_live_followups')throw Error('offline');return [];});
  expect((await call()).status).toBe(503);expect(service.rpc).not.toHaveBeenCalled();
 });
});
