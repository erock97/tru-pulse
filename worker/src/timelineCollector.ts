import type {Env} from './env.js';
import type {TeamRow} from './sync.js';

import type {ContactLead,ContactSnapshot} from '../../shared/contactSpeed.js';

type Candidate={id:string;created:string;name:string;assignedUserId:string;assignedTo:string;due:number;checkedAt?:string;error?:string};
type Evidence={lead:ContactLead;checkedAt:string;stages:Array<{id:string;date:string;description:string}>};
const DAY=86400000;
export function refreshDelay(created:string,now=Date.now()){const age=now-Date.parse(created);return age<DAY?5*60000:age<7*DAY?30*60000:6*60*60000;}
export function eligiblePerson(p:any,now=Date.now()){return p.tracked!==false&&/^\d+$/.test(String(p.id))&&Number.isFinite(Date.parse(p.created))&&Date.parse(p.created)>=now-90*DAY&&Date.parse(p.created)<=now&&Number(p.assignedUserId)>0&&!p.assignedPondId;}
/** Retained for existing Durable Objects and historical evidence. Cloud collection is retired. */
export class TimelineCollector {

 constructor(private state:DurableObjectState,_env:Env){}
 async fetch(req:Request){
  await this.state.storage.deleteAlarm();
  if(req.method==='POST')return Response.json({queued:false,disabled:true});
  if(new URL(req.url).pathname==='/counts')return Response.json({});
  const team=await this.state.storage.get<TeamRow>('team');
  if(!team)return Response.json({snapshot:null,health:{state:'disabled',reason:'Cloud timeline login and collection retired'}});
  const now=Date.now(),all=[...await this.state.storage.list<Candidate>({prefix:'person:'})].map(([,p])=>p).filter(p=>eligiblePerson(p,now));

  const leads:ContactLead[]=[];let oldest=Infinity,completed=0,failed=0;
  for(const p of all){
   const ev=await this.state.storage.get<Evidence>('evidence:'+p.id);
   if(p.error)failed++;
   if(ev&&ev.lead.agentId===p.assignedUserId){leads.push(ev.lead);oldest=Math.min(oldest,Date.parse(ev.checkedAt));completed++;}
   else leads.push({orgId:team.org_id,leadId:p.id,leadName:p.name,agentId:p.assignedUserId,agentName:p.assignedTo,leadUrl:'https://'+team.fub_subdomain+'.followupboss.com/2/people/view/'+p.id,createdAt:p.created,historyComplete:false,events:[]});
  }
  const status=await this.state.storage.get<{lastSuccess?:string;lastAttempt?:string;error?:string}>('status')||{};
  const overdue=all.filter(p=>p.due<now-10*60000).length;
  const snapshot:ContactSnapshot={version:1,orgId:team.org_id,from:new Date(now-90*DAY).toISOString(),through:status.lastSuccess||new Date(0).toISOString(),capturedAt:status.lastSuccess||new Date(0).toISOString(),leads};
  return Response.json({snapshot:all.length&&status.lastSuccess?snapshot:null,health:{...status,state:'disabled',reason:'Historical evidence only; cloud collection retired',total:all.length,collected:completed,failed,overdue,oldestEvidenceAt:Number.isFinite(oldest)?new Date(oldest).toISOString():null}});
 }
 async alarm(){
  // Previously persisted alarms may still fire after deployment. Never reschedule.
  await this.state.storage.deleteAlarm();
 }
}
/** Compatibility no-op: API sync and webhook callers must not start collection. */
export async function enqueueTimelines(_env:Env,_team:TeamRow,_people:any[],_priority=false){
 return;
}
