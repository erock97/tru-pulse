// Minimal desktop-only operator. No report submission, scheduling or automatic retries.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VAULT = Object.freeze({projectId:'744e501e-1a55-41c1-a7d9-a4bede367a63',environment:'prod',path:'/TruHQ/Receipts/Operators/eric',key:'TOKEN'});
export const TEAMS = Object.freeze({signature:'3a84fd98-13f2-46e7-83a2-a1ed3aeadab7',costigan:'cb0fcbbb-c332-4f61-90f8-2b51b673bca8',scottmoore:'8b61c008-c8b1-4fb6-9de7-093b21a09a22',woosley:'96ddb98f-1fb6-4d99-80f6-20ef615dec34',synergy:'213f7da9-6c3d-425e-86e6-a32d16db32a3',satish:'df216d4d-b05e-4ddf-a84e-0d685182d692'});
const approvedSampleRelease=JSON.parse(await readFile(new URL('../../shared/approvedSampleRelease.json',import.meta.url),'utf8'));
const approvedSample=(c)=>JSON.stringify(Object.keys(approvedSampleRelease).map(k=>c[k]))===JSON.stringify(Object.values(approvedSampleRelease));
const BASE='https://api.truhq.co/coach/weekly-report';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw new Error(code);};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function exact(value,keys){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail('invalid_command');}
export function validateCommand(c){
 exact(c,['operationId','action','teamId','runId','expectedHash','expectedRevision','reason']);
 if(!['release','withdraw'].includes(c.action)||!Object.values(TEAMS).includes(c.teamId)||typeof c.runId!=='string'||!ID.test(c.runId)||typeof c.operationId!=='string'||!ID.test(c.operationId)||!HASH.test(c.expectedHash)||typeof c.expectedHash!=='string'||!Number.isInteger(c.expectedRevision)||c.expectedRevision<1||c.expectedRevision>2147483647||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>500||/[\u0000-\u001f\u007f]/.test(c.reason))fail('invalid_command');
 return c;
}
export function validateReceipt(r,teamId,runId){
 if(!r||r.teamId!==teamId||r.runId!==runId||r.hashScheme!=='receipt-jcs-sha256-v1'||!HASH.test(r.payloadHash)||r.storageStatus!=='stored'||!['held','published','withdrawn','superseded'].includes(r.publicationStatus)||!['complete','partial','unknown'].includes(r.coverageState)||!Number.isInteger(r.revision)||r.revision<1||r.revision>2147483647||!['complete','not_required'].includes(r.derivedProcessing?.status))fail('invalid_receipt');
 return r;
}
export function prepare(receipt,account,action,approvalReference){
 if(!TEAMS[account])fail('unknown_account');
 validateReceipt(receipt,TEAMS[account],receipt?.runId);
 if(typeof approvalReference!=='string'||!approvalReference.trim()||/[\u0000-\u001f\u007f]/.test(approvalReference))fail('approval_reference_required');
 if(action==='release'&&receipt.coverageState!=='complete'){
  const c={...approvedSampleRelease,teamId:receipt.teamId,runId:receipt.runId,expectedHash:receipt.payloadHash,expectedRevision:receipt.revision,reason:`Eric approval reference: ${approvalReference}`};
  if(receipt.coverageState==='partial'&&receipt.publicationStatus==='held'&&approvedSample(c))return validateCommand(c);
  fail('launch_policy_complete_coverage_required');
 }
 if(action==='release'&&!['held','withdrawn'].includes(receipt.publicationStatus))fail('invalid_transition');
 if(action==='withdraw'&&!['held','published'].includes(receipt.publicationStatus))fail('invalid_transition');
 return validateCommand({operationId:randomUUID(),action,teamId:receipt.teamId,runId:receipt.runId,expectedHash:receipt.payloadHash,expectedRevision:receipt.revision,reason:`Eric approval reference: ${approvalReference}`});
}
export async function resolveOperatorToken(executable,{run=execFile}={}){
 if(!isAbsolute(executable))fail('absolute_infisical_executable_required');
 // Human desktop login only. Never inherit a machine/service token override.
 const env={...process.env};delete env.INFISICAL_TOKEN;
 delete env.INFISICAL_CLIENT_ID;delete env.INFISICAL_CLIENT_SECRET;
 return new Promise((ok,no)=>run(executable,['secrets','get',VAULT.key,'--plain','--silent','--domain','https://app.infisical.com/api','--projectId',VAULT.projectId,'--env',VAULT.environment,'--path',VAULT.path],{env,timeout:10000,maxBuffer:8192,windowsHide:true,encoding:'utf8'},(err,stdout)=>{
  const token=typeof stdout==='string'?stdout.trim():'';
  if(err||!/^[a-f0-9]{64}$/.test(token))return no(new Error('operator_credential_unavailable'));
  ok(token);
 }));
}
export async function request(path,token,body,{fetcher=fetch,timeoutMs=15000}={}){
 const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),timeoutMs);
 let reader;
 try{
  const response=await fetcher(BASE+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:abort.signal});
  reader=response.body?.getReader();if(!reader)fail('invalid_response');
  let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)fail('response_too_large');text+=decoder.decode(part.value,{stream:true});}
  text+=decoder.decode();
  if(!response.ok)fail(`receiver_http_${response.status}`);
  const data=JSON.parse(text);if(data?.ok!==true)fail('invalid_response');return data;
 }catch(e){
  const code=/^(receiver_http_\d{3}|response_too_large|invalid_response)$/.test(e?.message)?e.message:'connection_outcome_unknown';
  throw new Error(code);
 }finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});reader?.releaseLock();}
}
export async function lookup(teamId,runId,token,deps){
 if(!Object.values(TEAMS).includes(teamId)||typeof runId!=='string'||!ID.test(runId))fail('invalid_identity');
 const d=await request('/receipt?'+new URLSearchParams({teamId,runId}),token,undefined,deps);
 return validateReceipt(d.receipt,teamId,runId);
}
export async function execute(bytes,approvedDigest,approvalReference,token,deps){
 if(!HASH.test(approvedDigest)||digest(bytes)!==approvedDigest)fail('approved_command_changed');
 if(bytes.length>8192)fail('invalid_command');
 const command=validateCommand(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(!approvalReference||command.reason!==`Eric approval reference: ${approvalReference}`)fail('approval_reference_mismatch');
 const before=await lookup(command.teamId,command.runId,token,deps);
 if(before.payloadHash!==command.expectedHash||before.revision!==command.expectedRevision)fail('receipt_changed_reconcile_original_operation');
 if(command.action==='release'&&before.coverageState!=='complete'&&!(before.coverageState==='partial'&&approvedSample(command)))fail('launch_policy_complete_coverage_required');
 const result=await request('/control',token,command,deps);
 if(result.operationId!==command.operationId)fail('invalid_control_response');
 const receipt=validateReceipt(result.receipt,command.teamId,command.runId);
 if(receipt.payloadHash!==command.expectedHash)fail('invalid_control_response');
 // A fresh lookup is the postcondition; broker visibility is separately verified.
 const current=await lookup(command.teamId,command.runId,token,deps);
 const expected=command.action==='release'?'published':'withdrawn';
 if(current.payloadHash!==command.expectedHash||current.publicationStatus!==expected||(command.action==='release'&&current.derivedProcessing.status!=='complete'))fail('control_postcondition_not_verified');
 return {operationId:command.operationId,receipt:current,brokerVisibilityVerified:false};
}
async function main(){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){
  if(args.length!==5)fail('usage_prepare_receiptFile_account_action_approvalReference_outputFile');
  const [input,account,action,reference,out]=args;
  const raw=await readFile(input);if(raw.length>65536)fail('invalid_receipt');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const c=prepare(value.receipt??value,account,action,reference);
  const bytes=Buffer.from(JSON.stringify(c,null,2)+'\n');
  await writeFile(out,bytes,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({command:c,commandSha256:digest(bytes),executed:false},null,2));return;
 }
 if(mode==='lookup'){
  if(args.length!==3)fail('usage_lookup_account_runId_absoluteInfisicalExe');
  const [account,runId,exe]=args;const token=await resolveOperatorToken(exe);
  console.log(JSON.stringify({ok:true,receipt:await lookup(TEAMS[account],runId,token)},null,2));return;
 }
 if(mode==='execute'){
  if(args.length!==4)fail('usage_execute_commandFile_approvedSha256_approvalReference_absoluteInfisicalExe');
  const [file,hash,reference,exe]=args;const bytes=await readFile(file);
  if(digest(bytes)!==hash)fail('approved_command_changed');
  const token=await resolveOperatorToken(exe);
  console.log(JSON.stringify(await execute(bytes,hash,reference,token),null,2));return;
 }
 fail('usage_prepare_lookup_or_execute');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^[a-z0-9_]+$/.test(e.message)?e.message:'operator_failed');process.exitCode=1;});
