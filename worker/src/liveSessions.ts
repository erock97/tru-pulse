import type { Env } from './env.js';
import { supabaseAsUser, type UserClient } from './asUser.js';
import { readCookie } from './session.js';
import { db, type Db } from './db.js';
import { getWorkshopDefinition, learnerWorkshopDefinition, type WorkshopDefinition, type CatalogActivity } from '../../shared/workshopCatalog.js';
import type { LiveAttempt, LiveSessionState, LiveView, LiveGroup, LiveObservation, LiveFollowup } from '../../shared/liveWorkshops.js';
import { gradeRecord, gradeFaults, type RecordSubmission } from './repLab/records.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = (v:unknown) => typeof v==='string' && uuid.test(v);
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
export type RawLiveState = {
 session: {id:string;day:number;title:string;version:string;timezone:string;status:'active'|'ended';created_at:string;ended_at:string|null;
  current_activity_id:string|null;current_slide_id:string;presenter_ids:string[];definition:WorkshopDefinition;opened_activity_ids:string[];revealed_activity_ids:string[];
  timer_ends_at:string|null;updated_at:string;roster:LiveSessionState['participants'];groups:LiveGroup[]};
 myAgentId:string|null;canPresent:boolean;participants:LiveSessionState['participants'];
 progress:Record<string,any>[];attempts:Record<string,any>[];observations:Record<string,any>[];followups:LiveFollowup[];
 choiceTotals?:Record<string,Record<string,number>>;
};
export function mapAttempt(a:Record<string,any>):LiveAttempt {
 return {id:a.id,agentId:a.agent_id,activityId:a.activity_id,attempt:a.attempt,response:a.response,assisted:a.assisted,submittedAt:a.submitted_at,grade:a.grade};
}
/** Never spread a raw row into a browser response: the snapshot contains coach notes. */
export function liveStateForView(raw:RawLiveState,viewerId:string,view:LiveView):LiveSessionState {
 const s=raw.session, presenter=view==='presenter'&&raw.canPresent;
 const allGroups=s.groups??[];
 const groups=presenter?allGroups:allGroups.filter(g=>[g.agentId,g.buyerId,g.observerId].includes(raw.myAgentId??'')||g.coachId===viewerId);
 const peerIds=new Set(groups.flatMap(g=>[g.agentId,g.buyerId,g.observerId]).filter(Boolean));
 const participants=presenter?raw.participants:raw.participants.filter(p=>p.agentId===raw.myAgentId);
 if(!presenter)for(const p of s.roster)if(peerIds.has(p.agentId)&&!participants.some(x=>x.agentId===p.agentId))participants.push({...p,userId:null,coachId:'',orgId:'',teamId:'',teamName:'',joinedAt:null,lastSeenAt:null});
 const revealed=s.revealed_activity_ids??[];
 const totals:Record<string,Record<string,number>>={};
 const firstAttempts=[...new Map(raw.attempts.filter(a=>!a.assisted).slice().reverse().map(a=>[`${a.agent_id}:${a.activity_id}`,a])).values()];
 for(const a of firstAttempts){const choice=a.response?.choiceId;if(typeof choice==='string'&&(presenter||revealed.includes(a.activity_id))){totals[a.activity_id]??={};totals[a.activity_id][choice]=(totals[a.activity_id][choice]??0)+1;}}
 const state:LiveSessionState={
  session:{id:s.id,day:s.day,title:s.title,version:s.version,timezone:s.timezone,status:s.status,createdAt:s.created_at,endedAt:s.ended_at,currentActivityId:s.current_activity_id,currentSlideId:s.current_slide_id,presenterIds:presenter?s.presenter_ids:[],canPresent:raw.canPresent},
  definition:presenter?s.definition:learnerWorkshopDefinition(s.definition,revealed),cursor:s.updated_at,viewerId,myAgentId:raw.myAgentId,canPresent:raw.canPresent,
  openedActivityIds:s.opened_activity_ids,revealedActivityIds:revealed,timerEndsAt:s.timer_ends_at,participants,
  progress:raw.progress.filter(x=>presenter||x.agent_id===raw.myAgentId).map(x=>({agentId:x.agent_id,activityId:x.activity_id,status:x.status,help:x.help,actions:x.actions,dirty:x.dirty,helpResolvedCount:x.help_resolved_count??0,updatedAt:x.updated_at})),
  attempts:raw.attempts.filter(x=>presenter||x.agent_id===raw.myAgentId).map(mapAttempt),groups,
  observations:raw.observations.filter(x=>presenter||x.agent_id===raw.myAgentId||x.observer_id===viewerId).map(x=>({id:x.id,groupId:x.group_id,activityId:x.activity_id,agentId:x.agent_id,observerId:x.observer_id,round:x.round,criteria:x.criteria,correction:x.correction,retry:x.retry,coachReviewed:x.coach_reviewed,submittedAt:x.submitted_at} as LiveObservation)),
  followups:raw.followups.filter(x=>presenter||x.agentId===raw.myAgentId),choiceTotals:raw.choiceTotals?Object.fromEntries(Object.entries(raw.choiceTotals).filter(([id])=>presenter||revealed.includes(id))):totals,
 };
 if(view==='shared'){
  state.participants=[];state.progress=[];state.attempts=[];state.observations=[];state.followups=[];state.groups=[];
  state.myAgentId=null;state.viewerId='';state.canPresent=false;state.session.presenterIds=[];state.session.canPresent=false;
 }
 return state;
}

function boundedText(value:unknown,max=8000):boolean{return typeof value==='string'&&value.length<=max;}
export function validateLiveResponse(activity:CatalogActivity,response:unknown):string|null {
 if(!object(response))return 'Invalid response';
 if(JSON.stringify(response).length>16000)return 'Response is too large';
 if(activity.kind==='record'){
  const sub=response.submission;if(!object(sub))return 'Record submission required';
  if(sub.phase==='audit')return Array.isArray(sub.faults)&&sub.faults.every(x=>boundedText(x,100))?null:'Invalid diagnosis';
  for(const key of ['stage','note'])if(sub[key]!==undefined&&!boundedText(sub[key]))return 'Invalid record';
  for(const key of ['task','deal']){if(sub[key]!==undefined&&!object(sub[key]))return 'Invalid record';if(object(sub[key])&&Object.values(sub[key]).some(v=>v!==undefined&&!boundedText(v,1000)))return 'Invalid record';}
  return null;
 }
 if(activity.kind==='choice'&&!activity.choices?.some(c=>c.id===response.choiceId))return 'Choose an answer';
 if(activity.fields?.length){const fields=object(response.fields)?response.fields:response;return activity.fields.every(f=>boundedText(fields[f.id],8000)&&String(fields[f.id]).trim())?null:'Complete each response field';}
 return Object.values(response).some(v=>typeof v==='string'&&v.trim())?null:'Add your response';
}
export function gradeLiveResponse(activity:CatalogActivity,response:Record<string,unknown>) {
 if(activity.kind!=='record')return null;
 const sub=response.submission as Record<string,unknown>;
 return sub.phase==='audit'?gradeFaults(activity.scenario!,sub.faults as string[]):gradeRecord(activity.scenario!,sub as RecordSubmission);
}
async function jsonBody(req:Request):Promise<Record<string,unknown>>{
 if(Number(req.headers.get('content-length')??0)>32000)throw Error('Request too large');
 const reader=req.body?.getReader();if(!reader)throw Error('Invalid request');let n=0,text='';const decoder=new TextDecoder();
 while(true){const next=await reader.read();if(next.done)break;n+=next.value.byteLength;if(n>32000){await reader.cancel();throw Error('Request too large');}text+=decoder.decode(next.value,{stream:true});}
 const body=JSON.parse(text+decoder.decode());if(!object(body))throw Error('Invalid request');return body;
}
export async function submitLiveAttempt(database:Db,userId:string,sessionId:string,body:Record<string,unknown>){
 if(!identifier(body.id)||typeof body.activityId!=='string')throw Error('Invalid submission');
 const raw=await database.rpc('rep_live_read',{p_actor:userId,p_session:sessionId}) as RawLiveState;
 const activity=raw.session.definition.activities.find(x=>x.id===body.activityId);
 if(!activity)throw Error('Unknown activity');
 const error=validateLiveResponse(activity,body.response);if(error)throw Error(error);
 const response=body.response as Record<string,unknown>;
 const result=await database.rpc('rep_live_mutate',{p_actor:userId,p_session:sessionId,p_action:'submit',p_body:{id:body.id,activityId:body.activityId,response,grade:gradeLiveResponse(activity,response)}});
 return {ok:true,attempt:mapAttempt(result.attempt)};
}

export async function handleLiveSessions(req:Request,env:Env,cors:Record<string,string>,originOk:boolean):Promise<Response|null>{
 const url=new URL(req.url);if(!url.pathname.startsWith('/rep/sessions'))return null;
 const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 if(env.REP_LIVE_SESSIONS!=='1')return url.pathname==='/rep/sessions'&&req.method==='GET'?reply({enabled:false,sessions:[]}):reply({error:'Live sessions are not enabled'},404);
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&!originOk)return reply({error:'Origin denied'},403);
 const user=await supabaseAsUser(env,readCookie(req));if(!user)return reply({error:'Not signed in'},401);
 const database=db(env);
 try{
  if(url.pathname==='/rep/sessions/deliveries'&&req.method==='GET'){
   if((await user.rpc<boolean>('is_admin',{})).data!==true)return reply({error:'Administrator access required'},403);
   return reply({deliveries:await database.select('rep_live_digests','select=user_id,day,status,attempts,last_error,updated_at&order=updated_at.desc&limit=100')});
  }
  if(url.pathname==='/rep/sessions/preflight'&&req.method==='GET')return reply(await database.rpc('rep_live_preflight',{p_actor:user.userId}));
  if(url.pathname==='/rep/sessions'&&req.method==='GET')return reply({enabled:true,sessions:await database.rpc('rep_live_list',{p_actor:user.userId})});
  const body=req.method==='POST'?await jsonBody(req):{};
  if(url.pathname==='/rep/sessions'&&req.method==='POST'){
   const definition=getWorkshopDefinition(Number(body.day));if(!definition||!identifier(body.id)||typeof body.timezone!=='string'||!Array.isArray(body.participants))return reply({error:'Choose a training, timezone, and roster'},400);
   return reply(await database.rpc('rep_live_mutate',{p_actor:user.userId,p_session:body.id,p_action:'create',p_body:{definition,timezone:body.timezone,participants:body.participants,presenterIds:body.presenterIds??[]}}));
  }
  const match=url.pathname.match(/^\/rep\/sessions\/([0-9a-f-]+)(?:\/(join|commands|progress|submissions|observations))?$/i);
  if(!match||!identifier(match[1]))return reply({error:'Route unavailable'},404);
  const [,sessionId,route]=match;
  if(req.method==='GET'&&!route){
   const view=(url.searchParams.get('view')??'agent') as LiveView;if(!['agent','presenter','shared'].includes(view))return reply({error:'Unknown view'},400);
   const loaded=await database.rpc('rep_live_read',{p_actor:user.userId,p_session:sessionId,p_cursor:url.searchParams.get('cursor')||null});
   if(loaded.unchanged)return reply(loaded);
   const raw=loaded as RawLiveState;
   if(view==='presenter'&&!raw.canPresent)return reply({error:'Presenter access required'},403);
   if(url.searchParams.get('cursor')===raw.session.updated_at)return reply({unchanged:true,cursor:raw.session.updated_at,serverTime:new Date().toISOString()});
   return reply(liveStateForView(raw,user.userId,view));
  }
  if(req.method!=='POST'||!route)return reply({error:'Method not allowed'},405);
  if(route==='submissions')return reply(await submitLiveAttempt(database,user.userId,sessionId,body));
  const action=route==='commands'?String(body.action):route==='observations'?'observe':route;
  if(!['join','open','slide','timer','reveal','group','end','progress','observe'].includes(action))return reply({error:'Unknown action'},400);
  return reply(await database.rpc('rep_live_mutate',{p_actor:user.userId,p_session:sessionId,p_action:action,p_body:body}));
 }catch(error){
  const message=error instanceof Error?error.message:'Session unavailable';
  const unavailable=/select |rpc .* [45]\d\d|fetch|network|relation .* does not exist/i.test(message);
  return reply({error:unavailable?'Live training could not be loaded or saved. Please retry.':message},unavailable?503:/access|required|unavailable|Only|assigned|not open/i.test(message)?403:/already|ended/i.test(message)?409:400);
 }
}

/** Merge durable live work into the existing assignment interface; KV records stay intact. */
export async function liveAssignmentsForAgent(user:UserClient,agentId:string):Promise<LiveFollowup[]>{
 const rows=await user.select<{id:string;record:LiveFollowup}>('rep_live_followups',`select=id,record&agent_id=eq.${agentId}`,{strict:true});
 return rows.map(r=>({...r.record,id:r.id}));
}
export async function updateLiveAssignment(env:Env,user:UserClient,agentId:string,body:Record<string,unknown>){
 const rows=await user.select<{id:string;session_id:string}>('rep_live_followups',`select=id,session_id&id=eq.${body.id}&agent_id=eq.${agentId}`,{strict:true});
 if(!rows.length)return null;
 return db(env).rpc('rep_live_mutate',{p_actor:user.userId,p_session:rows[0].session_id,p_action:'followup',p_body:body});
}
