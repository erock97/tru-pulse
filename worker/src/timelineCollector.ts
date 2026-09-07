import {db} from './db.js';
import type {Env} from './env.js';
import type {TeamRow} from './sync.js';
import {FubTimelineSession} from './fubTimeline.js';
import {normalizeContactTimeline} from '../../shared/contactCollection.js';
import type {ContactLead,ContactSnapshot} from '../../shared/contactSpeed.js';

type Candidate={id:string;created:string;name:string;assignedUserId:string;assignedTo:string;due:number;checkedAt?:string;error?:string};
type Evidence={lead:ContactLead;checkedAt:string;stages:Array<{id:string;date:string;description:string}>};
const DAY=86400000;
export function refreshDelay(created:string,now=Date.now()){const age=now-Date.parse(created);return age<DAY?5*60000:age<7*DAY?30*60000:6*60*60000;}
export function eligiblePerson(p:any,now=Date.now()){return p.tracked!==false&&/^\d+$/.test(String(p.id))&&Number.isFinite(Date.parse(p.created))&&Date.parse(p.created)>=now-90*DAY&&Date.parse(p.created)<=now&&Number(p.assignedUserId)>0&&!p.assignedPondId;}
/** One durable queue per team. Alarms run without an open page or a local process. */
export class TimelineCollector {
 private session:FubTimelineSession|null=null;
 private sessionAt=0;
 constructor(private state:DurableObjectState,private env:Env){}
 async fetch(req:Request){
  if(req.method==='POST'){
   const {team,people=[],priority=false}=await req.json() as {team:TeamRow;people:any[];priority?:boolean};
   if(!team?.id||!team.org_id||!team.fub_subdomain||!Array.isArray(people))return new Response('Invalid collector scope',{status:400});
   const existing=await this.state.storage.get<TeamRow>('team');
   if(existing&&(existing.id!==team.id||existing.org_id!==team.org_id||existing.fub_subdomain!==team.fub_subdomain))return new Response('Collector scope changed',{status:409});
   await this.state.storage.put('team',team);
   const now=Date.now();
   for(const p of people){
    const id=String(p.id);if(!/^\d+$/.test(id))continue;
    if(!eligiblePerson(p,now)){await this.state.storage.delete('person:'+id);continue;}
    const old=await this.state.storage.get<Candidate>('person:'+id);
    const owner=String(p.assignedUserId);
    await this.state.storage.put('person:'+id,{id,created:p.created,name:p.name||[p.firstName,p.lastName].filter(Boolean).join(' ')||'Name unavailable',assignedUserId:owner,assignedTo:p.assignedTo||'Agent name unavailable',due:priority||old?.assignedUserId!==owner?now:old?.due??now,checkedAt:old?.checkedAt,error:old?.error} satisfies Candidate);
   }
   if(!await this.state.storage.getAlarm())await this.state.storage.setAlarm(now+1000);
   return Response.json({queued:true});
  }
  const team=await this.state.storage.get<TeamRow>('team');
  if(!team)return Response.json({snapshot:null,health:{state:'not_started'}});
  const now=Date.now(),all=[...await this.state.storage.list<Candidate>({prefix:'person:'})].map(([,p])=>p).filter(p=>eligiblePerson(p,now));
  if(new URL(req.url).pathname==='/counts'){
   const counts:Record<string,number>={};
   for(const p of all){const ev=await this.state.storage.get<Evidence>('evidence:'+p.id);if(ev?.lead.agentId===p.assignedUserId)counts[p.id]=ev.lead.events.filter(e=>e.channel==='zillow_message'&&e.direction==='outbound'&&e.personal===true&&e.agentId===p.assignedUserId&&!/not delivered|failed/i.test(e.deliveryStatus||'')).length;}
   return Response.json(counts);
  }
  const leads:ContactLead[]=[];let oldest=Infinity,completed=0,failed=0;
  for(const p of all){
   const ev=await this.state.storage.get<Evidence>('evidence:'+p.id);
   if(p.error)failed++;
   if(ev&&ev.lead.agentId===p.assignedUserId){leads.push(ev.lead);oldest=Math.min(oldest,Date.parse(ev.checkedAt));completed++;}
   else leads.push({orgId:team.org_id,leadId:p.id,leadName:p.name,agentId:p.assignedUserId,agentName:p.assignedTo,leadUrl:'https://'+team.fub_subdomain+'.followupboss.com/2/people/view/'+p.id,createdAt:p.created,historyComplete:false,events:[]});
  }
  const status=await this.state.storage.get<{lastSuccess?:string;lastAttempt?:string;error?:string}>('status')||{};
  const overdue=all.filter(p=>p.due<now-10*60000).length;
  const snapshot:ContactSnapshot={version:1,orgId:team.org_id,from:new Date(now-90*DAY).toISOString(),through:new Date(now).toISOString(),capturedAt:status.lastSuccess||new Date(now).toISOString(),leads};
  return Response.json({snapshot:all.length?snapshot:null,health:{...status,state:status.error||failed?'attention':overdue?'catching_up':completed<all.length?'collecting':'current',total:all.length,collected:completed,failed,overdue,oldestEvidenceAt:Number.isFinite(oldest)?new Date(oldest).toISOString():null}});
 }
 private async recordStatus(team:TeamRow,status:Record<string,unknown>){
  await this.state.storage.put('status',status);
  await this.env.SESSIONS?.put('collector-health:v1:'+team.id,JSON.stringify(status)).catch(()=>{});
 }
 async alarm(){
  // Schedule the next attempt first: a crash cannot strand the queue.
  await this.state.storage.setAlarm(Date.now()+60000);
  const team=await this.state.storage.get<TeamRow>('team');if(!team)return;
  const now=Date.now();
  const candidates=[...await this.state.storage.list<Candidate>({prefix:'person:'})].map(([,p])=>p);
  for(const p of candidates)if(!eligiblePerson(p,now)){await this.state.storage.delete('person:'+p.id);await this.state.storage.delete('evidence:'+p.id);}
  const due=candidates.filter(p=>eligiblePerson(p,now)&&p.due<=now).sort((a,b)=>a.due-b.due).slice(0,12);
  if(!due.length)return;
  const oldStatus=await this.state.storage.get<Record<string,string>>('status')||{};
  let lastSuccess=oldStatus.lastSuccess;
  try{
   if(!this.session||now-this.sessionAt>30*60000){
    const active=await db(this.env).select('teams',`id=eq.${team.id}&org_id=eq.${team.org_id}&is_active=eq.true&select=id`);
    if(!active.length){await this.state.storage.deleteAlarm();return;}
    this.session=new FubTimelineSession(team.fub_subdomain!);await this.session.login(this.env);this.sessionAt=now;}
   for(const p of due){
    try{
     const person=await this.session.json('/api/v1/people/'+p.id);
     if(String(person.id)!==p.id||Date.parse(person.created)!==Date.parse(p.created)||String(person.assignedUserId)!==p.assignedUserId)throw Error('Contact ownership changed; awaiting FUB sync');
     const rows=await this.session.timeline(p.id);
     const events=normalizeContactTimeline(rows,p.id);
     const checkedAt=new Date().toISOString();
     // Complete pagination proves records were read, not that an unrecorded conversation never happened.
     const lead:ContactLead={orgId:team.org_id,leadId:p.id,leadName:person.name||p.name,agentId:p.assignedUserId,agentName:person.assignedTo||p.assignedTo,leadUrl:'https://'+team.fub_subdomain+'.followupboss.com/2/people/view/'+p.id,createdAt:p.created,collectedAt:checkedAt,historyComplete:false,events};
     const stages=rows.filter(r=>r.type==='ChangeLog'&&typeof r.item?.name==='string'&&r.item.name.startsWith('Stage changed')).map(r=>({id:String(r.id),date:r.item.date||r.date,description:r.item.name}));
     await this.state.storage.put('evidence:'+p.id,{lead,checkedAt,stages} satisfies Evidence);
     // A webhook may have changed ownership while network reads were in flight.
     const latest=await this.state.storage.get<Candidate>('person:'+p.id);
     if(latest?.assignedUserId===p.assignedUserId)await this.state.storage.put('person:'+p.id,{...latest,checkedAt,error:undefined,due:Date.now()+refreshDelay(p.created)});
     lastSuccess=checkedAt;
    }catch(e){
     const latest=await this.state.storage.get<Candidate>('person:'+p.id);
     if(latest)await this.state.storage.put('person:'+p.id,{...latest,error:(e as Error).message,due:Date.now()+5*60000});
     this.session=null;
     throw e;
    }
   }
   await this.recordStatus(team,{lastAttempt:new Date().toISOString(),lastSuccess,total:candidates.length});
  }catch(e){await this.recordStatus(team,{lastAttempt:new Date().toISOString(),lastSuccess,total:candidates.length,error:(e as Error).message});await this.state.storage.setAlarm(Date.now()+5*60000);}
 }
}
export async function enqueueTimelines(env:Env,team:TeamRow,people:any[],priority=false){
 if(!env.TIMELINES)return;
 const r=await env.TIMELINES.get(env.TIMELINES.idFromName(team.id)).fetch('https://collector/enqueue',{method:'POST',body:JSON.stringify({team,people,priority})});
 if(!r.ok)throw Error('Automatic timeline queue rejected');
}
