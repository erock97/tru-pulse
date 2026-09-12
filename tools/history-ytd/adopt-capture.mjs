import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson,emptyLedger,withLedger,importReceipt} from './ledger.mjs';
import {HISTORY_START,historyTime,classifyHistorySource} from '../../shared/historyPolicy.ts';
const [censusPath,captureDir,ledgerPath,cutoff]=process.argv.slice(2);
if(!cutoff)throw Error('Usage: adopt-capture.mjs census.json private-captures private-ledger cutoff');
const census=await readJson(censusPath);historyTime(cutoff);
const identity=await readJson(path.join(captureDir,'auth-status.json'));
if(identity.state!=='authenticated')throw Error('Capture identity was not authenticated');
const people=census.people.filter(p=>classifyHistorySource(p.source)==='eligible'&&Date.parse(p.created)>=historyTime(HISTORY_START)&&Date.parse(p.created)<historyTime(cutoff));
const result={eligible:people.length,validated:0,missing:0,eventsInserted:0,reused:0};
await withLedger(ledgerPath,emptyLedger(census.accountId,census.teamId,census.orgId),async(ledger,save)=>{
 for(const p of people){
  let bytes;try{bytes=await fs.readFile(path.join(captureDir,p.id+'.json'));}catch(e){if(e.code==='ENOENT'){result.missing++;continue;}throw e;}
  const r=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  if(!Array.isArray(r.pages)||!r.pages.length||!r.paginationComplete||historyTime(r.through)<historyTime(cutoff))throw Error('Incomplete page evidence');
  let count=0;const ids=new Set();
  for(let i=0;i<r.pages.length;i++){
   const page=r.pages[i];if(!Array.isArray(page.timeline))throw Error('Missing timeline page');
   for(const event of page.timeline){if(String(event.personId)!==String(p.id)||event.type!=='ChangeLog'||ids.has(String(event.id)))throw Error('Page identity or duplicate event failure');ids.add(String(event.id));count++;}
   if(i<r.pages.length-1&&!page._metadata?.nextLink)throw Error('Missing pagination continuation');
   if(i===r.pages.length-1&&(page._metadata?.nextLink||page._metadata?.total>count))throw Error('Unfinished pagination');
  }
  if(count!==r.totalChangeLogs)throw Error('Page totals mismatch');
  const imported=importReceipt(ledger,p,r,bytes,{account:identity.account,from:HISTORY_START,through:cutoff,cutoff,paginationComplete:true});
  result.validated++;result.eventsInserted+=imported.inserted;result.reused+=imported.reused;
 }
 await save();
});
console.log(JSON.stringify(result));
