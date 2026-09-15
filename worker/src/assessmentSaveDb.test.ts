import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {handleDataRoutes} from './dataRoutes';
import {supabaseAsUser} from './asUser';
import type {Env} from './env';
vi.mock('./asUser',()=>({supabaseAsUser:vi.fn()}));
let pg:PGlite;
const agent='00000000-0000-4000-8000-000000000001', user='00000000-0000-4000-8000-000000000002', other='00000000-0000-4000-8000-000000000003';
const submission='00000000-0000-4000-8000-000000000004';
const payload={personalCode:'P-Pro-R-D',businessCode:'T-Rec-V-I',personalAxes:{energy:{letter:'P',pct:60}},answers:{personal:Array(20).fill(0),pro:Array(32).fill(2)},tallies:{energy_p:40,energy_t:60,approach_pro:40,approach_rec:60,deal_r:40,deal_v:60,decision_d:40,decision_i:60}};
const save=(a=agent,id=submission,p=payload)=>pg.query('select public.submit_own_assessment($1,$2,$3::jsonb) result',[a,id,JSON.stringify(p)]);
beforeAll(async()=>{
 pg=new PGlite();
 await pg.exec(`create role authenticated; create role anon; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 create function public.is_org_member(uuid) returns boolean language sql stable as $$ select false $$;
 create table agents(id uuid primary key,auth_id uuid,org_id uuid not null,team_id uuid not null,personal_code text,personal_axes jsonb,role text default 'agent');
 create table assessments(id uuid primary key default gen_random_uuid(),org_id uuid not null,team_id uuid not null,agent_id uuid references agents(id),code text,answers jsonb,energy_p int,energy_t int,approach_pro int,approach_rec int,deal_r int,deal_v int,decision_d int,decision_i int);
 grant select,insert,update on agents,assessments to authenticated;
 alter table agents enable row level security; alter table assessments enable row level security;
 create policy agents_self_read on agents for select to authenticated using(auth_id=auth.uid());
 create policy assessments_agent_self on assessments for select to authenticated using(agent_id in(select id from agents where auth_id=auth.uid()));
 insert into agents(id,auth_id,org_id,team_id) values('${agent}','${user}','${agent}','${agent}'),('${other}','${other}','${other}','${other}');
 set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
 // This is the original production failure, tested against real Postgres RLS rather than a mock.
 await expect(pg.exec(`insert into assessments(org_id,team_id,agent_id) values('${agent}','${agent}','${agent}')`)).rejects.toThrow('row-level security');
 await pg.exec('reset role');
 await pg.exec(readFileSync(new URL('../../supabase/migrations/20260915030436_assessment_own_atomic.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await pg.close();});
beforeEach(async()=>{await pg.exec(`reset role; truncate assessments; update agents set personal_code=null,personal_axes=null; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);});
it('ordinary agent with no membership saves both records, and a lost-response retry is idempotent',async()=>{
 const first=await save();expect(await save()).toEqual(first);
 expect((await pg.query('select * from assessments')).rows).toHaveLength(1);
 expect((await pg.query('select personal_code,personal_axes from agents')).rows[0]).toEqual({personal_code:payload.personalCode,personal_axes:payload.personalAxes});
});
it('rejects another agent, mismatched tenant IDs and privilege escalation via direct REST-equivalent updates',async()=>{
 await expect(save(other)).rejects.toThrow('Not your');
 await expect(pg.exec(`insert into assessments(org_id,team_id,agent_id) values('${other}','${other}','${agent}')`)).rejects.toThrow('row-level security');
 await expect(pg.exec(`update agents set role='admin' where id='${agent}'`)).rejects.toThrow('Only your assessment');
 await expect(pg.exec(`update agents set org_id='${other}' where id='${agent}'`)).rejects.toThrow('Only your assessment');
});
it('rolls back the assessment if the profile update fails',async()=>{
 await pg.exec(`reset role; alter table agents add constraint profile_failure check(personal_code is null); set role authenticated;`);
 try {await expect(save()).rejects.toThrow('profile_failure');expect((await pg.query('select * from assessments')).rows).toHaveLength(0);}
 finally{await pg.exec('reset role; alter table agents drop constraint profile_failure;');}
});
it('rejects incomplete answers and denies anonymous callers',async()=>{
 await expect(save(agent,submission,{...payload,answers:{personal:[],pro:[]}})).rejects.toThrow('Incomplete');
 await pg.exec('set role anon');await expect(save()).rejects.toThrow('permission denied');
});
it('replaying an older completion does not overwrite a newer profile',async()=>{
 await save();await save(agent,other,{...payload,personalCode:'T-Rec-V-I'});await save();
 expect((await pg.query('select personal_code from agents')).rows[0]).toEqual({personal_code:'T-Rec-V-I'});
});

it('the real worker route commits through the caller-scoped RPC and refuses cross-agent submission',async()=>{
 vi.mocked(supabaseAsUser).mockResolvedValue({userId:user,rpc:async(name:string,args:Record<string,unknown>)=>{
   expect(name).toBe('submit_own_assessment');
   try {const r=await pg.query<{result:{id:string}}>('select public.submit_own_assessment($1,$2,$3::jsonb) result',[args.p_agent_id,args.p_submission_id,JSON.stringify(args.p_result)]);return {ok:true,data:r.rows[0].result};}
   catch {return {ok:false,data:null};}
 }} as Awaited<ReturnType<typeof supabaseAsUser>>);
 const url=new URL('https://api.truhq.co/data/coach/submit-own');
 const request=(id=agent,originOk=true)=>handleDataRoutes(new Request(url,{method:'POST',body:JSON.stringify({...payload,agentId:id,submissionId:submission})}),{} as Env,url,{},originOk);
 expect((await request())?.status).toBe(200);
 expect((await pg.query('select * from assessments')).rows).toHaveLength(1);
 expect((await request(other))?.status).toBe(403);
 expect((await request(agent,false))?.status).toBe(403);
});
