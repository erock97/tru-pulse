import {readJson,atomicJson,hash,gapsFor} from './ledger.mjs';
import {stageCategory} from '../history-pilot/metrics.mjs';
import {HISTORY_START,HISTORY_POLICY,HISTORY_SOURCES,classifyHistorySource} from '../../shared/historyPolicy.ts';
const [censusPath,ledgerPath,profilesPath,account,cutoff,out]=process.argv.slice(2);
if(!out)throw Error('Usage: prepare-snapshot.mjs census ledger profiles account cutoff private-output');
const census=await readJson(censusPath),ledger=await readJson(ledgerPath),profiles=await readJson(profilesPath);
if(String(census.accountId)!==ledger.accountId||census.teamId!==ledger.teamId||census.orgId!==ledger.orgId)throw Error('Snapshot scope mismatch');
const people=census.people.filter(p=>classifyHistorySource(p.source)==='eligible'&&Date.parse(p.created)>=Date.parse(HISTORY_START)&&Date.parse(p.created)<Date.parse(cutoff)).sort((a,b)=>Number(a.id)-Number(b.id));
if(!census.complete||people.some(p=>gapsFor(ledger,p.id,cutoff).length))throw Error('Historical coverage is incomplete');
const stageLog=[],leads=[];
for(const p of people){
 const owners=profiles.filter(a=>a.team_id===census.teamId&&String(a.fub_user_id)===String(p.assignedUserId));
 if(owners.length>1)throw Error('Ambiguous profile association');
 const owner=owners[0];const history={};
 const events=Object.values(ledger.events).filter(e=>e.personId===String(p.id)&&Date.parse(e.occurredAt)<Date.parse(cutoff)).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.kind.localeCompare(b.kind)||a.upstreamId.localeCompare(b.upstreamId));
 for(const e of events){const basis=stageCategory(e.to);if(!basis)continue;const earned=basis==='nurture'?['nurture']:['met','offer','uc','closed'].slice(0,['met','offer','uc','closed'].indexOf(basis)+1);
  for(const category of earned){if(history[category])continue;
   history[category]={eventId:e.upstreamId,date:e.occurredAt,description:e.description??'Stage recorded in FUB',kind:category===basis?'observed':'rule-based',basis,direction:'to'};
   stageLog.push({team_id:census.teamId,fub_person_id:p.id,stage_class:category,changed_at:e.occurredAt,date_source:category!==basis?'cumulative_rule':e.kind==='ChangeLog'?'fub_change_log':'fub_webhook',agent_user_id:p.assignedUserId??null,agent_name:owner?.name??'Unassigned',event_id:e.upstreamId,event_kind:e.kind,basis});
  }
 }
 leads.push({team_id:census.teamId,assigned_to:owner?.name??'Unassigned',fub_person_id:p.id,fub_created:p.created,source_family:p.source,source:p.source,stage:p.stage,flag:null,history});
}
const capturedAt=new Date(Math.max(Date.parse(cutoff),...Object.values(ledger.receipts).map(r=>Date.parse(r.capturedAt)))).toISOString();
const snapshot={version:2,orgId:census.orgId,teamId:census.teamId,account,through:cutoff,capturedAt,sourcePolicyVersion:HISTORY_POLICY,cohortPolicy:'created-ytd-2026-v1',sourceStarts:Object.fromEntries(HISTORY_SOURCES.map(s=>[s,'2026-01-01'])),rosterPolicy:'current-profile-association; preserve exclusions',leads,stageLog};
const versionId=hash(JSON.stringify(snapshot));await atomicJson(out,{versionId,snapshot});console.log(JSON.stringify({versionId,leads:leads.length,milestones:stageLog.length,published:false}));
