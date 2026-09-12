import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson,atomicJson,hash} from './ledger.mjs';
const [jobsPath,censusDir,out]=process.argv.slice(2);if(!out)throw Error('Usage: prepare-census-rows.mjs private-jobs private-census-directory private-output-directory');
const jobs=await readJson(jobsPath);await fs.mkdir(out,{recursive:true});const batches=[];
for(const name of (await fs.readdir(censusDir)).filter(n=>n.endsWith('.json')).sort()){
 const census=await readJson(path.join(censusDir,name));const job=jobs.find(j=>String(j.account_id)===String(census.accountId));
 if(!job||!census.complete)throw Error('Missing job or incomplete census');
 const rows=census.people.filter(p=>p.classification!=='excluded'&&Date.parse(p.created)>=Date.parse(job.from_at)&&Date.parse(p.created)<Date.parse(job.cutoff)).map(p=>({job_id:job.id,person_id:p.id,source_raw:String(p.source??''),disposition:p.classification}));
 if(rows.some(r=>!['eligible','excluded','review'].includes(r.disposition)))throw Error('Unknown census classification');
 for(let offset=0;offset<rows.length;offset+=500){const batch=rows.slice(offset,offset+500);const file=job.id+'-'+offset+'-'+hash(JSON.stringify(batch))+'.json';await atomicJson(path.join(out,file),batch);batches.push({file,count:batch.length});}
}
await atomicJson(path.join(out,'manifest.json'),{batches});console.log(JSON.stringify({batches:batches.length,people:batches.reduce((n,b)=>n+b.count,0)}));
