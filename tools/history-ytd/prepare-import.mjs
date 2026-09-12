import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson,atomicJson,hash} from './ledger.mjs';
const [root,out]=process.argv.slice(2);if(!out)throw Error('Usage: prepare-import.mjs ledger-directory private-manifest-directory');
await fs.mkdir(out,{recursive:true});const batches=[];
for(const name of (await fs.readdir(root)).filter(n=>n.endsWith('.json')).sort()){
 const ledger=await readJson(path.join(root,name));
 const events=Object.entries(ledger.events).sort(([a],[b])=>a.localeCompare(b)).map(([,e])=>e);
 for(let offset=0;offset<events.length;offset+=500){
  const batch={accountId:ledger.accountId,teamId:ledger.teamId,orgId:ledger.orgId,events:events.slice(offset,offset+500)};
  const digest=hash(JSON.stringify(batch));const file=ledger.teamId+'-'+offset+'-'+digest+'.json';
  await atomicJson(path.join(out,file),batch);batches.push({file,sha256:digest,accountId:ledger.accountId,teamId:ledger.teamId,count:batch.events.length});
 }
}
await atomicJson(path.join(out,'manifest.json'),{createdAt:new Date().toISOString(),batches});
console.log(JSON.stringify({batches:batches.length,events:batches.reduce((n,b)=>n+b.count,0)}));
