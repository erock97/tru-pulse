import type {Env} from './env.js';
import type {TeamRow} from './sync.js';
/** Disabled at Eric's request. No authentication, collection, or rescheduling. */
export class TimelineCollector {
 constructor(private state:DurableObjectState,private env:Env){}
 private async stop(){
  await this.state.storage.deleteAlarm();
  const team=await this.state.storage.get<TeamRow>('team');
  const status={state:'paused',stoppedAt:new Date().toISOString(),reason:'Disabled at owner request; automatic sign-ins stopped'};
  await this.state.storage.put('status',status);
  if(team)await this.env.SESSIONS.put('collector-health:v1:'+team.id,JSON.stringify(status));
  return status;
 }
 async fetch(req:Request){
  const health=await this.stop();
  if(new URL(req.url).pathname==='/counts')return Response.json({});
  return Response.json({queued:false,snapshot:null,health});
 }
 async alarm(){await this.stop();}
}
export async function enqueueTimelines(env:Env,team:TeamRow,_people:unknown[],_priority=false){
 if(!env.TIMELINES)return;
 await env.TIMELINES.get(env.TIMELINES.idFromName(team.id)).fetch('https://collector/stop',{method:'POST'});
}
