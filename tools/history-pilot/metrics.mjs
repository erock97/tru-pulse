export const categories=['met','offer','uc','closed','nurture'];
export const labels={met:'Met with',offer:'Offers',uc:'Under contract',closed:'Closed',nurture:'Nurture'};
export const defaultMap={'Met with Customer':'met','Submitting Offers':'offer','Under Contract':'uc','Pending':'uc','Closed':'closed','Nurture':'nurture'};
export function day(value,timezone='UTC') {const d=new Date(value);if(!value||!Number.isFinite(+d))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
export function parseStage(event) {
 const m=event.description?.match(/^Stage changed from (.+?) to (.+?)(?: by user-id=(\d+)| by metadata-system-client-id=(\d+) automatically)?$/);
 if(!m||!event.id||!day(event.date))return null;
 return {...event,from:m[1],to:m[2],actorId:m[3]?Number(m[3]):null};
}
export function leadProof(person,history,{end,timezone='UTC',mapping=defaultMap}) {
 const proof=Object.fromEntries(categories.map(k=>[k,[]]));const unknown=[];const seen=new Set();
 for(const event of history?.stageEvents??[]) {
  if(seen.has(event.id))continue;seen.add(event.id);
  const parsed=parseStage(event);if(!parsed){unknown.push(event);continue;}
  if(day(event.date,timezone)>end)continue;
  for(const [direction,stage] of [['from',parsed.from],['to',parsed.to]]) {
   const category=mapping[stage];if(!categories.includes(category))continue;
   const rank=['met','offer','uc','closed'].indexOf(category);
   const earned=category==='nurture'?['nurture']:['met','offer','uc','closed'].slice(0,rank+1);
   for(const k of earned)proof[k].push({eventId:event.id,date:event.date,description:event.description,stage,direction,kind:k===category?'observed':'rule-based',basis:category});
  }
 }
 return {person,complete:history?.status==='complete',proof,unknown};
}
export function calculate(data,options) {
 const {start,end,timezone='UTC',source='*',mapping=defaultMap}=options;
 if(!start||!end||start>end)throw Error('Choose a valid date range.');
 const selected=data.people.filter(p=>{const d=day(p.created,timezone);return d&&d>=start&&d<=end&&(source==='*'||p.source===source)});
 const agents=new Map();
 for(const p of selected) {
  const id=String(p.assignedUserId??'unassigned');
  if(!agents.has(id))agents.set(id,{id,name:p.assignedTo||'Unassigned',leads:[],counts:Object.fromEntries(categories.map(k=>[k,0])),nurtureNow:0,incomplete:0,unknown:0});
  const row=agents.get(id),e=leadProof(p,data.histories[String(p.id)],{...options,mapping});
  row.leads.push(e);if(!e.complete)row.incomplete++;row.unknown+=e.unknown.length;
  for(const k of categories)if(e.proof[k].length)row.counts[k]++;
  if(mapping[p.stage]==='nurture')row.nurtureNow++;
 }
 return [...agents.values()].map(a=>({...a,total:a.leads.length,nurturePct:100*a.nurtureNow/a.leads.length})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
}
