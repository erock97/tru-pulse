/** Local fixture adapter only. Uses real Worker handlers, server grader, and the
 * reviewed SQL migration in embedded Postgres. It cannot contact any remote host.
 * No production credentials are read. Bind loopback only; never deploy this file. */
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {handleLiveSessions} from '../src/liveSessions.js';
import {handleCoachingAssignments} from '../src/coachingAssignments.js';
import {supabaseAsUser} from '../src/asUser.js';
import {readCookie} from '../src/session.js';
import {gradeRecord,gradeFaults} from '../src/repLab/records.js';
import type {Env} from '../src/env.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixtures={presenter:{id:id(1),name:'TRU Preview Presenter',email:'presenter@example.test',agent:null},alice:{id:id(4),name:'Alice · Preview team A',email:'alice@example.test',agent:id(30)},blair:{id:id(5),name:'Blair · Preview team B',email:'blair@example.test',agent:id(31)},coach:{id:id(2),name:'Preview Team A Coach',email:'coach@example.test',agent:null}};
mkdirSync(new URL('../.wrangler/live-preview/',import.meta.url),{recursive:true});
const pg=new PGlite(new URL('../.wrangler/live-preview/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const initialized=await pg.query("select schema_name from information_schema.schemata where schema_name='auth'");
if(!initialized.rows.length){
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table orgs(id uuid primary key);create table teams(id uuid primary key,org_id uuid references orgs(id),name text,is_active boolean default true);
 create table agents(id uuid primary key,org_id uuid references orgs(id),team_id uuid references teams(id),name text,email text,auth_id uuid references auth.users(id));
 create table admins(id uuid primary key references auth.users(id));create table memberships(org_id uuid,user_id uuid,role text);create table coach_teams(org_id uuid,user_id uuid,team_id uuid);`);
 await pg.exec(`insert into auth.users(id,email,raw_user_meta_data) values('${id(1)}','presenter@example.test','{"name":"TRU Preview Presenter"}'),('${id(2)}','coach@example.test','{"name":"Team A Coach"}'),('${id(3)}','coachb@example.test','{"name":"Team B Coach"}'),('${id(4)}','alice@example.test','{"name":"Alice"}'),('${id(5)}','blair@example.test','{"name":"Blair"}');
 insert into admins values('${id(1)}');insert into orgs values('${id(10)}'),('${id(11)}');
 insert into teams values('${id(20)}','${id(10)}','Preview Team A',true),('${id(21)}','${id(11)}','Preview Team B',true);
 insert into agents values('${id(30)}','${id(10)}','${id(20)}','Alice · Preview','alice@example.test','${id(4)}'),('${id(31)}','${id(11)}','${id(21)}','Blair · Preview','blair@example.test','${id(5)}');
 insert into memberships values('${id(10)}','${id(2)}','leader'),('${id(11)}','${id(3)}','leader');`);
}
await pg.exec(readFileSync(new URL('../../db/hq_rep_live.sql',import.meta.url),'utf8'));
const sessions=new Map<string,string>();
for(const [name,f] of Object.entries(fixtures))sessions.set(`sess:preview-${name}`,JSON.stringify({userId:f.id,accessToken:`preview-${f.id}`,refreshToken:'local-only',createdAt:0,expiresAt:4102444800}));
const env={REP_LIVE_SESSIONS:'1',REP_LIVE_DIGESTS:'0',SUPABASE_URL:'http://rep-preview.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-service',SUPABASE_ANON_KEY:'local-anon',APP_ORIGIN:'http://127.0.0.1:5173',
 SESSIONS:{get:async(k:string,type?:string)=>{const r=sessions.get(k)??null;return type==='json'&&r?JSON.parse(r):r;},put:async(k:string,v:string)=>{sessions.set(k,v);},delete:async(k:string)=>{sessions.delete(k);},list:async()=>({keys:[],list_complete:true})}} as unknown as Env;
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const req=new Request(input,init),u=new URL(req.url);
 if(u.hostname!=='rep-preview.invalid')throw Error('Local preview refuses all outbound network requests');
 try{
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const fn=u.pathname.split('/').at(-1)!;if(!/^rep_live_[a-z_]+$/.test(fn)&&fn!=='is_admin')return json({message:'RPC unavailable in preview'},404);
   const b=await req.json() as Record<string,unknown>;
   if(fn==='is_admin')return json(req.headers.get('authorization')===`Bearer preview-${id(1)}`);
   if(req.headers.get('authorization')!=='Bearer local-service')return json({message:'Permission denied'},403);
   const params=Object.keys(b).map((key,i)=>{if(!/^p_[a-z_]+$/.test(key))throw Error('Invalid RPC argument');return `${key}=>$${i+1}`;});
   const values=Object.values(b).map(x=>typeof x==='object'?JSON.stringify(x):x);
   const r=await pg.query<{result:unknown}>(`select ${fn}(${params.join(',')}) result`,values);return json(r.rows[0].result);
  }
  const table=u.pathname.split('/').at(-1)!;
  if(!['rep_live_followups','agents','memberships','rep_progress'].includes(table))return json({message:'Table unavailable'},404);
  if(table==='rep_progress')return json([]);
  const userId=req.headers.get('authorization')?.replace('Bearer preview-','');
  const cols=(u.searchParams.get('select')??'*');if(!/^[a-z_,*]+$/.test(cols))throw Error('Invalid columns');
  const where:string[]=[],values:unknown[]=[];
  for(const [key,value] of u.searchParams){if(key==='select'||key==='limit'||key==='order')continue;if(!/^[a-z_]+$/.test(key)||!value.startsWith('eq.'))throw Error('Filter unavailable');values.push(value.slice(3));where.push(`${key}=$${values.length}`);}
  if(table==='rep_live_followups'){values.push(userId);where.push(`rep_live_can_see($${values.length}::uuid,agent_id)`);}
  if(table==='agents'){values.push(userId);where.push(`rep_live_can_see($${values.length}::uuid,id)`);}
  const result=await pg.query(`select ${cols} from ${table}${where.length?' where '+where.join(' and '):''}`,values);return json(result.rows);
 }catch(error){return json({message:error instanceof Error?error.message:'Database refused request'},400);}
};
const server=createServer(async(incoming,outgoing)=>{
 try{
  const origin=incoming.headers.origin??'',cors=/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}:{};
  const url=new URL(incoming.url??'/',`http://${incoming.headers.host??'127.0.0.1:8790'}`);url.pathname=url.pathname.replace(/^\/api\//,'/');
  if(url.pathname==='/preview/login'){
   const name=url.searchParams.get('user')??'presenter';if(!(name in fixtures)){outgoing.writeHead(400);outgoing.end('Unknown preview identity');return;}
   outgoing.writeHead(302,{'Set-Cookie':`hq_sid=preview-${name}; HttpOnly; SameSite=Lax; Path=/`,Location:`http://${url.hostname}:5173/#/rep/sessions`});outgoing.end();return;
  }
  const chunks:Buffer[]=[];for await(const chunk of incoming)chunks.push(Buffer.from(chunk));
  const req=new Request(url,{method:incoming.method,headers:incoming.headers as HeadersInit,body:['GET','HEAD'].includes(incoming.method??'GET')?undefined:Buffer.concat(chunks)});
  const name=(readCookie(req)??'').replace('preview-',''),fixture=fixtures[name as keyof typeof fixtures];
  let response:Response|null=null;
  if(req.method==='OPTIONS')response=new Response(null,{status:204});
  else if(url.pathname==='/auth/me')response=json({user:fixture?{id:fixture.id,email:fixture.email}:null,canReturn:false});
  else if(!fixture)response=json({error:'Sign into a local preview identity'},401);
  else if(url.pathname==='/data/me')response=json({org:null,agent:fixture.agent?{id:fixture.agent,org_id:fixture.agent===id(30)?id(10):id(11),team_id:fixture.agent===id(30)?id(20):id(21),name:fixture.name}:null,role:null});
  else if(url.pathname==='/data/claim-agent')response=json({agentId:fixture.agent});
  else if(url.pathname==='/admin/leaders')response=json({leaders:[]});
  else if(url.pathname==='/data/coaching-assignments'){const user=await supabaseAsUser(env,readCookie(req));response=await handleCoachingAssignments(req,env,user!,{},true);}
  else if(url.pathname==='/rep/record/grade'){
   const b=await req.json() as any;response=json(b.submission.phase==='audit'?gradeFaults(b.scenarioId,b.submission.faults):gradeRecord(b.scenarioId,b.submission));
  }else response=await handleLiveSessions(req,env,{},/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin));
  response??=json({error:'This endpoint is outside the local training preview'},404);
  outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...cors});outgoing.end(await response.text());
 }catch(error){outgoing.writeHead(500,{'Content-Type':'application/json'});outgoing.end(JSON.stringify({error:String(error)}));}
});
server.listen(8790,'127.0.0.1',()=>console.log('Local training preview uses fixture accounts and embedded Postgres. Login: http://127.0.0.1:8790/preview/login?user=presenter'));
