import type {Env} from './env.js';
import {db} from './db.js';
import {checkPipelineValues} from './pipelineValue.js';
import {VALUE_POLICY,inquiryValue} from '../../shared/pipelineValue.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One durable collector per team. No browser session or open tab is required. */
export class PipelineValueCollector {
 constructor(private state:DurableObjectState,private env:Env){}
 async fetch(req:Request){
  if(req.method==='GET')return Response.json(await this.state.storage.get('status')||{state:'waiting'});
  const {teamId}=await req.json() as {teamId:string};
  const old=await this.state.storage.get<string>('teamId');
  if(!UUID.test(teamId)||old&&old!==teamId)return new Response('Invalid team',{status:400});
  await this.state.storage.put('teamId',teamId);
  if(!await this.state.storage.getAlarm())await this.state.storage.setAlarm(Date.now()+1000);
  return Response.json({queued:true});
 }
 async alarm(){
  // Reserve a retry before any external I/O so transient failures cannot lose work.
  await this.state.storage.setAlarm(Date.now()+5*60000);
  const teamId=await this.state.storage.get<string>('teamId');if(!teamId)return;
  try{
   const database=db(this.env);
   const [team]=await database.select('teams',`id=eq.${teamId}&is_active=eq.true&select=id,fub_subdomain`);
   if(!team){await this.state.storage.put('status',{state:'inactive'});await this.state.storage.deleteAlarm();return;}
   const retryBefore=new Date(Date.now()-24*3600000).toISOString();
   const recent=new Date(Date.now()-7*24*3600000).toISOString(),retryRecent=new Date(Date.now()-3600000).toISOString();
   const eligible=`or=(pipeline_inquiry_value.is.null,pipeline_inquiry_value->>policy.neq.${VALUE_POLICY},and(pipeline_inquiry_value->>status.in.(failed,incomplete),pipeline_inquiry_value->>checkedAt.lt.${retryBefore}),and(pipeline_inquiry_value->>status.eq.missing,fub_created.gte.${recent},pipeline_inquiry_value->>checkedAt.lt.${retryRecent}))`;
   const [lead]=await database.select('leads',`team_id=eq.${teamId}&${eligible}&select=team_id,fub_person_id,fub_created&order=fub_created.desc.nullslast,fub_person_id.asc&limit=1`);
   if(!lead){await this.state.storage.put('status',{state:'up_to_date',at:new Date().toISOString()});await this.state.storage.setAlarm(Date.now()+15*60000);return;}
   const key=teamId+':'+lead.fub_person_id;
   await this.state.storage.put('status',{state:'running',at:new Date().toISOString()});
   try{
    const values=await checkPipelineValues(this.env,{teams:[team],leads:[{...lead,key}]},[key]);
    // Do not replace a result written concurrently by a verified backfill/manual check.
    await database.update('leads',`team_id=eq.${teamId}&fub_person_id=eq.${lead.fub_person_id}&${eligible}`,{pipeline_inquiry_value:values[key]});
    await this.state.storage.delete('failure');
    await this.state.storage.put('status',{state:'running',lastSuccess:new Date().toISOString()});
    await this.state.storage.setAlarm(Date.now()+1000);
   }catch{
    const prior=await this.state.storage.get<{key:string;attempts:number}>('failure');
    const attempts=prior?.key===key?prior.attempts+1:1;
    await this.state.storage.put('failure',{key,attempts});
    if(attempts>=3){
     await database.update('leads',`team_id=eq.${teamId}&fub_person_id=eq.${lead.fub_person_id}&${eligible}`,{pipeline_inquiry_value:{...inquiryValue(),status:'failed',checkedAt:new Date().toISOString(),reason:'FUB inquiry lookup failed. Automatic retry is scheduled; no value has been assumed.'}});
     await this.state.storage.delete('failure');
     await this.state.storage.setAlarm(Date.now()+1000);
    }
    await this.state.storage.put('status',{state:'retrying',at:new Date().toISOString(),message:'An inquiry lookup failed; automatic retry is scheduled.'});
   }
  }catch{
   await this.state.storage.put('status',{state:'retrying',at:new Date().toISOString(),message:'Property collection is temporarily unavailable; automatic retry is scheduled.'});
  }
 }
}
export async function queuePipelineValues(env:Env,teamIds:string[]){
 if(!env.PIPELINE_VALUES)throw Error('Property collection is not available.');
 for(const teamId of teamIds){
  if(!UUID.test(teamId))throw Error('Invalid team');
  const response=await env.PIPELINE_VALUES.get(env.PIPELINE_VALUES.idFromName(teamId)).fetch('https://values/queue',{method:'POST',body:JSON.stringify({teamId})});
  if(!response.ok)throw Error('Property collection could not be queued.');
 }
}
export async function queueActivePipelineValues(env:Env){
 if(!env.PIPELINE_VALUES)return;
 const teams=await db(env).select('teams','is_active=eq.true&select=id');
 await queuePipelineValues(env,teams.map(t=>t.id));
}
