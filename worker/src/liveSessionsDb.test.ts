import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {submitLiveAttempt} from './liveSessions.js';
import type {Db} from './db.js';
import {getWorkshopDefinition} from '../../shared/workshopCatalog.js';
let pg:PGlite;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),coachA=id(2),coachB=id(3),userA=id(4),userB=id(5),stranger=id(6),orgA=id(10),orgB=id(11),teamA=id(20),teamB=id(21),agentA=id(30),agentB=id(31),session=id(40);
const definition=getWorkshopDefinition(1)!;
const act=definition.activities.find(a=>a.scenario==='set-appointment')!.id;
async function mutate(actor:string,action:string,body:unknown={},sid=session){return (await pg.query<{result:any}>('select rep_live_mutate($1,$2,$3,$4::jsonb) result',[actor,sid,action,JSON.stringify(body)])).rows[0].result;}
async function read(actor:string){return(await pg.query<{result:any}>('select rep_live_read($1,$2) result',[actor,session])).rows[0].result;}
beforeAll(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table orgs(id uuid primary key);create table teams(id uuid primary key,org_id uuid references orgs(id),name text,is_active boolean default true);
 create table agents(id uuid primary key,org_id uuid references orgs(id),team_id uuid references teams(id),name text,email text,auth_id uuid references auth.users(id));
 create table admins(id uuid primary key references auth.users(id));create table memberships(org_id uuid,user_id uuid,role text);
 create table coach_teams(org_id uuid,user_id uuid,team_id uuid);`);
 await pg.exec(readFileSync(new URL('../../db/hq_rep_live.sql',import.meta.url),'utf8'));
 await pg.exec(`insert into auth.users(id,email) select x::uuid,x||'@example.test' from unnest(array['${admin}','${coachA}','${coachB}','${userA}','${userB}','${stranger}']) x;
 insert into admins values('${admin}');insert into orgs values('${orgA}'),('${orgB}');
 insert into teams values('${teamA}','${orgA}','A',true),('${teamB}','${orgB}','B',true);
 insert into agents values('${agentA}','${orgA}','${teamA}','Learner A','a@example.test','${userA}'),('${agentB}','${orgB}','${teamB}','Learner B','b@example.test','${userB}');
 insert into memberships values('${orgA}','${coachA}','leader'),('${orgB}','${coachB}','leader');`);
},30000);
afterAll(async()=>{await pg?.close();});
describe('durable live session transactions and access',()=>{
 it('only global admin creates a mixed team session and coaches must match their team',async()=>{
  const body={definition,timezone:'America/Los_Angeles',participants:[{agentId:agentA,coachId:coachA},{agentId:agentB,coachId:coachB}],presenterIds:[coachA]};
  await expect(mutate(coachA,'create',body)).rejects.toThrow('global administrator');
  await expect(mutate(admin,'create',{...body,participants:[{agentId:agentA,coachId:coachB}]})).rejects.toThrow('authorized coach');
  expect(await mutate(admin,'create',body)).toMatchObject({ok:true,id:session});
  expect(await mutate(admin,'create',body)).toMatchObject({ok:true});
  expect((await read(admin)).session.definition.version).toBe(definition.version);
 });
 it('membership link alone grants no access; presenter sees only their team',async()=>{
  await expect(read(stranger)).rejects.toThrow('Session unavailable');
  const state=await read(coachA);expect(state.participants.map((p:any)=>p.agentId)).toEqual([agentA]);
  expect((await read(userA)).participants.map((p:any)=>p.agentId)).toEqual([agentA]);
 });
 it('a rostered learner can join with their authenticated identity',async()=>{
  expect(await mutate(userA,'join')).toMatchObject({ok:true});
  expect((await read(userA)).participants[0].joinedAt).toBeTruthy();
 });
 it('presenter advancement keeps earlier activities open and metadata cannot carry drafts',async()=>{
  await mutate(admin,'open',{activityId:act});
  await expect(mutate(userA,'progress',{activityId:act,status:'working',response:'private draft'})).rejects.toThrow('must not contain response');
  await mutate(userA,'progress',{activityId:act,status:'working',help:'finding-control',actions:['stage-saved'],dirty:true});
  await mutate(admin,'slide',{slideId:definition.slides.at(-1)!.id});
  expect((await read(userA)).session.opened_activity_ids).toContain(act);
  expect((await read(coachA)).progress[0].help).toBe('finding-control');
  await mutate(userA,'progress',{activityId:act,help:null});
  const progress=(await read(coachA)).progress[0];expect(progress.actions).toEqual(['stage-saved']);expect(progress.dirty).toBe(true);expect(progress.help_resolved_count).toBe(1);
 });
 it('submissions are immutable, duplicate safe, and preserve independent and assisted attempts',async()=>{
  const first={id:id(51),activityId:act,response:{submission:{stage:'Appointment Set',stageSaved:true}},grade:{passed:true}};
  const result=await mutate(userA,'submit',first);expect(result.attempt.assisted).toBe(false);expect(result.attempt.attempt).toBe(1);
  expect((await mutate(userA,'submit',first)).attempt.id).toBe(id(51));
  await expect(mutate(userB,'submit',first)).rejects.toThrow('already used');
  await mutate(admin,'reveal',{activityId:act});
  expect((await mutate(userA,'submit',{...first,id:id(52)})).attempt.assisted).toBe(true);
  expect((await read(userA)).attempts).toHaveLength(2);
  expect((await read(userB)).attempts).toHaveLength(0);
 });
 it('repair cannot bypass diagnosis, and audit does not mark activity submitted',async()=>{
  const repair=definition.activities.find(a=>a.scenario==='avery-repair')!.id;
  await mutate(admin,'open',{activityId:repair});
  const body={id:id(53),activityId:repair,response:{submission:{stage:'Met with customer'}},grade:{passed:true}};
  await expect(mutate(userA,'submit',body)).rejects.toThrow('diagnosis');
  await mutate(userA,'submit',{...body,id:id(54),response:{submission:{phase:'audit',faults:['a']}},grade:{passed:true}});
  expect((await read(userA)).progress.find((p:any)=>p.activity_id===repair).status).toBe('working');
  await mutate(userA,'submit',body);
 });
 it('RLS prevents raw snapshot access and filters direct attempt reads',async()=>{
  await pg.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${userB}',false);`);
  try{
   expect((await pg.query('select * from rep_live_attempts')).rows).toHaveLength(0);
   await expect(pg.query('select * from rep_live_sessions')).rejects.toThrow('permission denied');
   await expect(pg.query('select rep_live_mutate($1,$2,$3,$4)',[userB,session,'end','{}'])).rejects.toThrow('permission denied');
  }finally{await pg.exec('reset role');}
 });
 it('end generates exactly 1/3/7 day followups and still accepts catchup without certification',async()=>{
  await mutate(admin,'end');await mutate(admin,'end');
  expect((await read(admin)).followups).toHaveLength(6);
  expect((await read(userA)).followups.map((f:any)=>f.checkpoint).sort()).toEqual([1,3,7]);
  await mutate(userA,'submit',{id:id(55),activityId:act,response:{submission:{stage:'Appointment Set'}},grade:{passed:false}});
  expect((await read(userA)).session.status).toBe('ended');
 });
 it('followup practice belongs to learner, review to named coach, and remains distinct from certification',async()=>{
  const assignment=(await read(userA)).followups[0];
  await expect(mutate(coachA,'followup',{id:assignment.id,action:'practice',reflection:'Tried'})).rejects.toThrow('assigned learner');
  await mutate(userA,'followup',{id:assignment.id,action:'practice',reflection:'Tried a fresh case'});
  await expect(mutate(userA,'followup',{id:assignment.id,action:'review',outcome:'complete',reviewNote:'Ready'})).rejects.toThrow('Named coach');
  await mutate(coachA,'followup',{id:assignment.id,action:'review',outcome:'complete',reviewNote:'Observed the correction',applicationObserved:true});
  const done=(await read(userA)).followups.find((f:any)=>f.id===assignment.id);
  await mutate(coachA,'followup',{id:assignment.id,action:'review',outcome:'complete',reviewNote:'Observed the correction',applicationObserved:true});
  const other=(await read(userB)).followups[0];
  await mutate(coachB,'followup',{id:other.id,action:'review',outcome:'continue',dueDate:'2026-10-01',reviewNote:'Practice this once with me'});
  expect(done.outcome).toBe('complete');expect(done.trainingPassed).toBe(false);expect(done.history).toHaveLength(2);
 });
 it('partner observations require the assigned observer and preserve a separate coach review',async()=>{
  const def=getWorkshopDefinition(2)!;const roleplay=def.activities.find(a=>a.kind==='roleplay')!;const sid=id(60);
  await mutate(admin,'create',{definition:def,timezone:'America/Los_Angeles',participants:[{agentId:agentA,coachId:coachA},{agentId:agentB,coachId:coachB}],presenterIds:[]},sid);
  await mutate(admin,'open',{activityId:roleplay.id},sid);
  const group={id:'round-one',activityId:roleplay.id,round:1,agentId:agentA,buyerId:agentB,observerId:null};
  await mutate(admin,'group',{group},sid);
  const observation={id:id(61),groupId:group.id,criteria:Object.fromEntries(roleplay.rubric!.map(r=>[r.id,true])),correction:'Listen to the buyer',retry:'Tried the invitation again'};
  await expect(mutate(userA,'observe',observation,sid)).rejects.toThrow('assigned observer');
  await mutate(userB,'observe',observation,sid);await mutate(userB,'observe',{...observation,id:id(62)},sid);
  await mutate(admin,'observe',{...observation,id:id(63)},sid);
  const results=await pg.query('select coach_reviewed from rep_live_observations where session_id=$1',[sid]);expect(results.rows).toHaveLength(2);
  expect(results.rows.map((x:any)=>x.coach_reviewed).sort()).toEqual([false,true]);
  await expect(mutate(admin,'group',{group:{...group,round:2}},sid)).rejects.toThrow('new round');
 });
 it('poll cursor avoids loading unchanged content after authorization',async()=>{
  const state=await read(userA),cursor=state.session.updated_at;
  const same=(await pg.query<{result:any}>('select rep_live_read($1,$2,$3) result',[userA,session,cursor])).rows[0].result;
  expect(same.unchanged).toBe(true);expect(same.session).toBeUndefined();
  await expect(pg.query('select rep_live_read($1,$2,$3)',[stranger,session,cursor])).rejects.toThrow('Session unavailable');
 });
 it('daily digest leases freeze payload and prevent overlapping delivery',async()=>{
  const call=async(payload:any)=>(await pg.query<{result:any}>('select rep_live_digest_claim($1,$2,$3,$4) result',[userA,'2026-09-12','a@example.test',JSON.stringify(payload)])).rows[0].result;
  const first=await call({subject:'Original'});expect(first.status).toBe('sending');expect(await call({subject:'Changed'})).toBeNull();
  await pg.query("update rep_live_digests set status='failed' where user_id=$1",[userA]);
  const retry=await call({subject:'Changed'});expect(retry.payload.subject).toBe('Original');expect(retry.idempotency_key).toBe(first.idempotency_key);
  await pg.query("update rep_live_digests set status='sent' where user_id=$1",[userA]);expect(await call({subject:'Again'})).toBeNull();
 });
 it('processes 50 concurrent real submission validations and durable state reads',async()=>{
  const def=getWorkshopDefinition(2)!,opening=def.activities.find(a=>a.kind==='choice')!,sid=id(70);
  const cohort=Array.from({length:50},(_,i)=>({user:id(100+i),agent:id(200+i)}));
  for(const c of cohort){await pg.query('insert into auth.users(id) values($1)',[c.user]);await pg.query('insert into agents(id,org_id,team_id,name,auth_id) values($1,$2,$3,$4,$5)',[c.agent,orgA,teamA,'Benchmark learner',c.user]);}
  await mutate(admin,'create',{definition:def,timezone:'UTC',participants:cohort.map(c=>({agentId:c.agent,coachId:coachA})),presenterIds:[]},sid);
  await mutate(admin,'open',{activityId:opening.id},sid);
  const database={rpc:async(fn:string,b:Record<string,unknown>)=>{const params=Object.keys(b).map((key,i)=>`${key}=>$${i+1}`).join(',');return(await pg.query<{result:any}>(`select ${fn}(${params}) result`,Object.values(b).map(x=>x!==null&&typeof x==='object'?JSON.stringify(x):x))).rows[0].result;}} as unknown as Db;
  const response={choiceId:opening.choices![0].id,...Object.fromEntries(opening.fields!.map(f=>[f.id,'Fresh benchmark response']))};
  const start=performance.now();
  await Promise.all(cohort.map((c,i)=>submitLiveAttempt(database,c.user,sid,{id:id(300+i),activityId:opening.id,response})));
  const submitted=performance.now();
  await Promise.all(cohort.map(c=>database.rpc('rep_live_read',{p_actor:c.user,p_session:sid})));
  const elapsed=performance.now()-start;
  console.log(`Isolated embedded Postgres: 50 concurrent submissions ${(submitted-start).toFixed(0)}ms; submissions plus 50 authorized state reads ${elapsed.toFixed(0)}ms. Excludes network/poll scheduling.`);
  expect((await pg.query('select id from rep_live_attempts where session_id=$1',[sid])).rows).toHaveLength(50);
  expect(elapsed).toBeLessThan(3000);
 },15000);
});
