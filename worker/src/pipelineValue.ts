import {inquiryValue,type InquiryEvent,type InquiryValue} from '../../shared/pipelineValue.js';
import type {PipelineRecord,PipelineTeam} from '../../shared/pipeline.js';
import type {Env} from './env.js';
import {db} from './db.js';
import {decryptTeamKey} from './sync.js';
import {fubGet} from './fub.js';
import {PipelineError} from './pipelineSupport.js';

type ValueScope={leads:Array<Pick<PipelineRecord,'key'|'team_id'|'fub_person_id'|'fub_created'|'historicalOnly'>>;teams:Array<Pick<PipelineTeam,'id'|'fub_subdomain'>>};
/** Shared bounded lookup for authorized reports and the per-team collector. */
export async function checkPipelineValues(env:Env,report:ValueScope,keys:unknown):Promise<Record<string,InquiryValue>>{
 if(!Array.isArray(keys)||!keys.length||keys.length>5||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length)
  throw new PipelineError('Choose between one and five distinct leads.',400);
 const leads=keys.map(key=>report.leads.find(l=>l.key===key));
 if(leads.some(l=>!l))throw new PipelineError('A selected lead is outside this report.',403);
 const credentials=new Map<string,string>(),values:Record<string,InquiryValue>={};
 for(const lead of leads){
  if(!lead)continue;
  if(lead.historicalOnly){values[lead.key]=inquiryValue(undefined,true);continue;}
  let key=credentials.get(lead.team_id);
  if(!key){
   key=await decryptTeamKey(env,db(env),lead.team_id);
   const identity=await fubGet(key,'/identity');
   const domain=report.teams.find(t=>t.id===lead.team_id)?.fub_subdomain;
   if(!domain||identity.status!==200||identity.body?.account?.domain!==domain)throw new PipelineError('FUB account identity could not be verified.',502);
   credentials.set(lead.team_id,key);
  }
  const events:InquiryEvent[]=[];let complete=false,next:string|undefined;
  for(let page=0;page<3;page++){
   // Keep below the event API's per-key rate limit, including successive leads.
   await new Promise(resolve=>setTimeout(resolve,2500));
   const response=await fubGet(key,'/events',{personId:lead.fub_person_id,type:'Property Inquiry,Seller Inquiry,Inquiry,General Inquiry',limit:100,...(next?{next}:{})});
   if(response.status!==200||!Array.isArray(response.body?.events))throw new PipelineError('Inquiry lookup failed. Retry; existing pipeline counts are unchanged.',502);
   for(const e of response.body.events){
    if(Number(e.personId)!==lead.fub_person_id)throw new PipelineError('Inquiry identity mismatch.',502);
    events.push({id:e.id,type:e.type,created:e.created,occurred:e.occurred,property:e.property?{price:e.property.price,forRent:e.property.forRent}:undefined,
      paymentSignal:/monthly payment|per month|mortgage assessment|\/month|\/mo\b/i.test([e.message,e.description,JSON.stringify(e.additional)].join(' '))});
   }
   const meta=response.body._metadata || {};
   if(!meta.next&&!meta.nextLink){complete=!(Number(meta.total)>events.length);break;}
   next=meta.next?String(meta.next):undefined;
   if(!next&&meta.nextLink){try{const u=new URL(meta.nextLink);if(u.origin==='https://api.followupboss.com'&&u.pathname==='/v1/events')next=u.searchParams.get('next') || undefined;}catch{/* incomplete */}}
   if(!next)break;
  }
  values[lead.key]=inquiryValue({events,complete,receivedAt:lead.fub_created,checkedAt:new Date().toISOString()});
 }
 return values;
}
