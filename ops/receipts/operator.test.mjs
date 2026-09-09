import test from 'node:test';
import assert from 'node:assert/strict';
import {prepare,validateCommand,execute,request,resolveOperatorToken,TEAMS,digest,VAULT} from './operator.mjs';
globalThis.fetch=()=>{throw new Error('LIVE NETWORK FORBIDDEN IN TESTS');};
const receipt={teamId:TEAMS.signature,runId:'synthetic-operator-test',hashScheme:'receipt-jcs-sha256-v1',payloadHash:'a'.repeat(64),storageStatus:'stored',publicationStatus:'held',coverageState:'complete',revision:1,derivedProcessing:{status:'not_required'}};
const plan=()=>prepare(receipt,'signature','release','synthetic-approval');
const response=x=>new Response(JSON.stringify({ok:true,...x}));
test('prepare builds exact wire fields without sending',()=>assert.equal(plan().reason,'Eric approval reference: synthetic-approval'));
for(const coverageState of ['partial','unknown'])test(`launch policy holds ${coverageState}`,()=>assert.throws(()=>prepare({...receipt,coverageState},'signature','release','ref'),/complete_coverage/));
test('unknown account fails',()=>assert.throws(()=>prepare(receipt,'invented','release','ref'),/unknown_account/));
test('receipt must match account',()=>assert.throws(()=>prepare(receipt,'satish','release','ref'),/invalid_receipt/));
test('published report cannot be prepared for release',()=>assert.throws(()=>prepare({...receipt,publicationStatus:'published'},'signature','release','ref'),/invalid_transition/));
test('withdraw is available for published report',()=>assert.equal(prepare({...receipt,publicationStatus:'published'},'signature','withdraw','ref').action,'withdraw'));
for(const rev of [0,2147483648,1.1,null,'1'])test(`revision ${rev} rejected`,()=>assert.throws(()=>validateCommand({...plan(),expectedRevision:rev}),/invalid_command/));
test('int32 upper bound accepted',()=>assert.equal(validateCommand({...plan(),expectedRevision:2147483647}).expectedRevision,2147483647));
test('unknown command field rejected',()=>assert.throws(()=>validateCommand({...plan(),extra:true}),/invalid_command/));
test('control characters rejected',()=>assert.throws(()=>validateCommand({...plan(),reason:'ref\nextra'}),/invalid_command/));
test('changed approved bytes fail before network',async()=>assert.rejects(execute(Buffer.from('{}'),'a'.repeat(64),'ref','token'),/approved_command_changed/));
test('mismatched approval reference fails before network',async()=>{const b=Buffer.from(JSON.stringify(plan()));await assert.rejects(execute(b,digest(b),'different','token'),/approval_reference_mismatch/);});
test('stale receipt prevents POST',async()=>{const c=plan(),b=Buffer.from(JSON.stringify(c));let calls=0;await assert.rejects(execute(b,digest(b),'synthetic-approval','token',{fetcher:async()=>{calls++;return response({receipt:{...receipt,revision:2}});}}),/receipt_changed/);assert.equal(calls,1);});
test('release requires lookup, POST, and verified lookup',async()=>{
 const c=plan(),b=Buffer.from(JSON.stringify(c));const calls=[];const final={...receipt,revision:2,publicationStatus:'published',derivedProcessing:{status:'complete'}};
 const result=await execute(b,digest(b),'synthetic-approval','token',{fetcher:async(url,options)=>{calls.push({url,options});return response(calls.length===1?{receipt}:calls.length===2?{receipt:final,operationId:c.operationId}:{receipt:final});}});
 assert.deepEqual(calls.map(c=>c.options.method),['GET','POST','GET']);assert.equal(calls[1].options.redirect,'error');assert.deepEqual(JSON.parse(calls[1].options.body),c);assert.equal(result.receipt.publicationStatus,'published');assert.equal(result.brokerVisibilityVerified,false);
});
test('storage acceptance is not successful release',async()=>{const c=plan(),b=Buffer.from(JSON.stringify(c));await assert.rejects(execute(b,digest(b),'synthetic-approval','token',{fetcher:async()=>response({receipt,operationId:c.operationId})}),/postcondition/);});
test('oversized response rejected',async()=>assert.rejects(request('/receipt','token',undefined,{fetcher:async()=>new Response(' '.repeat(65537))}),/response_too_large/));
test('invalid UTF-8 sanitized',async()=>assert.rejects(request('/receipt','token',undefined,{fetcher:async()=>new Response(new Uint8Array([255]))}),/connection_outcome_unknown/));
test('server diagnostics never exposed',async()=>assert.rejects(request('/control','token',plan(),{fetcher:async()=>new Response('secret customer diagnostic',{status:503})}),/^Error: receiver_http_503$/));
test('network failure not automatically retried',async()=>{let count=0;await assert.rejects(request('/control','token',plan(),{fetcher:async()=>{count++;throw Error('secret');}}),/^Error: connection_outcome_unknown$/);assert.equal(count,1);});
test('full body timeout applies',async()=>assert.rejects(request('/receipt','token',undefined,{timeoutMs:10,fetcher:async(_,o)=>new Response(new ReadableStream({start(c){o.signal.addEventListener('abort',()=>c.error(Error('aborted')));}}))}),/connection_outcome_unknown/));
test('absolute CLI required',async()=>assert.rejects(resolveOperatorToken('infisical'),/absolute_infisical/));
test('resolver fixed operator project and no inherited machine token',async()=>{
 const old=process.env.INFISICAL_TOKEN;process.env.INFISICAL_TOKEN='must-not-forward';
 try{const token=await resolveOperatorToken(process.execPath,{run:(exe,args,options,cb)=>{assert.equal(options.env.INFISICAL_TOKEN,undefined);assert.ok(args.includes(VAULT.projectId));assert.ok(args.includes(VAULT.path));assert.equal(options.windowsHide,true);assert.equal(options.timeout,10000);cb(null,'b'.repeat(64),'');}});assert.equal(token,'b'.repeat(64));}finally{if(old===undefined)delete process.env.INFISICAL_TOKEN;else process.env.INFISICAL_TOKEN=old;}
});
test('resolver errors sanitized',async()=>assert.rejects(resolveOperatorToken(process.execPath,{run:(_,a,o,cb)=>cb(Error('secret'),'', 'secret')}),/^Error: operator_credential_unavailable$/));
