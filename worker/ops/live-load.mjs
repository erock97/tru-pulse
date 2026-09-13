/** Local-only HTTP/polling check. Start preview:live with REP_PREVIEW_LOAD=1.
 * The hostname restriction is intentional: fixture cookies cannot be used as
 * hosted credentials, and this runner must never create real assignments. */
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const base=new URL(process.env.REP_LOAD_URL??'http://127.0.0.1:8792');
assert.equal(base.hostname,'127.0.0.1');
const constants=await readFile(new URL('../../shared/liveWorkshops.ts',import.meta.url),'utf8');
const pollMs=Number(constants.match(/LIVE_POLL_MS = (\d+)/)[1]);
const timings={submission:[],learnerRead:[],presenterRead:[],submissionToPresenter:[]};
async function request(user,path,body,metric){
 const start=performance.now();
 const r=await fetch(new URL('/rep/sessions'+path,base),{method:body?'POST':'GET',
  headers:{Cookie:`hq_sid=preview-${user}`,Origin:'http://127.0.0.1:5174','Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));
 if(metric)timings[metric].push(performance.now()-start);
 return result;
}
const pre=await request('presenter','/preflight');
const agents=pre.agents.filter(a=>a.name.startsWith('Load learner '));assert.equal(agents.length,50);
const sid=crypto.randomUUID(),prefix='/'+sid;
await request('presenter','',{id:sid,day:2,timezone:'America/Los_Angeles',participants:agents.map(a=>({agentId:a.id})),presenterIds:[]});
const state=await request('presenter',prefix+'?view=presenter');
const slide=state.definition.slides.find(s=>s.activity?.fields?.length&&s.activity.model&&s.activity.kind!=='record');
await request('presenter',prefix+'/commands',{action:'slide',slideId:slide.id});
await Promise.all(Array.from({length:50},(_,n)=>request(`load${n}`,prefix+'/join',{})));
const pending=new Map();let stopped=false;const failures=[];
async function poll(user,metric){
 try{while(!stopped){
  const result=await request(user,prefix+`?view=${user==='presenter'?'presenter':'agent'}`,undefined,metric);
  if(user==='presenter')for(const a of result.attempts){
   if(pending.has(a.id)){timings.submissionToPresenter.push(performance.now()-pending.get(a.id));pending.delete(a.id);}
  }
  await delay(pollMs);
 }}catch(e){failures.push(String(e));stopped=true;}
}
const polling=[poll('presenter','presenterRead'),...Array.from({length:50},(_,n)=>poll(`load${n}`,'learnerRead'))];
try{
 for(let round=0;round<3;round++){
  await Promise.all(Array.from({length:50},async(_,n)=>{
   await delay((n*37+round*113)%pollMs);
   const id=crypto.randomUUID(),activity=slide.activity;
   const response=Object.fromEntries(activity.fields.map(f=>[f.id,`Local load attempt ${round}/${n}`]));
   if(activity.choices?.length)response.choiceId=activity.choices[0].id;
   pending.set(id,performance.now());
   await request(`load${n}`,prefix+'/submissions',{id,activityId:activity.id,response},'submission');
  }));
  const deadline=performance.now()+30000;
  while(pending.size&&!failures.length&&performance.now()<deadline)await delay(25);
  assert.equal(pending.size,0,'Presenter did not observe all submissions');
 }
}finally{stopped=true;await Promise.all(polling);}
assert.deepEqual(failures,[]);
const final=await request('presenter',prefix+'?view=presenter');assert.equal(final.attempts.length,150);
const shared=await request('presenter',prefix+'?view=shared');assert.equal(shared.attempts.length,0);
assert.equal(JSON.stringify(shared).includes('Local load attempt'),false);
await request('presenter',prefix+'/commands',{action:'end'});
const summarize=values=>{const s=[...values].sort((a,b)=>a-b);const pct=p=>Math.round(s[Math.ceil(s.length*p)-1]);return {count:s.length,p50Ms:pct(.5),p95Ms:pct(.95),p99Ms:pct(.99),maxMs:Math.round(s.at(-1))};};
const result={timestamp:new Date().toISOString(),scope:'Loopback HTTP, fixture identities, embedded Postgres; excludes hosted network and browser rendering',learners:50,teams:2,rounds:3,pollMs,sessionId:sid,errors:failures,metrics:Object.fromEntries(Object.entries(timings).map(([key,value])=>[key,summarize(value)])),sharedProjectionPrivate:true};
await writeFile(process.env.REP_LOAD_OUTPUT??'../docs/rep-qa-coverage-evidence/local-http-load.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
