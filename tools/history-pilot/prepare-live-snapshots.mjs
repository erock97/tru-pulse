import fs from 'node:fs/promises';
import path from 'node:path';
import {calculate,leadProof,datedCredits} from './metrics.mjs';
const root=path.resolve(process.argv[2]);
const mapping=[
 ['COSTIGAN','bfada794-d88a-401c-80db-74b106178c86','cb0fcbbb-c332-4f61-90f8-2b51b673bca8','compass627'],
 ['SIGNATURE','100630b4-4bd0-4f74-bf70-4bf798f7ef9c','3a84fd98-13f2-46e7-83a2-a1ed3aeadab7','signaturerealtynj28'],
 ['SCOTTMOORE','9e61053e-196d-47c1-af69-3d1573e5734f','8b61c008-c8b1-4fb6-9de7-093b21a09a22','themooregroupe'],
 ['SATISH','1ce65a99-c7d1-45f0-8140-ed387c2f6359','df216d4d-b05e-4ddf-a84e-0d685182d692','sbrealty'],
 ['SYNERGY','aecd859e-20bf-4648-9526-1d9904a794c4','213f7da9-6c3d-425e-86e6-a32d16db32a3','elnewhome'],
 ['WOOSLEY','fed61cea-31cd-4d26-a195-9772a8ecfc9c','96ddb98f-1fb6-4d99-80f6-20ef615dec34','woosleygroup']
];
const writes=[],receipts=[];
for(const [tag,orgId,teamId,account] of mapping){
 const dir=path.join(root,tag),inventory=JSON.parse(await fs.readFile(path.join(dir,'inventory.json'),'utf8'));
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'verified-manifest.json'),'utf8'));
 if(inventory.account!==account||manifest.account!==account||manifest.status!=='complete'||manifest.complete!==inventory.people.length)throw Error(`Unverified ${tag}`);
 const histories={};for(const person of inventory.people){const h=JSON.parse(await fs.readFile(path.join(dir,'leads',person.id+'.json'),'utf8'));if(h.account!==account||h.personId!==person.id||h.status!=='complete')throw Error('Contact ownership/completeness failed');histories[person.id]=h;}
 const data={...inventory,histories};
 const options={start:inventory.start,end:inventory.end,timezone:inventory.timezone};
 const expected=JSON.parse(await fs.readFile(path.join(dir,'summary.json'),'utf8')).totals;
 const rows=calculate(data,options),counts=rows.reduce((a,r)=>{a.leads+=r.total;for(const k of ['met','offer','uc','closed','nurture'])a[k]+=r.counts[k];return a;},{leads:0,met:0,offer:0,uc:0,closed:0,nurture:0});
 for(const k in counts)if(counts[k]!==expected[k])throw Error(`${tag} ${k} mismatch`);
 const leads=data.people.map(p=>{
   const {proof}=leadProof(p,histories[p.id],options);
   const history=Object.fromEntries(Object.entries(proof).map(([k,items])=>[k,items.length?items.slice().sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0]:null]));
   return {team_id:teamId,assigned_to:p.assignedTo,fub_person_id:p.id,fub_created:p.created,source_family:p.source,stage:p.stage,flag:null,history};
 });
 const stageLog=data.people.flatMap(p=>datedCredits(p,histories[p.id]).map(e=>({team_id:teamId,fub_person_id:p.id,stage_class:e.category,changed_at:e.date,date_source:e.kind==='observed'?'fub_change_log':'cumulative_rule',agent_user_id:e.agentId,agent_name:e.agent,event_id:e.eventId,basis:e.basis})));
 const snapshot={version:1,orgId,teamId,account,through:inventory.end,capturedAt:inventory.snapshotAt,sourceStarts:inventory.sourceStarts,rosterPolicy:inventory.rosterPolicy,leads,stageLog};
 const value=JSON.stringify(snapshot);if(Buffer.byteLength(value)>24*1024*1024)throw Error('Snapshot exceeds bound');
 writes.push({key:`pulse-history:v1:${orgId}`,value});receipts.push({tag,orgId,teamId,account,counts,bytes:Buffer.byteLength(value),through:inventory.end});
}
await fs.writeFile(path.join(root,'live-snapshot-upload.private.json'),JSON.stringify(writes));
await fs.writeFile(path.join(root,'live-snapshot-receipts.json'),JSON.stringify(receipts,null,2));
console.log(JSON.stringify(receipts,null,2));
