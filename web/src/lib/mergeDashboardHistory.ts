import type {LeadRow,StageLogRow} from './api';
/** Saved milestones remain evidence; live fields and new leads must not disappear beneath a snapshot. */
export function mergeDashboardHistory(saved:LeadRow[],live:LeadRow[],savedLog:StageLogRow[],liveLog:StageLogRow[],teamIds:Set<string>){
 const key=(l:{team_id?:string;fub_person_id?:number|null})=>`${l.team_id}:${l.fub_person_id}`;
 const rows=new Map(saved.map(l=>[key(l),{...l,history:l.history?{...l.history}:undefined}]));
 for(const l of live){if(!teamIds.has(l.team_id))continue;const old=rows.get(key(l));rows.set(key(l),{...old,...l,name:l.name||old?.name,history:old?.history});}
 const logs=new Map<string,StageLogRow>();
 // Existing exact FUB dates take precedence over later observation timestamps.
 for(const l of [...savedLog,...liveLog]){if(!teamIds.has(l.team_id||''))continue;const k=key(l)+':'+l.stage_class;if(!logs.has(k))logs.set(k,l);}
 for(const event of logs.values()){
  const lead=rows.get(key(event));if(!lead||!event.changed_at||event.date_source==='seed')continue;
  const rank=['met','offer','uc','closed'].indexOf(event.stage_class||'');if(rank<0)continue;
  const history=lead.history?{...lead.history}:{};
  for(const category of ['met','offer','uc','closed'].slice(0,rank+1))if(!history[category])history[category]={eventId:'sync:'+event.changed_at,date:event.changed_at,description:'Stage recorded in FUB',kind:category===event.stage_class?'observed':'rule-based',basis:event.stage_class||'',direction:'to'};
  lead.history=history;
 }
 return {leads:[...rows.values()],stageLog:[...logs.values()]};
}
