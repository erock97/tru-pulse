import type { Env } from './env.js';
import type { UserClient } from './asUser.js';
import { DEFAULT_PROFILE, validateProfile, type ProfileBadge } from '../../shared/agentProfile.js';

export async function handlePersonalProfile(req:Request,env:Env,client:UserClient,cors:Record<string,string>,originOk:boolean):Promise<Response>{
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 if(!['GET','PUT','DELETE'].includes(req.method))return respond({error:'Method not allowed'},405);
 if(req.method!=='GET'&&!originOk)return respond({error:'Origin denied'},403);
 try{
  const profileKey=`agent-profile:v1:${client.userId}`;
  const deletedKey=`agent-profile-deleted:v1:${client.userId}`;
  if(req.method==='DELETE'){
   // Keep a minimal deletion marker so revisiting cannot recreate earned badges.
   await env.SESSIONS.put(deletedKey,JSON.stringify({deletedAt:new Date().toISOString()}));
   await Promise.all([env.SESSIONS.delete(profileKey),env.SESSIONS.delete(`agent-profile-badges:v1:${client.userId}`)]);
   return respond({deleted:true});
  }
  const agents=await client.select<{id:string;org_id:string;team_id:string;fub_user_id:number|null;name:string}>('agents',`auth_id=eq.${client.userId}&select=id,org_id,team_id,fub_user_id,name&limit=2`,{strict:true});
  if(agents.length!==1)return respond({error:'An active agent account is required.'},403);
  const agent=agents[0],key=`agent-profile:v1:${client.userId}`;
  if(req.method==='PUT'){
   const reader=req.body?.getReader();if(!reader)return respond({error:'Profile is missing.'},400);
   let bytes=0;const chunks:Uint8Array[]=[];
   while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2100000){await reader.cancel();return respond({error:'Profile images are too large.'},413);}chunks.push(value);}
   const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
   let profile;try{profile=validateProfile(JSON.parse(new TextDecoder().decode(buffer)));}catch(e){return respond({error:e instanceof Error?e.message:'Invalid profile.'},400);}
   if(profile.termsVersion!=='2026-09-06')return respond({error:'Please accept the profile content terms before saving.'},400);
   const saved={profile,updatedAt:new Date().toISOString(),termsAcceptedAt:new Date().toISOString()};await env.SESSIONS.put(key,JSON.stringify(saved));await env.SESSIONS.delete(deletedKey);return respond(saved);
  }
  if(await env.SESSIONS.get(deletedKey,'json'))return respond({profile:{...DEFAULT_PROFILE},updatedAt:null,badges:[],deleted:true});
  const saved=await env.SESSIONS.get(key,'json') as {profile:unknown;updatedAt:string}|null;
  const profile=saved?validateProfile(saved.profile):{...DEFAULT_PROFILE};
  const badgeKey=`agent-profile-badges:v1:${client.userId}`;
  const old=await env.SESSIONS.get(badgeKey,'json') as ProfileBadge[]|null;
  const badges=[...(Array.isArray(old)?old:[])];let badgeNotice='';
  const award=(badge:ProfileBadge)=>{if(!badges.some(b=>b.id===badge.id))badges.push(badge);};
  try{
   const passed=await client.select<{module_id:string;passed_at:string|null}>('rep_progress',`agent_id=eq.${agent.id}&status=eq.passed&select=module_id,passed_at`,{strict:true});
   const modules=await client.select<{id:string;title:string}>('rep_modules','select=id,title',{strict:true});
   for(const progress of passed){const module=modules.find(m=>m.id===progress.module_id);award({id:`training:${progress.module_id}`,kind:'training',title:module?.title??'Training completed',detail:'Passed the course assessment',verifiedAt:progress.passed_at??new Date().toISOString()});}
   // The imported history attributes credits to the assigned FUB identity at import.
   // This is a recorded lead-history milestone, not proof of career-long production.
   // Match stable IDs within the authenticated agent's organization and team.
   const snapshot=await env.SESSIONS.get(`pulse-history:v1:${agent.org_id}`,'json') as {orgId:string;teamId:string;through:string;stageLog?:{team_id:string;fub_person_id:number;stage_class:string;changed_at:string;agent_user_id:number|string|null}[]}|null;
   if(snapshot&&snapshot.orgId===agent.org_id&&snapshot.teamId===agent.team_id&&agent.fub_user_id!=null){
    const contracts=new Set((snapshot.stageLog??[]).filter(event=>
     event.team_id===agent.team_id&&String(event.agent_user_id)===String(agent.fub_user_id)&&
     ['uc','closed'].includes(event.stage_class)&&Number.isFinite(Date.parse(event.changed_at))&&Date.parse(event.changed_at)<=Date.now()
    ).map(event=>event.fub_person_id)).size;
    for(const threshold of [1,5,10,25,50,100])if(contracts>=threshold)award({id:`contracts:${threshold}`,kind:'contract',title:`${threshold} recorded ${threshold===1?'contract':'contracts'}`,detail:'Based on your assigned leads in TRU’s imported history',verifiedAt:new Date().toISOString()});
   }
  }catch{badgeNotice='Some accomplishments could not be checked. Previously earned badges are still here.';}
  // Recheck after source lookups so an in-flight badge refresh respects deletion.
  if(await env.SESSIONS.get(deletedKey,'json'))return respond({profile:{...DEFAULT_PROFILE},updatedAt:null,badges:[],deleted:true});
  if(badges.length!==(old?.length??0))await env.SESSIONS.put(badgeKey,JSON.stringify(badges));
  return respond({profile,updatedAt:saved?.updatedAt??null,badges,badgeNotice});
 }catch{return respond({error:'Your profile could not be loaded or saved. Please try again.'},503);}
}
