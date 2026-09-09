import type {Env} from './env.js';
import type {UserClient} from './asUser.js';
import {assignmentInput,type CoachingAssignment,type CoachingAssignmentEvent} from '../../shared/coachingAssignments.js';
type History={history?:CoachingAssignmentEvent[];historyIncomplete?:boolean};
type Practice=History&{practiceAt:string;reflection:string};
type Review=History&{reviewedAt:string;reviewedBy?:string;reviewNote:string;outcome:CoachingAssignment['outcome'];dueDate?:string};
const incomplete=(record:History|null)=>!!record&&(record.historyIncomplete===true||!record.history);
const historyPatch=(practice:Practice|null,review:Review|null)=>({
 history:[...(practice?.history??[]),...(review?.history??[])].sort((a,b)=>a.at.localeCompare(b.at)),
 historyIncomplete:incomplete(practice)||incomplete(review),
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Agent={id:string;org_id:string;auth_id:string|null};
export async function handleCoachingAssignments(req:Request,env:Env,db:UserClient,cors:Record<string,string>,originOk:boolean):Promise<Response>{
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&!originOk)return reply({error:'Origin denied'},403);
 const agentId=new URL(req.url).searchParams.get('agentId')??'';
 if(!uuid.test(agentId))return reply({error:'Invalid agent'},400);
 try{
  // RLS verifies visibility before accessing private assignment storage.
  const [agent]=await db.select<Agent>('agents',`select=id,org_id,auth_id&id=eq.${agentId}&limit=1`,{strict:true});
  if(!agent)return reply({error:'Agent not available'},403);
  const member=await db.select<{role:string}>('memberships',`select=role&org_id=eq.${agent.org_id}&user_id=eq.${db.userId}`,{strict:true});
  const admin=member.some(m=>['leader','coach','admin'].includes(m.role)) || (await db.rpc<boolean>('is_admin',{})).data===true;
  const own=agent.auth_id===db.userId;
  if(!admin&&!own)return reply({error:'Not allowed'},403);
  const prefix=`coaching-assignment:v1:${agent.org_id}:${agentId}:`;
  const read=async(id:string)=>await env.SESSIONS.get(prefix+id,'json') as CoachingAssignment|null;
  if(req.method==='GET'){
   let cursor:string|undefined;const records:CoachingAssignment[]=[];
   do {const page=await env.SESSIONS.list({prefix,limit:100,cursor});
    const batch=await Promise.all(page.keys.map(k=>env.SESSIONS.get(k.name,'json') as Promise<CoachingAssignment|null>));
    for(const r of batch)if(r&&r.agentId===agentId&&r.orgId===agent.org_id)records.push(r);
    cursor=page.list_complete?undefined:page.cursor;
    if(records.length>500)throw Error('Assignment history too large.');
   }while(cursor);
   const progress=await db.select<{module_id:string;status:string;passed_at:string|null}>('rep_progress',`select=module_id,status,passed_at&agent_id=eq.${agentId}`,{strict:true});
   const assignments=await Promise.all(records.map(async r=>{
    const practice=await env.SESSIONS.get(`coaching-practice:v1:${agent.org_id}:${agentId}:${r.id}`,'json') as Practice|null;
    const review=await env.SESSIONS.get(`coaching-review:v1:${agent.org_id}:${agentId}:${r.id}`,'json') as Review|null;
    return {...r,...practice,...review,...historyPatch(practice,review),trainingPassed:progress.some(p=>p.module_id===r.moduleId&&p.status==='passed'),passedAt:progress.find(p=>p.module_id===r.moduleId&&p.status==='passed')?.passed_at??null};
   }));
   assignments.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||b.createdAt.localeCompare(a.createdAt));
   return reply({assignments,canAssign:admin});
  }
  const reader=req.body?.getReader();let text='';let bytes=0;const decoder=new TextDecoder();
  if(reader){while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8000){await reader.cancel();return reply({error:'Assignment is too large'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
  let b:Record<string,unknown>;try{b=JSON.parse(text);}catch{return reply({error:'Invalid request'},400);}
  if(!b||typeof b!=='object'||!uuid.test(String(b.id??'')))return reply({error:'Invalid assignment'},400);
  const id=String(b.id),action=b.action;
  if(action==='create'){
   if(!admin)return reply({error:'Only coaches can assign work'},403);
   let input;try{input=assignmentInput(b);}catch(e){return reply({error:(e as Error).message},400);}
   if(input.moduleId&&!uuid.test(input.moduleId))return reply({error:'Invalid training'},400);
   let moduleTitle:string|null=null;
   if(input.moduleId){const [module]=await db.select<{title:string}>('rep_modules',`select=title&id=eq.${input.moduleId}&active=eq.true&status=eq.published`,{strict:true});if(!module)return reply({error:'Choose a published training'},400);moduleTitle=module.title;}
   const existing=await read(id);
   if(existing){if(existing.createdBy!==db.userId||existing.commitment!==input.commitment||existing.moduleId!==input.moduleId||existing.dueDate!==input.dueDate)return reply({error:'Assignment already exists'},409);return reply({ok:true,assignment:existing});}
   const record:CoachingAssignment={id,agentId,orgId:agent.org_id,createdBy:db.userId,createdAt:new Date().toISOString(),...input,moduleTitle,practiceAt:null,reflection:'',reviewedAt:null,reviewNote:'',outcome:null,passedAt:null,trainingPassed:false};
   await env.SESSIONS.put(prefix+id,JSON.stringify(record));return reply({ok:true,assignment:record});
  }
  const record=await read(id);if(!record||record.agentId!==agentId||record.orgId!==agent.org_id)return reply({error:'Assignment not found'},404);
  if(action==='practice'){
   if(!own)return reply({error:'Only the assigned agent can record their practice'},403);
   const review=await env.SESSIONS.get(`coaching-review:v1:${agent.org_id}:${agentId}:${id}`,'json') as Review|null;
   if(review?.outcome==='complete'||review?.outcome==='cancelled')return reply({error:'This assignment has already been reviewed'},409);
   const reflection=typeof b.reflection==='string'?b.reflection.trim():'';
   if(!reflection||reflection.length>1200)return reply({error:'Describe your practice in up to 1,200 characters'},400);
   const existing=await env.SESSIONS.get(`coaching-practice:v1:${agent.org_id}:${agentId}:${id}`,'json') as Practice|null;
   // A retry must not manufacture a second practice date. After a continue
   // review, the same words may legitimately describe a new submission.
   if(existing?.reflection===reflection&&(!review||existing.practiceAt>review.reviewedAt))return reply({ok:true,patch:{...existing,...historyPatch(existing,review)}});
   const practiceAt=new Date(Math.max(Date.now(),review?Date.parse(review.reviewedAt)+1:0,existing?Date.parse(existing.practiceAt)+1:0)).toISOString();
   const event:CoachingAssignmentEvent={kind:'practice',at:practiceAt,reflection};
   const patch:Practice={practiceAt,reflection,history:[...(existing?.history??[]),event],historyIncomplete:incomplete(existing)};
   await env.SESSIONS.put(`coaching-practice:v1:${agent.org_id}:${agentId}:${id}`,JSON.stringify(patch));return reply({ok:true,patch:{...patch,...historyPatch(patch,review)}});
  }
  if(action==='review'){
   if(!admin)return reply({error:'Only coaches can review work'},403);
   const note=typeof b.reviewNote==='string'?b.reviewNote.trim():'';
   if(!['complete','continue','cancelled'].includes(String(b.outcome))||!note||note.length>1200)return reply({error:'Choose an outcome and add a review note'},400);
   let followUp:{dueDate?:string}={};if(b.outcome==='continue'){try{followUp={dueDate:assignmentInput({commitment:record.commitment,dueDate:b.dueDate}).dueDate};}catch{return reply({error:'Choose the next follow-up date'},400);}}
   const existing=await env.SESSIONS.get(`coaching-review:v1:${agent.org_id}:${agentId}:${id}`,'json') as Review|null;
   const practice=await env.SESSIONS.get(`coaching-practice:v1:${agent.org_id}:${agentId}:${id}`,'json') as Practice|null;
   const dueDate=followUp.dueDate??existing?.dueDate??record.dueDate;
   if(existing&&existing.reviewedBy===db.userId&&existing.reviewNote===note&&existing.outcome===b.outcome&&(existing.dueDate??record.dueDate)===dueDate&&(!practice||practice.practiceAt<=existing.reviewedAt))return reply({ok:true,patch:{...existing,...historyPatch(practice,existing)}});
   if(existing?.outcome==='complete'||existing?.outcome==='cancelled')return reply({error:'This assignment has already been closed'},409);
   const reviewedAt=new Date(Math.max(Date.now(),practice?Date.parse(practice.practiceAt):0,existing?Date.parse(existing.reviewedAt)+1:0)).toISOString();
   const outcome=b.outcome as 'complete'|'continue'|'cancelled';
   const event:CoachingAssignmentEvent={kind:'review',at:reviewedAt,reviewNote:note,outcome,dueDate,previousDueDate:existing?.dueDate??record.dueDate};
   const patch:Review={dueDate,reviewedAt,reviewedBy:db.userId,reviewNote:note,outcome,history:[...(existing?.history??[]),event],historyIncomplete:incomplete(existing)};
   await env.SESSIONS.put(`coaching-review:v1:${agent.org_id}:${agentId}:${id}`,JSON.stringify(patch));return reply({ok:true,patch:{...patch,...historyPatch(practice,patch)}});
  }
  return reply({error:'Unknown action'},400);
 }catch{return reply({error:'Coaching assignments could not be loaded or saved. Please retry.'},503);}
}
