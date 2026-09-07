import type { LeadRow, DashboardData } from './api';
import { pulseCutoff, type PulsePeriod } from './pulsePeriod';
export type ConversionCounts={leads:number;contracts:number;perContract:number|null};
export function conversionTrend(leads:LeadRow[]|undefined,current:ConversionCounts,period:PulsePeriod,history:DashboardData['historyInfo'],now=new Date()) {
 const cutoff=pulseCutoff(period,now);
 const missing=(reason:string)=>({prior:null,direction:null,cutoff,reason});
 if(cutoff===null||!leads||!history)return missing('Dated milestone history is not available for this comparison.');
 if(current.leads!==leads.length)return missing('Current and historical lead groups do not match.');
 const through=Date.parse(history.through+'T23:59:59');
 if(!Number.isFinite(through)||cutoff>through)return missing('The comparison date is later than the latest verified records.');
 let count=0,contracts=0;
 for(const lead of leads){
  const start=Date.parse(history.sourceStarts[lead.source_family??'']??'');
  if(!Number.isFinite(start)||cutoff<start)return missing('The comparison date is before the available history for one or more lead sources.');
  const created=Date.parse(lead.fub_created??'');
  if(!Number.isFinite(created))return missing('A lead is missing its creation date.');
  if(created>cutoff)continue;
  count++;
  if(!lead.history)return missing('A lead is missing dated milestone history.');
  const milestones=[lead.history.uc,lead.history.closed].filter(Boolean);
  if(milestones.some(event=>!Number.isFinite(Date.parse(event!.date))))return missing('A contract milestone is missing its date.');
  if(milestones.some(event=>Date.parse(event!.date)<=cutoff))contracts++;
 }
 const prior={leads:count,contracts,perContract:contracts?count/contracts:null};
 if(!count)return {prior,direction:null,cutoff,reason:'No leads were recorded by the comparison date.'};
 const delta=current.contracts*count-contracts*current.leads;
 return {prior,direction:delta>0?'Improving':delta<0?'Declining':'Unchanged',cutoff,reason:null};
}
