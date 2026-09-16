import type {PipelineReport} from './pipeline';

/** Checks report arithmetic and drilldown membership, not upstream completeness. */
export function reconcilePipeline(report:PipelineReport){
 const issues:string[]=[];
 const keys=report.leads.map(l=>l.key),unique=new Set(keys);
 const same=(a:string[],b:string[])=>{const expected=new Set(b);return a.length===b.length&&new Set(a).size===a.length&&a.every(k=>expected.has(k));};
 const pct=(n:number,d:number)=>d?n/d*100:null;
 const matchPct=(a:number|null,b:number|null)=>a===b||a!==null&&b!==null&&Math.abs(a-b)<1e-9;
 const checkCounts=(row:PipelineReport['totals'],leads:PipelineReport['leads'],label:string)=>{
  const conversions=leads.filter(l=>['closed','under_contract'].includes(l.category)).length;
  const nurture=leads.filter(l=>l.category==='nurture').length,rejected=leads.filter(l=>l.category==='rejected').length;
  if(row.total!==leads.length||row.conversions!==conversions||row.nurture!==nurture||row.rejected!==rejected||
   !matchPct(row.conversionRate,pct(conversions,leads.length))||!matchPct(row.nurturePct,pct(nurture,leads.length))||!matchPct(row.rejectedPct,pct(rejected,leads.length)))issues.push(label+' counts or rates');
 };
 checkCounts(report.totals,report.leads,'Team');
 if(unique.size!==keys.length)issues.push('Duplicate lead identities');
 if(report.totals.total!==keys.length)issues.push('Team lead total');
 for(const [metric,category] of [['conversions',null],['nurture','nurture'],['rejected','rejected']] as const){
  const actual=report.leads.filter(l=>category?l.category===category:['closed','under_contract'].includes(l.category)).length;
  if(report.totals[metric]!==actual)issues.push('Team '+metric);
 }
 if(!same(report.agents.flatMap(a=>a.leadKeys),keys))issues.push('Ownership reconciliation');
 if(!same(report.stages.flatMap(s=>s.leadKeys),keys))issues.push('Current-stage reconciliation');
 for(const row of report.agents){
  checkCounts(row,report.leads.filter(l=>l.ownerKey===row.key),'Owner '+row.key);
  if(!matchPct(row.leadShare,pct(row.total,report.totals.total))||!matchPct(row.conversionShare,pct(row.conversions,report.totals.conversions)))issues.push('Owner contribution '+row.key);
  if(row.total!==row.leadKeys.length||!same(row.leadKeys,report.leads.filter(l=>l.ownerKey===row.key).map(l=>l.key)))issues.push('Owner drilldown '+row.key);
 }
 for(const row of report.stages){
  if(!matchPct(row.percent,pct(row.count,report.totals.total)))issues.push('Stage percentage '+row.key);
  if(row.count!==row.leadKeys.length||!same(row.leadKeys,report.leads.filter(l=>l.stageKey===row.key).map(l=>l.key)))issues.push('Stage drilldown '+row.key);
 }
 for(const row of report.progression){
  if(!matchPct(row.percent,pct(row.count,report.totals.total)))issues.push('Progression percentage '+row.key);
  if(row.count!==row.leadKeys.length||!same(row.leadKeys,report.leads.filter(l=>!!l.progress[row.key]).map(l=>l.key)))issues.push('Progression drilldown '+row.key);
 }
 return {ok:issues.length===0,issues,leadCount:keys.length,snapshotId:report.snapshotId};
}
