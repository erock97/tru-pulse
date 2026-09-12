import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {HISTORY_POLICY,HISTORY_START,classifyHistorySource,historyTime,missingIntervals} from '../../shared/historyPolicy.ts';
import {parseStage} from '../history-pilot/metrics.mjs';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export async function readJson(file){return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}
export async function atomicJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value));await fs.rename(file+'.tmp',file);}
export function emptyLedger(accountId,teamId,orgId){return {version:1,accountId:String(accountId),teamId,orgId,events:{},receipts:{},coverage:[],failures:[]};}
export function importReceipt(ledger,person,receipt,bytes,{account,from,through,paginationComplete=false,cutoff}){
 if(receipt.account!==account||String(receipt.personId)!==String(person.id)||receipt.status!=='complete'||!Array.isArray(receipt.stageEvents))throw Error('Receipt identity/completion mismatch');
 historyTime(receipt.fetchedAt);historyTime(through);historyTime(from);
 historyTime(cutoff);
 if(historyTime(from)>=historyTime(through))throw Error('Invalid coverage interval');
 if(classifyHistorySource(person.source)!=='eligible')return {inserted:0,reused:0,excluded:true};
 const contentHash=hash(bytes),receiptKey=hash(JSON.stringify([ledger.accountId,String(person.id),contentHash]));
 if(ledger.receipts[receiptKey]?.interpretedThrough && historyTime(ledger.receipts[receiptKey].interpretedThrough)>=historyTime(cutoff))return {inserted:0,reused:1};
 // Validate the entire input before mutating anything; parser upgrades never affect source identity.
 const parsed=receipt.stageEvents.map(e=>{const p=parseStage(e);if(!p)throw Error('Unparsed stage event');historyTime(p.date);return p;});
 const incoming={};
 for(const e of parsed){
  if(historyTime(e.date)>=historyTime(cutoff))continue;
  const key=hash(JSON.stringify([ledger.accountId,String(person.id),'ChangeLog',String(e.id)]));
  const event={accountId:ledger.accountId,teamId:ledger.teamId,orgId:ledger.orgId,personId:String(person.id),kind:'ChangeLog',upstreamId:String(e.id),occurredAt:e.date,from:e.from,to:e.to,description:e.description};
  const old=incoming[key]||ledger.events[key];
  if(old&&JSON.stringify(old)!==JSON.stringify(event))throw Error('Conflicting upstream event identity');
  incoming[key]=event;
 }
 let inserted=0;for(const [key,event] of Object.entries(incoming)){if(!ledger.events[key]){ledger.events[key]=event;inserted++;}}
 ledger.receipts[receiptKey]={personId:String(person.id),contentHash,capturedAt:receipt.fetchedAt,sourceRaw:person.source,parserVersion:'stage-description-v1',interpretedThrough:cutoff,eventKeys:Object.keys(incoming)};
 if(!ledger.coverage.some(c=>c.personId===String(person.id)&&c.contentHash===contentHash&&c.from===from&&c.through===through))ledger.coverage.push({personId:String(person.id),from,through,policy:HISTORY_POLICY,sourceRaw:person.source,contentHash,capturedAt:receipt.fetchedAt,paginationComplete,state:paginationComplete?'validated':'collected',limitation:paginationComplete?null:'Original checkpoint does not retain page receipts; upstream pagination not independently certified'});
 return {inserted,reused:0};
}
export function gapsFor(ledger,personId,cutoff){return missingIntervals({from:HISTORY_START,through:cutoff},ledger.coverage.filter(c=>c.personId===String(personId)&&c.policy===HISTORY_POLICY&&c.state==='validated'&&c.paginationComplete).map(c=>({from:c.from,through:c.through})));}

/** Single-writer lease. On process death inspect the recorded PID before removing the lock. */
export async function withLedger(file,initial,work){
 await fs.mkdir(path.dirname(file),{recursive:true});
 const lock=await fs.open(file+'.lock','wx');
 try{await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));const ledger=await readJson(file).catch(e=>{if(e.code==='ENOENT')return initial;throw e;});return await work(ledger,()=>atomicJson(file,ledger));}
 finally{await lock.close();await fs.unlink(file+'.lock');}
}
