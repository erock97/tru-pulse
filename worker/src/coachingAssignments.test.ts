import {beforeEach,describe,it,expect,vi} from 'vitest';
import {handleCoachingAssignments} from './coachingAssignments.js';
import type {Env} from './env.js';
import type {UserClient} from './asUser.js';
import {assignmentStatus,assignmentInput,assignmentAwaitingReview,type CoachingAssignment} from '../../shared/coachingAssignments.js';
const agentId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',moduleId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const records=new Map<string,unknown>();
const select=vi.fn(),rpc=vi.fn();
const put=vi.fn(async(k:string,v:string)=>{records.set(k,JSON.parse(v));});
const get=vi.fn(async(k:string)=>records.get(k)??null);
const list=vi.fn(async({prefix}:{prefix:string})=>({keys:[...records.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}));
const env={SESSIONS:{get,put,list}} as unknown as Env;
const db={userId:'coach',select,rpc} as unknown as UserClient;
let role='coach';let visible=true;let passed=false;
const call=(body?:unknown,originOk=true,agent=agentId,method=body?'POST':'GET')=>handleCoachingAssignments(new Request(`https://api.truhq.co/data/coaching-assignments?agentId=${agent}`,{method,...(body?{body:JSON.stringify(body)}:{})}),env,db,{},originOk);
const create=()=>call({action:'create',id,commitment:'Practice the first call opening.',dueDate:'2026-10-01',moduleId});
beforeEach(()=>{records.clear();vi.clearAllMocks();role='coach';visible=true;passed=false;db.userId='coach';rpc.mockResolvedValue({ok:true,data:false});select.mockImplementation(async(table:string)=>{
 if(table==='agents')return visible?[{id:agentId,org_id:'org-a',auth_id:'agent'}]:[];
 if(table==='memberships')return role?[{role}]:[];
 if(table==='rep_modules')return[{title:'First conversation'}];
 if(table==='rep_progress')return passed?[{module_id:moduleId,status:'passed',passed_at:null}]:[];
 return [];
});});
describe('coaching assignments',()=>{
 it('saves coach-authored work and derives training completion from the assigned agent’s results',async()=>{
  expect((await create()).status).toBe(200);passed=true;db.userId='agent';role='';
  const res=await call();expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  const data=await res.json() as {assignments:CoachingAssignment[];canAssign:boolean};expect(data.canAssign).toBe(false);expect(data.assignments[0].trainingPassed).toBe(true);expect(data.assignments[0].passedAt).toBeNull();
  expect(select).toHaveBeenCalledWith('rep_progress',expect.stringContaining(`agent_id=eq.${agentId}`),{strict:true});
 });
 it('rejects hidden agents before touching KV',async()=>{visible=false;expect((await call()).status).toBe(403);expect(get).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();});
 it('rejects a visible peer without a coaching role',async()=>{role='';db.userId='peer';expect((await call()).status).toBe(403);expect(list).not.toHaveBeenCalled();});
 it('allows the existing global-admin RPC after agent visibility succeeds',async()=>{role='';rpc.mockResolvedValue({ok:true,data:true});expect((await create()).status).toBe(200);});
 it('does not treat a failed admin lookup as authorization',async()=>{role='';rpc.mockResolvedValue({ok:false,data:null});expect((await create()).status).toBe(403);expect(put).not.toHaveBeenCalled();});
 it('prevents agents assigning or reviewing and coaches impersonating practice',async()=>{
  await create();expect((await call({action:'practice',id,reflection:'Example'})).status).toBe(403);
  db.userId='agent';role='';expect((await create()).status).toBe(403);expect((await call({action:'review',id,reviewNote:'Done',outcome:'complete'})).status).toBe(403);
 });
 it('preserves practice and review separately and returns the confirmed patch',async()=>{
  await create();db.userId='agent';role='';const practice=await call({action:'practice',id,reflection:'I rehearsed twice.'});expect(practice.status).toBe(200);expect(await practice.json()).toMatchObject({patch:{reflection:'I rehearsed twice.'}});
  db.userId='coach';role='coach';expect((await call({action:'review',id,reviewNote:'Use the same opening next week.',outcome:'continue',dueDate:'2026-10-08'})).status).toBe(200);
  const data=await(await call()).json() as {assignments:CoachingAssignment[]};expect(data.assignments[0]).toMatchObject({reflection:'I rehearsed twice.',reviewNote:'Use the same opening next week.',outcome:'continue',dueDate:'2026-10-08'});
 });
 it('closes work without forging a quiz pass and rejects later agent edits',async()=>{
  await create();await call({action:'review',id,reviewNote:'Reviewed at our meeting.',outcome:'complete'});
  db.userId='agent';role='';expect((await call({action:'practice',id,reflection:'Changed'})).status).toBe(409);
  const data=await(await call()).json() as {assignments:CoachingAssignment[]};expect(data.assignments[0].trainingPassed).toBe(false);
 });
 it('is idempotent for the same create and rejects a changed retry',async()=>{await create();await create();expect(put).toHaveBeenCalledTimes(1);expect((await call({action:'create',id,commitment:'Different',dueDate:'2026-10-01',moduleId})).status).toBe(409);});
 it('does not accept an unpublished or inaccessible module',async()=>{select.mockImplementation(async(t:string)=>t==='agents'?[{id:agentId,org_id:'org-a',auth_id:'agent'}]:t==='memberships'?[{role:'coach'}]:[]);expect((await create()).status).toBe(400);expect(put).not.toHaveBeenCalled();});
 it('does not leak mismatched stored records into another agent history',async()=>{await create();const key=[...records.keys()][0];records.set(key,{...(records.get(key) as object),orgId:'other-org'});expect(await(await call()).json()).toMatchObject({assignments:[]});expect((await call({action:'review',id,reviewNote:'x',outcome:'complete'})).status).toBe(404);});
 it('fails visibly when storage or source reads fail',async()=>{put.mockRejectedValueOnce(Error('offline'));expect((await create()).status).toBe(503);select.mockRejectedValueOnce(Error('offline'));expect((await call()).status).toBe(503);});
 it('rejects cross-origin writes, bad IDs, malformed fields and oversized bodies',async()=>{expect((await call({action:'create',id},false)).status).toBe(403);expect((await call(undefined,true,'bad')).status).toBe(400);expect((await call({action:'create',id,commitment:' ',dueDate:'2026-10-01'})).status).toBe(400);expect((await call({action:'create',id,commitment:'x'.repeat(9000)})).status).toBe(413);expect(put).not.toHaveBeenCalled();});
});
describe('assignment meaning',()=>{
 const base={outcome:null,moduleId,trainingPassed:false,practiceAt:null,reviewedAt:null} as CoachingAssignment;
 it('distinguishes practice from a real pass',()=>{expect(assignmentStatus({...base,practiceAt:'2026-09-01'})).toBe('Submitted for review · training still open');expect(assignmentStatus({...base,practiceAt:'2026-09-01',trainingPassed:true})).toBe('Submitted for coaching review');});
 it('requires a new practice note after a keep-practicing review',()=>{const a={...base,moduleId:null,outcome:'continue' as const,reviewedAt:'2026-09-02',practiceAt:'2026-09-01'};expect(assignmentStatus(a)).toBe('Keep practicing');expect(assignmentStatus({...a,practiceAt:'2026-09-03'})).toBe('Submitted for coaching review');});
 it('validates real calendar dates and bounded commitments',()=>{expect(()=>assignmentInput({commitment:'Try',dueDate:'2026-02-30'})).toThrow();expect(()=>assignmentInput({commitment:'x'.repeat(1201),dueDate:'2026-10-01'})).toThrow();expect(assignmentInput({commitment:' Try ',dueDate:'2026-10-01',moduleId:''})).toEqual({commitment:'Try',dueDate:'2026-10-01',moduleId:null});});
});


describe('practice and review retries',()=>{
 it('keeps the original submission date on an identical retry, but accepts new practice after continue',async()=>{
  await create();db.userId='agent';role='';
  const submit={action:'practice',id,reflection:'Rehearsed the opening.'};
  const first=await(await call(submit)).json();
  expect(await(await call(submit)).json()).toEqual(first);
  expect(put).toHaveBeenCalledTimes(2);
  db.userId='coach';role='coach';
  await call({action:'review',id,reviewNote:'Practice again before we meet.',outcome:'continue',dueDate:'2026-10-08'});
  await call({action:'review',id,reviewNote:'Practice again before we meet.',outcome:'continue',dueDate:'2026-10-08'});
  db.userId='agent';role='';await call(submit);
  const data=await(await call()).json() as {assignments:CoachingAssignment[]};
  expect(assignmentAwaitingReview(data.assignments[0])).toBe(true);
  expect(data.assignments[0].dueDate).toBe('2026-10-08');
  db.userId='coach';role='coach';
  await call({action:'review',id,reviewNote:'Reviewed the new practice.',outcome:'complete'});
  const finished=await(await call()).json() as {assignments:CoachingAssignment[]};
  expect(finished.assignments[0].dueDate).toBe('2026-10-08');
  expect(assignmentAwaitingReview(finished.assignments[0])).toBe(false);
  expect(finished.assignments[0].history?.map(e=>e.kind)).toEqual(['practice','review','practice','review']);
  expect(finished.assignments[0].history?.[1]).toMatchObject({kind:'review',previousDueDate:'2026-10-01',dueDate:'2026-10-08'});
  expect(finished.assignments[0].history?.[3]).toMatchObject({kind:'review',previousDueDate:'2026-10-08',dueDate:'2026-10-08'});
  expect(finished.assignments[0].historyIncomplete).toBe(false);
 });
 it('keeps the original review date on retry and prevents reopening finished work',async()=>{
  await create();const review={action:'review',id,reviewNote:'Reviewed together.',outcome:'complete'};
  const first=await(await call(review)).json();
  expect(await(await call(review)).json()).toEqual(first);expect(put).toHaveBeenCalledTimes(2);
  expect((await(await call()).json() as {assignments:CoachingAssignment[]}).assignments[0].history).toHaveLength(1);
  expect((await call({...review,outcome:'continue',dueDate:'2026-10-09'})).status).toBe(409);
 });
 it('does not hide an unpassed training submission from the review queue',()=>{
  const a={outcome:null,practiceAt:'2026-09-04',reviewedAt:null,moduleId,trainingPassed:false} as CoachingAssignment;
  expect(assignmentAwaitingReview(a)).toBe(true);
  expect(assignmentAwaitingReview({...a,outcome:'complete'})).toBe(false);
  expect(assignmentAwaitingReview({...a,outcome:'continue',reviewedAt:'2026-09-05'})).toBe(false);
 });
 it('preserves new attempts without inventing history for legacy latest notes',async()=>{
  await create();
  records.set(`coaching-practice:v1:org-a:${agentId}:${id}`,{practiceAt:'2026-09-01T10:00:00.000Z',reflection:'An older practice note.'});
  const legacy=await(await call()).json() as {assignments:CoachingAssignment[]};
  expect(legacy.assignments[0].history).toEqual([]);expect(legacy.assignments[0].historyIncomplete).toBe(true);
  db.userId='agent';role='';
  await call({action:'practice',id,reflection:'A new attempt.'});
  await call({action:'practice',id,reflection:'A different attempt.'});
  const saved=await(await call()).json() as {assignments:CoachingAssignment[]};
  expect(saved.assignments[0].history?.map(e=>e.kind==='practice'?e.reflection:'')).toEqual(['A new attempt.','A different attempt.']);
  expect(saved.assignments[0].historyIncomplete).toBe(true);
 });
});
