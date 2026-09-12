import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson,atomicJson,hash} from './ledger.mjs';
const [root,out]=process.argv.slice(2);if(!out)throw Error('Usage: prepare-receipts.mjs ledger-directory private-manifest-directory');
await fs.mkdir(out,{recursive:true});const batches=[];
for(const name of (await fs.readdir(root)).filter(n=>n.endsWith('.json')).sort()){
 const ledger=await readJson(path.join(root,name));
 const receipts=Object.values(ledger.receipts).map(r=>({account_id:ledger.accountId,person_id:r.personId,content_hash:r.contentHash,captured_at:r.capturedAt,source_raw:r.sourceRaw,source_policy:'truehq-exact-sources-2026-v1',parser_version:r.parserVersion,provenance:{kind:'saved_changelog',eventKeys:r.eventKeys,coverage:ledger.coverage.filter(c=>c.personId===r.personId&&c.contentHash===r.contentHash)}}));
 for(let offset=0;offset<receipts.length;offset+=50){
  const batch={accountId:ledger.accountId,teamId:ledger.teamId,receipts:receipts.slice(offset,offset+50)};
  const digest=hash(JSON.stringify(batch));const file=ledger.teamId+'-'+offset+'-'+digest+'.json';
  await atomicJson(path.join(out,file),batch);batches.push({file,sha256:digest,accountId:ledger.accountId,teamId:ledger.teamId,count:batch.receipts.length});
 }
}
await atomicJson(path.join(out,'manifest.json'),{createdAt:new Date().toISOString(),batches});
console.log(JSON.stringify({batches:batches.length,receipts:batches.reduce((n,b)=>n+b.count,0)}));
