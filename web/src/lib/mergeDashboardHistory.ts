import type {LeadRow,StageLogRow} from './api';
/** Saved milestones remain evidence; live fields and new leads must not disappear beneath a snapshot. */
export function mergeDashboardHistory(saved:LeadRow[],live:LeadRow[],savedLog:StageLogRow[],liveLog:StageLogRow[],teamIds:Set<string>,sourceStarts?:Record<string,string>){
 const key=(l:{team_id?:string;fub_person_id?:number|null})=>`${l.team_id}:${l.fub_person_id}`;
 const rows=new Map(saved.map(l=>[key(l),{...l,history:l.history?{...l.history}:undefined}]));
 for(const l of live){
  if(!teamIds.has(l.team_id))continue;const old=rows.get(key(l));
  // The historical report uses exact paid-source labels and configured start dates.
  // A live sync contains additional sources: never silently broaden its denominator.
  const source=l.source||old?.source_family||l.source_family||'';
  if(sourceStarts&&old){
   rows.set(key(l),{...old,...l,source_family:old.source_family,name:l.name||old.name,history:old.history});
   continue;
  }
  if(sourceStarts){const start=Object.entries(sourceStarts).find(([label])=>label.trim().replace(/\s+/g,' ').toLowerCase()===source.trim().replace(/\s+/g,' ').toLowerCase())?.[1];const created=Date.parse(l.fub_created||'');
   if(!start||!Number.isFinite(created))continue;
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(created);
   if(day<start)continue;
  }
  rows.set(key(l),{...old,...l,source_family:sourceStarts?source:l.source_family,name:l.name||old?.name,history:old?.history});
 }
 const logs=new Map<string,StageLogRow>();
 // Existing exact FUB dates take precedence over later observation timestamps.
 const evidenced=(l:StageLogRow)=>['fub_change_log','fub_webhook','cumulative_rule'].includes(l.date_source||'');
 for(const l of [...savedLog,...liveLog]){
  if(!teamIds.has(l.team_id||''))continue;const k=key(l)+':'+l.stage_class,old=logs.get(k);
  const dated=l.date_source!=='seed'&&Number.isFinite(Date.parse(l.changed_at||''));
  const oldDated=old&&old.date_source!=='seed'&&Number.isFinite(Date.parse(old.changed_at||''));
  if(!old||dated&&(!oldDated||evidenced(l)&&!evidenced(old)||evidenced(l)===evidenced(old)&&Date.parse(l.changed_at!)<Date.parse(old.changed_at!)))logs.set(k,l);
 }
 for(const event of logs.values()){
  const lead=rows.get(key(event));if(!lead||!event.changed_at||event.date_source==='seed')continue;
  const rank=['met','offer','uc','closed'].indexOf(event.stage_class||'');if(rank<0)continue;
  const history=lead.history?{...lead.history}:{};
  for(const category of ['met','offer','uc','closed'].slice(0,rank+1))if(!history[category]||evidenced(event)&&Date.parse(event.changed_at)<Date.parse(history[category]!.date||''))history[category]={eventId:event.event_id||'sync:'+event.changed_at,date:event.changed_at,description:'Stage recorded in FUB',kind:category===(event.basis||event.stage_class)?'observed':'rule-based',basis:event.basis||event.stage_class||'',direction:'to'};
  lead.history=history;
 }
 return {leads:[...rows.values()],stageLog:[...logs.values()]};
}
