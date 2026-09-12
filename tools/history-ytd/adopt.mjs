import fs from 'node:fs/promises';
import path from 'node:path';
import {HISTORY_POLICY,HISTORY_START,classifyHistorySource,historyTime} from '../../shared/historyPolicy.ts';
import {readJson,atomicJson,emptyLedger,importReceipt,withLedger,gapsFor,hash} from './ledger.mjs';
const [inventoryPath,auditPath,outDir,requestedCutoff]=process.argv.slice(2);
if(!requestedCutoff)throw Error('Usage: adopt.mjs inventory.json audit.json output-directory fixed-cutoff');
historyTime(requestedCutoff);
const inventory=await readJson(inventoryPath),audit=await readJson(auditPath);
const cutoff=new Date(requestedCutoff).toISOString();
const inCohort=p=>Number.isFinite(Date.parse(p.created))&&Date.parse(p.created)>=historyTime(HISTORY_START)&&Date.parse(p.created)<historyTime(cutoff);
const report={cutoff,from:HISTORY_START,cohortPolicy:'created-ytd-2026-v1',policy:HISTORY_POLICY,inventoryCheckedAt:inventory.checkedAt,teams:[],profiles:[],historicalRequests:0,productionInserts:0,publications:[],classificationReview:[]};
for(const team of inventory.teams){
 const mapping=audit.teams.find(t=>t.team_id===team.id&&t.org_id===team.org_id&&t.fub_subdomain===team.fub_subdomain);
 const row={teamId:team.id,name:team.name,accountId:mapping?.upstream_account_id??null,filesVerified:0,receiptsReused:0,newLocalEvents:0,failed:0,eligible:null,complete:0,unresolved:null,state:'unresolved',blockers:[],rollbackSnapshot:mapping?.historical_snapshot??null};
 report.teams.push(row);
 if(!team.is_active)row.state='inactive';
 else if(!mapping)row.blockers.push('Canonical account mapping is unresolved');
 else{
  await withLedger(path.join(outDir,'ledgers',team.id+'.json'),emptyLedger(row.accountId,team.id,team.org_id),async(ledger,save)=>{
   if(ledger.accountId!==String(row.accountId)||ledger.teamId!==team.id||ledger.orgId!==team.org_id)throw Error('Ledger scope mismatch');
   const prior=mapping.prior_collection;
   if(prior?.artifactDirectory){
    try{
     const inv=await readJson(path.join(prior.artifactDirectory,'inventory.json'));
     if(inv.account!==team.fub_subdomain)throw Error('Prior inventory identity mismatch');
     // Old inventory end is a reporting date, not an exact collection watermark.
     // Conservative boundary deliberately leaves the final reporting day unresolved.
     const through=prior.through+'T00:00:00-07:00';
     for(const person of inv.people){
      if(!inCohort(person))continue;
      try{
       const bytes=await fs.readFile(path.join(prior.artifactDirectory,'leads',String(person.id)+'.json'));
       const receipt=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
       const r=importReceipt(ledger,person,receipt,bytes,{account:team.fub_subdomain,from:HISTORY_START,through,cutoff,paginationComplete:false});
       row.filesVerified++;row.receiptsReused+=r.reused;row.newLocalEvents+=r.inserted;
      }catch(e){row.failed++;ledger.failures.push({personId:String(person.id),reason:e.code==='ENOENT'?'Original receipt unavailable':e.message});}
      if(row.filesVerified%250===0)await save();
     }
     row.checkpointDigest=hash(JSON.stringify(Object.values(ledger.receipts).map(r=>[r.personId,r.contentHash]).sort()));
    }catch(e){row.blockers.push('Saved evidence: '+e.message);}
   }else row.blockers.push('No saved historical collection');
   await save();
   const census=await readJson(path.join(path.dirname(outDir),'census',team.id+'.json')).catch(()=>null);
   const censusValid=census?.complete&&String(census.accountId)===String(row.accountId)&&census.orgId===team.org_id;
   row.censusComplete=!!censusValid;
   const people=censusValid?census.people:[];
   const eligible=people.filter(p=>inCohort(p)&&classifyHistorySource(p.source)==='eligible');
   row.eligible=censusValid?eligible.length:null;
   const gaps=eligible.map(p=>({personId:String(p.id),assignedUserId:p.assignedUserId??null,sourceRaw:p.source,created:p.created,intervals:gapsFor(ledger,p.id,cutoff)}));
   row.complete=censusValid?gaps.filter(p=>p.intervals.length===0).length:0;
   row.unresolved=censusValid?row.eligible-row.complete:null;
   row.state='partial';
   if(!censusValid)row.blockers.push(census?.blocker||'Complete public API census unavailable');
   row.blockers.push('Missing changelogs remain pending; website authentication is limited to two total attempts and must stop on verification challenges');
   if(Object.keys(ledger.receipts).length)row.blockers.push('Legacy pagination evidence is incomplete; saved receipts are collected evidence, not validated interval coverage');
   row.blockers.push('Forward retention is deployed; individual webhook processing and historical/live overlap verification remain pending');
   row.eventsRetained=Object.keys(ledger.events).length;
   row.webhookRegistrations=census?.webhooks??[];
   row.lastReconciliation=team.last_sync_at;
   for(const source of new Set(people.map(p=>p.source).filter(s=>classifyHistorySource(s)==='review')))report.classificationReview.push(source);
   await atomicJson(path.join(outDir,'gaps',team.id+'.json'),{teamId:team.id,accountId:row.accountId,cutoff,policy:HISTORY_POLICY,censusComplete:!!censusValid,people:gaps,blockers:row.blockers});
   for(const profile of inventory.profiles.filter(p=>p.team_id===team.id)){
    const mapped=profile.org_id===team.org_id&&profile.fub_user_id!=null;
    const owned=eligible.filter(p=>String(p.assignedUserId)===String(profile.fub_user_id));
    report.profiles.push({...profile,disposition:profile.excluded?'excluded':!mapped?'unresolved_identity':!censusValid?'unresolved_census':owned.length?'partial':'no_current_eligible_leads',eligible:censusValid?owned.length:null,historicalOwnership:'unresolved; current assignment is not historical ownership'});
   }
  });
 }
}
for(const profile of inventory.profiles)if(!report.profiles.some(p=>p.id===profile.id))report.profiles.push({...profile,disposition:profile.excluded?'excluded':'unresolved_identity',eligible:null});
report.classificationReview=[...new Set(report.classificationReview)].sort();
await atomicJson(path.join(outDir,'coverage-report.json'),report);
console.log(JSON.stringify(report.teams.map(({name,filesVerified,receiptsReused,newLocalEvents,failed,eligible,unresolved})=>({name,filesVerified,receiptsReused,newLocalEvents,failed,eligible,unresolved})),null,2));
