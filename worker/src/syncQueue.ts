import type {Env} from './env.js';
import {db} from './db.js';
import {syncTeam,syncPeopleByIds,type TeamRow} from './sync.js';
type Pending='full'|string[];
/** A webhook is acknowledged only after its work is durably recorded. */
export class FubSyncQueue {
 constructor(private state:DurableObjectState,private env:Env){}
 async fetch(req:Request){
  const {team,ids,periodic=false}=await req.json() as {team:TeamRow;ids?:string[];periodic?:boolean};
  const old=await this.state.storage.get<TeamRow>('team');
  if(!team?.id||old&&(old.id!==team.id||old.org_id!==team.org_id))return new Response('Invalid sync scope',{status:400});
  await this.state.storage.put('team',team);
  if(!periodic||!await this.state.storage.getAlarm()){
   const pending=await this.state.storage.get<Pending>('pending');
   const merged=ids&&ids.length>0&&ids.length<=100&&ids.every(id=>/^\d+$/.test(id))&&pending!=='full'?[...new Set([...(pending||[]),...ids])]:'full';
   await this.state.storage.put('pending',merged==='full'||merged.length>100?'full':merged);
   await this.state.storage.setAlarm(Date.now()+1000);
  }
  return Response.json({queued:true});
 }
 async alarm(){
  await this.state.storage.setAlarm(Date.now()+30*60000);
  const team=await this.state.storage.get<TeamRow>('team');if(!team)return;
  const database=db(this.env);
  try{
   const active=await database.select('teams',`id=eq.${team.id}&org_id=eq.${team.org_id}&is_active=eq.true&select=id`);
   if(!active.length){await this.state.storage.deleteAlarm();return;}
   const fullDue=await this.state.storage.get<number>('fullDue')||0;
   const pending=fullDue<=Date.now()?'full':await this.state.storage.get<Pending>('pending')||'full';
   await this.state.storage.delete('pending');
   if(pending==='full')await syncTeam(this.env,database,team);else await syncPeopleByIds(this.env,database,team,pending.join(','));
   if(pending==='full')await this.state.storage.put('fullDue',Date.now()+30*60000);
   await this.state.storage.setAlarm(pending==='full'?Date.now()+30*60000:fullDue);
   const status={lastSuccess:new Date().toISOString()};
   await this.state.storage.put('status',status);
   await this.env.SESSIONS?.put('sync-health:v1:'+team.id,JSON.stringify(status)).catch(()=>{});
   if(await this.state.storage.get('pending'))await this.state.storage.setAlarm(Date.now()+1000);
  }catch{
   await this.state.storage.put('pending','full');
   const status={error:'FUB sync failed; automatic retry scheduled',lastFailure:new Date().toISOString()};
   await this.state.storage.put('status',status);
   await this.env.SESSIONS?.put('sync-health:v1:'+team.id,JSON.stringify(status)).catch(()=>{});
   await this.state.storage.setAlarm(Date.now()+5*60000);
  }
 }
}
export async function queueActiveTeams(env:Env){
 if(!env.FUB_SYNC)return;
 const teams=await db(env).select('teams','is_active=eq.true&select=id,org_id,fub_subdomain');
 for(const team of teams){const r=await env.FUB_SYNC.get(env.FUB_SYNC.idFromName(team.id)).fetch('https://sync/queue',{method:'POST',body:JSON.stringify({team,periodic:true})});if(!r.ok)throw Error('FUB sync queue unavailable');}
}
