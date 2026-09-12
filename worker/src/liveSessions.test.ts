import {describe,it,expect,vi,beforeEach} from 'vitest';
import {liveStateForView,validateLiveResponse,gradeLiveResponse,handleLiveSessions,type RawLiveState} from './liveSessions.js';
import {getWorkshopDefinition} from '../../shared/workshopCatalog.js';
import {digestItems,digestEmail,dateInZone,runLiveDigests} from './liveDigests.js';
import {supabaseAsUser} from './asUser.js';
import type {Env} from './env.js';
import type {Db} from './db.js';
import type {LiveFollowup} from '../../shared/liveWorkshops.js';
vi.mock('./asUser.js',()=>({supabaseAsUser:vi.fn()}));
const definition=getWorkshopDefinition(2)!;
const opening=definition.activities.find(a=>a.kind==='choice')!;
function rawState():RawLiveState{return {
 session:{id:'s',day:2,title:definition.title,version:definition.version,timezone:'America/Los_Angeles',status:'active',created_at:'2026-09-12T12:00:00Z',ended_at:null,current_activity_id:opening.id,current_slide_id:opening.slideId,presenter_ids:['presenter'],definition,opened_activity_ids:[opening.id],revealed_activity_ids:[],timer_ends_at:null,updated_at:'2026-09-12T12:01:00Z',roster:[],groups:[]},myAgentId:'learner',canPresent:true,
 participants:[{agentId:'learner',name:'Private name',userId:'user',orgId:'org',teamId:'team',teamName:'Private team',coachId:'coach',joinedAt:null,lastSeenAt:null}],
 progress:[{agent_id:'learner',activity_id:opening.id,status:'working',help:null,actions:[],dirty:true,updated_at:'today'}],
 attempts:[{id:'first',agent_id:'learner',activity_id:opening.id,attempt:1,response:{choiceId:opening.choices![0].id,'text':'Private submitted wording'},assisted:false,submitted_at:'1',grade:null},
 {id:'second',agent_id:'learner',activity_id:opening.id,attempt:2,response:{choiceId:opening.choices![1].id},assisted:false,submitted_at:'2',grade:null},
 {id:'assisted',agent_id:'learner',activity_id:opening.id,attempt:3,response:{choiceId:opening.choices![1].id},assisted:true,submitted_at:'3',grade:null}],observations:[],followups:[]};}
beforeEach(()=>vi.clearAllMocks());
describe('live transport and projection',()=>{
 it('shared view never contains private people, responses, checks or coach notes',()=>{
  const view=liveStateForView(rawState(),'presenter','shared'),serialized=JSON.stringify(view);
  for(const secret of ['Private name','Private submitted wording','Private team'])expect(serialized).not.toContain(secret);
  expect(view.participants).toEqual([]);expect(view.attempts).toEqual([]);expect(view.groups).toEqual([]);
  expect(view.definition.slides.every(s=>!s.notes&&!s.cue)).toBe(true);
  expect(view.definition.activities.find(a=>a.id===opening.id)?.correctChoiceId).toBeUndefined();
  expect(view.choiceTotals).toEqual({});
 });
 it('choice counts use one first independent attempt per learner, with controlled reveal',()=>{
  const raw=rawState();const presenter=liveStateForView(raw,'presenter','presenter');
  expect(presenter.choiceTotals[opening.id]).toEqual({[opening.choices![0].id]:1});
  raw.session.revealed_activity_ids=[opening.id];const shared=liveStateForView(raw,'presenter','shared');
  expect(shared.choiceTotals[opening.id]).toEqual({[opening.choices![0].id]:1});
  expect(shared.definition.activities.find(a=>a.id===opening.id)?.model).toBe(opening.model);
 });
 it('choice activities with written fields require both',()=>{
  expect(validateLiveResponse(opening,{choiceId:opening.choices![0].id})).toBe('Complete each response field');
  const fields=Object.fromEntries(opening.fields!.map(f=>[f.id,'My actual wording']));
  expect(validateLiveResponse(opening,{choiceId:opening.choices![0].id,...fields})).toBeNull();
 });
 it('record checks use unchanged server grading and do not grade note wording',()=>{
  const act=getWorkshopDefinition(1)!.activities.find(a=>a.scenario==='spoke-note')!;
  const response={submission:{stage:'Spoke with customer',stageSaved:true,note:'x'}};
  expect(gradeLiveResponse(act,response)?.checks.find(c=>c.id==='note')?.pass).toBe(true);
  expect(gradeLiveResponse(opening,{choiceId:'x'})).toBeNull();
 });
 it('routes stay disabled without rollout flag and require cookie login and allowed origin',async()=>{
  const env={REP_LIVE_SESSIONS:'0'} as Env;
  expect((await handleLiveSessions(new Request('http://x/rep/sessions'),env,{},true))?.status).toBe(200);
  env.REP_LIVE_SESSIONS='1';
  expect((await handleLiveSessions(new Request('http://x/rep/sessions',{method:'POST'}),env,{},false))?.status).toBe(403);
  vi.mocked(supabaseAsUser).mockResolvedValue(null);
  expect((await handleLiveSessions(new Request('http://x/rep/sessions'),env,{},true))?.status).toBe(401);
 });
});
const followup={id:'f',agentId:'a',orgId:'o',sessionId:'s',skillId:'day-1',coachId:'c',timezone:'America/Los_Angeles',checkpoint:1,dueDate:'2026-09-12',moduleTitle:'Welcome',outcome:null,practiceAt:null,reviewedAt:null,reflection:'PRIVATE REFLECTION',reviewNote:'PRIVATE REVIEW'} as LiveFollowup;
describe('daily training digests',()=>{
 it('uses session timezone and only due or awaiting-review open work',()=>{
  const now=new Date('2026-09-12T05:00:00Z');expect(dateInZone(now,followup.timezone)).toBe('2026-09-11');
  expect(digestItems([followup],now)).toHaveLength(0);
  expect(digestItems([{...followup,practiceAt:'2026-09-11'}],now)).toHaveLength(1);
  expect(digestItems([{...followup,outcome:'complete'}],new Date('2026-09-13'))).toHaveLength(0);
 });
 it('email contains links and never private response or review text',()=>{
  const email=digestEmail([followup],'https://app.truhq.co');
  expect(email.html).toContain('https://app.truhq.co/#/rep');expect(email.html).not.toContain('PRIVATE');
 });
 it('records one recipient lookup failure and continues delivering to the coach',async()=>{
  const rpc=vi.fn(async(fn:string,args:any)=>fn==='rep_live_digest_claim'?{idempotency_key:'stable',recipient:args.p_email,payload:args.p_payload}:null),update=vi.fn();
  const database={select:vi.fn(async(table:string)=>table==='agents'?[{id:'a',auth_id:'owner'}]:[{id:'f',record:followup}]),rpc,update} as unknown as Db;
  const fetcher=vi.fn(async(input:string)=>input.endsWith('/owner')?new Response('{}',{status:404}):input.includes('/admin/users/')?new Response(JSON.stringify({email:'coach@example.test'})):new Response(JSON.stringify({id:'accepted'})));
  vi.stubGlobal('fetch',fetcher);
  try{
   const result=await runLiveDigests({REP_LIVE_SESSIONS:'1',REP_LIVE_DIGESTS:'1',SUPABASE_URL:'http://example.test',SUPABASE_SERVICE_ROLE_KEY:'local',RESEND_API_KEY:'local',INVITE_FROM:'TRU <test@truhq.co>'} as Env,new Date('2026-09-12T17:00:00Z'),database);
   expect(result).toEqual({sent:1,failed:1});expect(rpc).toHaveBeenCalledWith('rep_live_digest_lookup_failure',expect.objectContaining({p_user:'owner'}));
   expect(update).toHaveBeenCalledWith('rep_live_digests',expect.any(String),expect.objectContaining({status:'sent'}));
  }finally{vi.unstubAllGlobals();}
 });
 it('paginates older completed work so later due assignments remain visible',async()=>{
  const closed=Array.from({length:1000},()=>({id:'old',record:{...followup,outcome:'complete'}}));
  const select=vi.fn(async(table:string,query:string)=>table==='agents'?[]:query.includes('offset=0')?closed:[{id:'f',record:followup}]);
  const database={select,rpc:vi.fn(async()=>null)} as unknown as Db;
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({email:'coach@example.test'}))));
  try{await runLiveDigests({REP_LIVE_SESSIONS:'1',REP_LIVE_DIGESTS:'1',SUPABASE_URL:'http://example.test'} as Env,new Date('2026-09-12T17:00:00Z'),database);
   expect(select).toHaveBeenCalledWith('rep_live_followups',expect.stringContaining('offset=1000'));
  }finally{vi.unstubAllGlobals();}
 });
 it('does not send without the explicit digest rollout flag',async()=>{
  const mock=vi.fn();await runLiveDigests({REP_LIVE_SESSIONS:'1'} as Env,new Date(),{select:mock} as unknown as Db);expect(mock).not.toHaveBeenCalled();
 });
});
