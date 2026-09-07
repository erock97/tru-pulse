/** Read-only reconciliation of private Pulse snapshots. Never commit the input snapshots. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const ts=require('typescript');
const source=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const uri=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const periodUrl=uri(compile(source('../web/src/lib/pulsePeriod.ts')));
const {conversionTrend}=await import(uri(compile(source('../web/src/lib/conversionTrend.ts')).replace("'./pulsePeriod'",JSON.stringify(periodUrl))));
const {pulseCutoff}=await import(periodUrl);
const now=new Date(process.env.AUDIT_NOW||'2026-09-07T17:00:00Z');
const periods=[7,14,'mtd',90,'6mo',365,'ytd','2yr'];
const reports=[];
for(const file of process.argv.slice(2)){
 const s=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const groups=new Map();const seen=new Set();let duplicates=0,invalidCreated=0,futureCreated=0,wrongTeam=0,ledgerMismatch=0,changedOwner=0;
 const hits=new Map();
 for(const h of s.stageLog){if(h.team_id!==s.teamId){wrongTeam++;continue;}if(!['uc','closed'].includes(h.stage_class))continue;const rows=hits.get(h.fub_person_id)||[];rows.push(h);hits.set(h.fub_person_id,rows);}
 for(const l of s.leads){
  if(seen.has(l.fub_person_id))duplicates++;seen.add(l.fub_person_id);
  if(l.team_id!==s.teamId)wrongTeam++;
  const created=Date.parse(l.fub_created);if(!Number.isFinite(created)){invalidCreated++;continue;}if(created>now.getTime()){futureCreated++;continue;}
  const group=groups.get(l.assigned_to)||[];group.push(l);groups.set(l.assigned_to,group);
  const ledger=hits.get(l.fub_person_id)||[];
  if(!!(l.history?.uc||l.history?.closed)!==!!ledger.length)ledgerMismatch++;
  if(ledger.some(h=>h.agent_name&&h.agent_name.trim().toLowerCase()!==l.assigned_to.trim().toLowerCase()))changedOwner++;
 }
 const agents=[];let checks=0;const mismatches=[];let missingComparisons=0;
 for(const [agent,leads] of groups){
  const current={leads:leads.length,contracts:leads.filter(l=>l.history?.uc||l.history?.closed).length};current.perContract=current.contracts?current.leads/current.contracts:null;
  const ledgerCurrent=leads.filter(l=>(hits.get(l.fub_person_id)||[]).length).length;
  if(current.contracts!==ledgerCurrent)mismatches.push({agent,field:'current',app:current.contracts,ledger:ledgerCurrent});
  checks++;
  const comparisons=[];
  for(const period of periods){
   const result=conversionTrend(leads,current,period,s,now);
   if(!result.prior){missingComparisons++;comparisons.push({period,unavailable:result.reason});continue;}
   const cutoff=pulseCutoff(period,now),cohort=leads.filter(l=>Date.parse(l.fub_created)<=cutoff);
   const contracts=cohort.filter(l=>(hits.get(l.fub_person_id)||[]).some(h=>Date.parse(h.changed_at)<=cutoff)).length;
   const delta=current.contracts*cohort.length-contracts*current.leads;
   const direction=cohort.length?(delta>0?'Improving':delta<0?'Declining':'Unchanged'):null;
   if(result.prior.leads!==cohort.length||result.prior.contracts!==contracts||result.direction!==direction)mismatches.push({agent,period,app:result,ledger:{leads:cohort.length,contracts,direction}});
   checks++;comparisons.push({period,leads:cohort.length,contracts,direction});
  }
  agents.push({agent,...current,comparisons});
 }
 reports.push({account:s.account,orgId:s.orgId,through:s.through,sourceStarts:s.sourceStarts,rosterPolicy:s.rosterPolicy,leads:s.leads.length,events:s.stageLog.length,agentCount:groups.size,checks,missingComparisons,duplicates,invalidCreated,futureCreated,wrongTeam,ledgerMismatch,changedOwner,mismatches,agents});
}
console.log(JSON.stringify({checkedAt:now.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,reports},null,2));
if(reports.some(r=>r.mismatches.length||r.duplicates||r.invalidCreated||r.futureCreated||r.wrongTeam||r.ledgerMismatch))process.exitCode=1;
