import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {emptyLedger,importReceipt,gapsFor,withLedger,readJson} from './ledger.mjs';
import {HISTORY_START,classifyHistorySource,missingIntervals} from '../../shared/historyPolicy.ts';
const person={id:1,source:'Zillow',created:'2024-01-01T00:00:00Z'};
const cutoff='2026-09-12T02:16:35.917Z';
const event=(id,to,date='2026-01-01T08:00:00Z')=>({id,date,description:`Stage changed from Lead to ${to}`});
const receipt=(events=[event(1,'Nurture')])=>({account:'account',personId:1,status:'complete',fetchedAt:cutoff,stageEvents:events});
const opts={account:'account',from:HISTORY_START,through:cutoff,cutoff,paginationComplete:true};
const add=(ledger,r=receipt(),p=person,o=opts)=>importReceipt(ledger,p,r,Buffer.from(JSON.stringify(r)),o);
test('exact global source policy excludes rentals and unrelated networks',()=>{
 assert.equal(classifyHistorySource('  zillow   FLEX '),'eligible');
 for(const source of ['UpNest by Realtor.com','Realtor.com - Rental','Homes.com','Zillow Rentals'])assert.equal(classifyHistorySource(source),'excluded');
 for(const source of ['Opcity','Zillow Foreclosure','Zillow Tech Connect'])assert.equal(classifyHistorySource(source),'review');
 const l=emptyLedger('a','t','o');add(l,receipt(),{...person,source:'UpNest'});assert.equal(Object.keys(l.events).length,0);
});
test('replay, overlapping exports and repeated transitions converge',()=>{
 const l=emptyLedger('a','t','o');const r=receipt([event(3,'Nurture'),event(1,'Nurture'),event(2,'Appointment')]);
 assert.equal(add(l,r).inserted,3);assert.equal(add(l,r).inserted,0);
 assert.equal(add(l,receipt([event(1,'Nurture')])).inserted,0);assert.equal(Object.keys(l.events).length,3);
 assert.deepEqual(gapsFor(l,1,cutoff),[]);
});
test('older leads and Pacific boundary preserve opening evidence and occurrence offsets',()=>{
 const l=emptyLedger('a','t','o');add(l,receipt([event(1,'Nurture','2025-12-31T23:59:59-08:00'),event(2,'Appointment','2026-01-01T00:00:00-08:00'),event(3,'Closed',cutoff)]));
 assert.equal(Object.keys(l.events).length,2);assert.equal(Object.values(l.events)[1].occurredAt,'2026-01-01T00:00:00-08:00');
});
test('old checkpoint and unverified pagination never satisfy new cutoff',()=>{
 const l=emptyLedger('a','t','o');add(l,receipt(),person,{...opts,through:'2026-09-05T07:00:00Z',paginationComplete:false});
 assert.deepEqual(gapsFor(l,1,cutoff),[{from:HISTORY_START,through:cutoff}]);
 assert.deepEqual(missingIntervals({from:HISTORY_START,through:cutoff},[{from:HISTORY_START,through:'2026-09-05T07:00:00Z'}]),[{from:'2026-09-05T07:00:00.000Z',through:cutoff}]);
});
test('unknown parser descriptions and conflicting IDs are atomic failures',()=>{
 const l=emptyLedger('a','t','o');assert.throws(()=>add(l,receipt([{id:1,date:cutoff,description:'Stage mystery'}])));assert.equal(Object.keys(l.events).length,0);
 add(l);assert.throws(()=>add(l,receipt([event(2,'Closed'),event(1,'Closed')])));assert.equal(Object.keys(l.events).length,1);
});
test('saved checkpoint survives restart and rejects a competing writer',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'truehq-ledger-'));const file=path.join(root,'ledger.json');
 await withLedger(file,emptyLedger('a','t','o'),async(l,save)=>{add(l);await save();await assert.rejects(withLedger(file,l,async()=>{}),{code:'EEXIST'});});
 await withLedger(file,null,async(l,save)=>{assert.equal(add(l).inserted,0);await save();});assert.equal(Object.keys((await readJson(file)).events).length,1);
 await fs.rm(root,{recursive:true});
});
