import type {Env} from './env.js';
import type {Db} from './db.js';
import {decryptTeamKey,type TeamRow} from './sync.js';
import {fubGet,getPeopleByIds} from './fub.js';
import type {StageReceipt} from './stageEnvelope.js';
import {HISTORY_POLICY,classifyHistorySource} from '../../shared/historyPolicy.js';

export async function drainStageReceipts(storage:DurableObjectStorage,env:Env,database:Db,team:TeamRow){
 const pending=await storage.list<StageReceipt>({prefix:'stage-pending:',limit:100});
 if(!pending.size)return;
 const account=(await database.select('history_accounts',`team_id=eq.${team.id}&org_id=eq.${team.org_id}&select=account_id,domain`))[0];
 if(!account)throw Error('History account is not verified');
 const key=await decryptTeamKey(env,database,team.id);
 const identity=await fubGet(key,'/identity');
 if(identity.status!==200||String(identity.body?.account?.id)!==String(account.account_id)||identity.body?.account?.domain!==account.domain)throw Error('History account identity mismatch');
 const ids=[...new Set([...pending.values()].map(r=>r.personId))];
 const people=await getPeopleByIds(key,ids.join(','));
 let processed=0;
 for(const [pendingKey,r] of pending){
  if(r.teamId!==team.id||r.orgId!==team.org_id)throw Error('Stage receipt scope mismatch');
  const person=people.find(p=>String(p.id)===r.personId);
  if(!person){
   await storage.put('stage-unresolved:'+r.eventId+':'+r.personId,{receipt:r,reason:'Person inaccessible at processing',lastAttempt:new Date().toISOString()});
   await storage.delete(pendingKey);continue;
  }
  const disposition=classifyHistorySource(person.source);
  // Save interpretation before remote writes so a crash cannot change source
  // classification on retry. It is an observation, not historical ownership.
  const interpretationKey='stage-interpretation:'+r.eventId+':'+r.personId;
  let interpretation=await storage.get<{disposition:string;sourceRaw:string;observedAt:string}>(interpretationKey);
  if(!interpretation){interpretation={disposition,sourceRaw:String(person.source??''),observedAt:new Date().toISOString()};await storage.put(interpretationKey,interpretation);}
  const event={accountId:String(account.account_id),teamId:team.id,orgId:team.org_id,personId:r.personId,kind:'peopleStageUpdated',upstreamId:r.eventId,occurredAt:r.occurredAt,from:null,to:r.stage};
  const bytes=new TextEncoder().encode(JSON.stringify(event));
  const contentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(interpretation.disposition==='eligible')await database.rpc('history_import_events',{p_account_id:account.account_id,p_team_id:team.id,p_org_id:team.org_id,p_events:[event]});
  await database.upsert('history_receipts',[{account_id:account.account_id,person_id:r.personId,content_hash:contentHash,captured_at:r.capturedAt,source_raw:interpretation.sourceRaw,source_policy:HISTORY_POLICY,parser_version:'webhook-envelope-v1',provenance:{kind:'peopleStageUpdated',eventId:r.eventId,occurrence:r.occurredAt,...interpretation}}],'account_id,person_id,content_hash',{ignoreDuplicates:true});
  await storage.put('stage-processed:'+r.eventId+':'+r.personId,{processedAt:new Date().toISOString(),disposition:interpretation.disposition});
  await storage.delete(pendingKey);processed++;
 }
 await storage.put('stage-health',{lastAttemptAt:new Date().toISOString(),...(processed?{lastProcessedAt:new Date().toISOString()}:{}),processed,remaining:(await storage.list({prefix:'stage-pending:',limit:1})).size>0,unresolved:(await storage.list({prefix:'stage-unresolved:',limit:1})).size>0});
}
