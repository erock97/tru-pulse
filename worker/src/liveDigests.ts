import type {Env} from './env.js';
import {db,type Db} from './db.js';
import type {LiveFollowup} from '../../shared/liveWorkshops.js';
import {assignmentAwaitingReview,assignmentClosed} from '../../shared/coachingAssignments.js';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function dateInZone(now:Date,timezone:string):string{
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');
}
export function digestItems(records:LiveFollowup[],now:Date){return records.filter(r=>!assignmentClosed(r)&&(r.dueDate<=dateInZone(now,r.timezone)||assignmentAwaitingReview(r)));}
export function digestEmail(items:LiveFollowup[],origin:string):{subject:string;html:string}{
 const link=new URL('/#/rep',origin).toString();
 return {subject:`TRU Rep: ${items.length} coaching follow-up${items.length===1?'':'s'} to review`,html:`<h1>Your training follow-up</h1><p>Work is due or awaiting review. Open Rep for the full assignment and private feedback.</p><ul>${items.map(a=>`<li>${escape(a.moduleTitle??'Training')} — day ${a.checkpoint} check · due ${escape(a.dueDate)} (${escape(a.timezone)})</li>`).join('')}</ul><p><a href="${escape(link)}">Open Rep</a></p>`};
}
/** Sends only after both feature flags are enabled. Provider idempotency and a durable
 * lease prevent duplicate mail when cron overlaps or a network acknowledgement is lost. */
export async function runLiveDigests(env:Env,now=new Date(),database:Db=db(env)){
 if(env.REP_LIVE_SESSIONS!=='1'||env.REP_LIVE_DIGESTS!=='1')return {sent:0,failed:0};
 const rows: {id:string;record:LiveFollowup}[]=[];
 for(let offset=0;;offset+=1000){const page=await database.select('rep_live_followups',`select=id,record&order=due_date.asc,id.asc&limit=1000&offset=${offset}`);rows.push(...page);if(page.length<1000)break;}
 const items=digestItems(rows.map(r=>({...r.record,id:r.id})),now);
 const recipients=new Map<string,LiveFollowup[]>();
 const agents=items.length?await database.select('agents',`select=id,auth_id&id=in.(${[...new Set(items.map(x=>x.agentId))].join(',')})`):[];
 for(const item of items){
  const owner=agents.find(a=>a.id===item.agentId)?.auth_id;
  for(const userId of new Set([owner,item.coachId].filter(Boolean)))recipients.set(userId,[...(recipients.get(userId)??[]),item]);
 }
 let sent=0,failed=0;
 for(const [userId,assignments] of recipients){
  // One recipient/day even when several sessions have different timezones.
  const timezone=assignments[0].timezone,day=dateInZone(now,timezone);
  const localHour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(now));
  if(localHour<8)continue;
  let to='';
  try{
  const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/admin/users/${userId}`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
  if(!response.ok)throw Error('Training digest recipient lookup failed');
  const user=await response.json() as {email?:string};
  to=user.email??'';if(!to)throw Error('Training digest recipient has no email');
  }catch(error){
   await database.rpc('rep_live_digest_lookup_failure',{p_user:userId,p_day:day,p_message:error instanceof Error?error.message:'Recipient lookup failed'});failed++;continue;
  }
  const payload=digestEmail(assignments,env.APP_ORIGIN??'https://app.truhq.co');
  const claim=await database.rpc('rep_live_digest_claim',{p_user:userId,p_day:day,p_email:to,p_payload:payload});
  if(!claim)continue;
  try{
   if(!env.RESEND_API_KEY||!env.INVITE_FROM||!to)throw Error('Training digest email configuration or recipient missing');
   const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':claim.idempotency_key},body:JSON.stringify({from:env.INVITE_FROM,to:[claim.recipient],...claim.payload})});
   if(!res.ok)throw Error(`Email provider returned ${res.status}`);
   const accepted=await res.json() as {id?:string};
   await database.update('rep_live_digests',`user_id=eq.${userId}&day=eq.${day}`,{status:'sent',provider_id:accepted.id??null,last_error:null,updated_at:now.toISOString()});sent++;
  }catch(error){
   await database.update('rep_live_digests',`user_id=eq.${userId}&day=eq.${day}`,{status:'failed',last_error:error instanceof Error?error.message:'Email delivery failed',updated_at:now.toISOString()});failed++;
  }
 }
 return {sent,failed};
}
