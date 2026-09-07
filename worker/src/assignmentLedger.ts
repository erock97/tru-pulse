type Person={id:number;name:string;assignedUserId:number|null;assignedTo:string|null;assignedPondId?:number|null;created:string;updated?:string};
type Seen={agentId:string|null;seenAt:string;sourceUpdated:string;created:string};
export function assignmentObservation(previous:Seen|undefined,p:Person,now:string){
 const agentId=p.assignedPondId?null:p.assignedUserId?String(p.assignedUserId):null;
 const sourceUpdated=p.updated||p.created;
 if(previous&&Date.parse(sourceUpdated)<Date.parse(previous.sourceUpdated))return null;
 const next={agentId,seenAt:now,sourceUpdated,created:p.created};
 if(previous?.agentId===agentId||!agentId)return {next,event:null};
 return {next,event:{leadId:String(p.id),leadName:p.name,agentId,agentName:p.assignedTo||'',from:previous?.seenAt||p.created,through:now}};
}
export class AssignmentLedger {
 constructor(private state:DurableObjectState){}
 async fetch(req:Request):Promise<Response>{
 const url=new URL(req.url);
 if(req.method==='POST'){
  const body=await req.json() as {people:Person[]};
  if(!Array.isArray(body.people)||body.people.length>20000)return Response.json({error:'Invalid batch'},{status:400});
  const now=new Date().toISOString();
  await this.state.storage.transaction(async tx=>{
   for(const p of body.people){if(!Number.isInteger(p.id)||!Number.isFinite(Date.parse(p.created)))continue;
    const previous=await tx.get<Seen>('person:'+p.id),result=assignmentObservation(previous,p,now);if(!result)continue;
    await tx.put('person:'+p.id,result.next);
    if(result.event)await tx.put('event:'+now+':'+p.id+':'+result.event.agentId,result.event);
   }
   await tx.put('lastSyncAt',now);
  });
  return Response.json({ok:true});
 }
 const zone=url.searchParams.get('timezone')||'UTC';
 let month:(date:string)=>string;
 try {const f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit'});month=date=>f.format(new Date(date));month(new Date().toISOString());}catch{return Response.json({error:'Invalid timezone'},{status:400});}
 const current=month(new Date().toISOString());
 const entries=await this.state.storage.list<{leadId:string;leadName:string;agentId:string;agentName:string;from:string;through:string}>({prefix:'event:'});
 const agents=new Map<string,{agentId:string;agentName:string;count:number;leads:{leadId:string;leadName:string}[]}>();let uncertain=0;
 for(const e of entries.values()){
  if(month(e.through)!==current)continue;
  if(month(e.from)!==current){uncertain++;continue;}
  const a=agents.get(e.agentId)||{agentId:e.agentId,agentName:e.agentName,count:0,leads:[]};
  if(!a.leads.some(l=>l.leadId===e.leadId)){a.leads.push({leadId:e.leadId,leadName:e.leadName});a.count++;}agents.set(e.agentId,a);
 }
 return Response.json({agents:[...agents.values()],lastSyncAt:await this.state.storage.get('lastSyncAt')||null,timezone:zone,uncertain,coverage:'observed_assignments'});
 }
}
