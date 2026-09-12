import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {classifyHistorySource} from '../../shared/historyPolicy.ts';

// Public API only. Credentials stay in memory; no provider bodies/errors are logged.
const [inventoryPath,auditPath,outDir,...selected]=process.argv.slice(2);
if(!outDir)throw Error('Usage: census.mjs inventory.json audit.json output-directory [team-id ...]');
const inventory=JSON.parse(await fs.readFile(inventoryPath,'utf8'));
const audit=JSON.parse(await fs.readFile(auditPath,'utf8'));
await fs.mkdir(outDir,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const team of inventory.teams.filter(t=>t.is_active&&(!selected.length||selected.includes(t.id)))){
 const mapping=audit.teams.find(a=>a.team_id===team.id&&a.org_id===team.org_id&&a.fub_subdomain===team.fub_subdomain);
 const dest=path.join(outDir,team.id+'.json');
 let result={teamId:team.id,orgId:team.org_id,startedAt:new Date().toISOString(),requests:0,complete:false,people:[],users:[],webhooks:[],limitations:['Census is not an atomic upstream snapshot','Deleted/inaccessible records and historical source/ownership changes may not be exposed']};
 try{
  if(!mapping)throw Error('Account mapping unresolved');
  result.accountId=String(mapping.upstream_account_id);
  const key=execFileSync('infisical',['secrets','get',mapping.credential_reference,'--projectId','8ae8aecb-79a2-4311-8fa3-82c44c2c5662','--env','prod','--path','/FUB-Keys','--plain','--silent'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
  if(!key)throw Error('Credential unavailable');
  const read=async url=>{
   const u=new URL(url);
   if(u.origin!=='https://api.followupboss.com'||!u.pathname.startsWith('/v1/')||u.username||u.password)throw Error('Invalid pagination origin');
   for(let attempt=0;attempt<4;attempt++){
    result.requests++;
    let response;
    try{response=await fetch(u,{headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),'X-System':'TruPulse'},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{if(attempt===3)throw Error('Public API network failure');await sleep(1000*2**attempt);continue;}
    if(response.ok){await sleep(200);return response.json();}
    if(![429,500,502,503,504].includes(response.status)||attempt===3)throw Error('Public API HTTP '+response.status);
    const header=response.headers.get('retry-after');
    const wait=header?(/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now()):1000*2**attempt;
    if(wait>60000)throw Error('Rate limit requires later resume');
    await sleep(Math.max(1000,Number.isFinite(wait)?wait:1000));
   }
  };
  const identity=await read('https://api.followupboss.com/v1/identity');
  if(String(identity.account?.id)!==result.accountId||identity.account?.domain!==team.fub_subdomain)throw Error('Account identity mismatch');
  result.identityVerifiedAt=new Date().toISOString();
  const pages=async(url,field,onRows)=>{
   const seen=new Set();let count=0;
   while(url){
    if(seen.has(url)||seen.size>=2000)throw Error('Pagination bound/loop');seen.add(url);
    const page=await read(url);if(!Array.isArray(page[field])||!page._metadata)throw Error('Invalid census page');
    count+=page[field].length;onRows(page[field]);url=page._metadata.nextLink;
    if(!url&&Number(page._metadata.total)>count)throw Error('Pagination ended before total');
   }
  };
  await pages('https://api.followupboss.com/v1/users?limit=100','users',rows=>result.users.push(...rows.map(u=>({id:u.id,status:u.status}))));
  await pages('https://api.followupboss.com/v1/webhooks?limit=100','webhooks',rows=>result.webhooks.push(...rows.map(h=>{const u=new URL(h.url);return {id:h.id,event:h.event,status:h.status,teamId:u.searchParams.get('team'),callbackHost:u.host,callbackPath:u.pathname};})));
  await pages('https://api.followupboss.com/v1/people?limit=100&includeTrash=true&fields=id,created,updated,stage,source,assignedUserId','people',rows=>result.people.push(...rows.map(p=>({id:p.id,created:p.created,updated:p.updated,stage:p.stage,source:p.source,assignedUserId:p.assignedUserId,classification:classifyHistorySource(p.source)}))));
  const ids=new Set(result.people.map(p=>String(p.id)));if(ids.size!==result.people.length)throw Error('Census contains duplicate people; reconcile pagination drift');
  result.complete=true;
 }catch(e){result.blocker=/^(Account|Credential|Public API|Invalid|Pagination|Rate limit|Census)/.test(e.message)?e.message:'Credential or collection preflight failed';}
 result.finishedAt=new Date().toISOString();
 await fs.writeFile(dest+'.tmp',JSON.stringify(result));await fs.rename(dest+'.tmp',dest);
 console.log(JSON.stringify({team:team.name,complete:result.complete,people:result.people.length,requests:result.requests,blocker:result.blocker}));
}
