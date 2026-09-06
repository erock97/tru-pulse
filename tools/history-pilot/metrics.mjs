export const categories=['met','offer','uc','closed','nurture'];
export const labels={met:'Met with',offer:'Offers',uc:'Under contract',closed:'Closed',nurture:'Nurture'};
export const defaultMap={'Met with Customer':'met','Submitting Offers':'offer','Under Contract':'uc','Pending':'uc','Closed':'closed','Nurture':'nurture'};
export function stageCategory(stage,mapping=defaultMap){const key=String(stage??'').trim().toLowerCase();return Object.entries(mapping).find(([name])=>name.toLowerCase()===key)?.[1];}
export function day(value,timezone='UTC') {const d=new Date(value);if(!value||!Number.isFinite(+d))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
export function parseStage(event) {
 const m=event.description?.match(/^Stage changed from (.+?) to (.+?)(?: by user-id=(\d+)| by metadata-system-client-id=(\d+) automatically| by action-plan-id=(\d+) action plan)?$/);
 if(!m||!event.id||!day(event.date)||/ by [\w-]+-id=/.test(m[2]))return null;
 return {...event,from:m[1],to:m[2],actorId:m[3]?Number(m[3]):null};
}
export function leadProof(person,history,{end,timezone='UTC',mapping=defaultMap}) {
 const proof=Object.fromEntries(categories.map(k=>[k,[]]));const unknown=[];const seen=new Set();
 for(const event of history?.stageEvents??[]) {
  if(seen.has(event.id))continue;seen.add(event.id);
  const parsed=parseStage(event);if(!parsed){unknown.push(event);continue;}
  if(day(event.date,timezone)>end)continue;
  for(const [direction,stage] of [['from',parsed.from],['to',parsed.to]]) {
   const category=stageCategory(stage,mapping);if(!categories.includes(category))continue;
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
  if(stageCategory(p.stage,mapping)==='nurture')row.nurtureNow++;
 }
 return [...agents.values()].map(a=>({...a,total:a.leads.length,nurturePct:100*a.nurtureNow/a.leads.length,rawConversion:100*a.counts.closed/a.leads.length})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
}
// First earned credit is stable across reporting windows. Skipped stages receive
// the qualifying later event's timestamp, per Eric's explicit attribution rule.
// A departing stage alone proves occupancy, but not when it was first earned.
export function datedCredits(person,history,mapping=defaultMap) {
 const result=new Map(),seen=new Set();
 const events=(history?.stageEvents??[]).map(parseStage).filter(Boolean).sort((a,b)=>new Date(a.date)-new Date(b.date)||String(a.id).localeCompare(String(b.id)));
 for(const e of events){if(seen.has(e.id))continue;seen.add(e.id);
  const category=stageCategory(e.to,mapping);if(!categories.includes(category))continue;
  const earned=category==='nurture'?['nurture']:['met','offer','uc','closed'].slice(0,['met','offer','uc','closed'].indexOf(category)+1);
  for(const k of earned)if(!result.has(k))result.set(k,{personId:person.id,agentId:String(person.assignedUserId??'unassigned'),agent:person.assignedTo||'Unassigned',category:k,date:e.date,eventId:e.id,description:e.description,basis:category,kind:k===category?'observed':'rule-based'});
 }
 return [...result.values()];
}
export function productionByPeriod(data,{start,end,timezone='UTC',source='*',mapping=defaultMap}) {
 if(!start||!end||start>end)throw Error('Choose a valid date range.');
 return data.people.filter(p=>source==='*'||p.source===source).flatMap(p=>datedCredits(p,data.histories[String(p.id)],mapping)).filter(e=>{const d=day(e.date,timezone);return d>=start&&d<=end;});
}
