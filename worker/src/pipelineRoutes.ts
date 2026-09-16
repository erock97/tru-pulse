import type { Env } from './env.js';
import type { UserClient } from './asUser.js';
import { db as serviceDb } from './db.js';
import { readHistoryVersion } from './historyMetadata.js';
import { calculatePipeline, mergePipelineLeads, pipelineSnapshotContent, PIPELINE_CATEGORIES,
  type PipelineFilters, type PipelineTeam, type PipelineLead, type PipelineAgent, type PipelineReport, type StageMapping } from '../../shared/pipeline.js';

import { PipelineError, digest } from './pipelineSupport.js';
export { PipelineError, digest } from './pipelineSupport.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePipelineFilters(value:Record<string,unknown>):PipelineFilters {
  const orgId=String(value.orgId || ''),teamId=value.teamId?String(value.teamId):null;
  if(!UUID.test(orgId)||teamId&&!UUID.test(teamId))throw new PipelineError('Choose a valid team.',400);
  const timestamp=(v:unknown)=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
  const from=value.from?String(value.from):null,through=String(value.through || '');
  if(!timestamp(through)||from&&!timestamp(from)||from&&Date.parse(from)>=Date.parse(through))throw new PipelineError('Choose a valid date range.',400);
  if(Date.parse(through)>Date.now()+86400000)throw new PipelineError('The reporting period cannot extend into the future.',400);
  const timezone=String(value.timezone || 'UTC');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw new PipelineError('Invalid timezone.',400);}
  const sources=Array.isArray(value.sources)?value.sources:[];
  if(sources.length>100||sources.some(s=>typeof s!=='string'||s.length>150))throw new PipelineError('Invalid source filter.',400);
  return {orgId,teamId,from,through,timezone,sources:[...new Set(sources as string[])].sort()};
}
async function all<T>(db:UserClient,table:string,query:string):Promise<T[]> {
  const rows:T[]=[];
  for(let offset=0;offset<200000;offset+=1000){
    const page=await db.select<T>(table,query+'&limit=1000&offset='+offset,{strict:true});
    rows.push(...page);if(page.length<1000)return rows;
  }
  throw new PipelineError('The report is too large. Choose one team.',422);
}
export async function pipelineAccess(db:UserClient,filters:PipelineFilters) {
  const [members,admins,teams]=await Promise.all([
    db.select<{role:string}>('memberships','select=role&user_id=eq.'+db.userId+'&org_id=eq.'+filters.orgId,{strict:true}),
    db.select<{id:string}>('admins','select=id&id=eq.'+db.userId,{strict:true}),
    db.select<PipelineTeam>('teams','select=*&org_id=eq.'+filters.orgId+(filters.teamId?'&id=eq.'+filters.teamId:''),{strict:true}),
  ]);
  const manage=!!admins.length||members.some(m=>['leader','admin','owner'].includes(m.role));
  if(!manage&&!members.some(m=>m.role==='coach')||!teams.length||teams.some(t=>t.org_id!==filters.orgId || filters.teamId&&t.id!==filters.teamId))throw new PipelineError('You cannot access this team.',403);
  return {teams,manage};
}
export async function loadPipeline(env:Env,db:UserClient,filters:PipelineFilters):Promise<PipelineReport> {
  const {teams,manage}=await pipelineAccess(db,filters);
  const ids=teams.map(t=>t.id);
  if(ids.some(id=>!UUID.test(id)))throw new PipelineError('Invalid team configuration.',502);
  const [raw,roster,settings]=await Promise.all([
    all<PipelineLead>(db,'leads','select=*&team_id=in.('+ids.join(',')+')&order=team_id.asc,fub_person_id.asc'),
    all<PipelineAgent>(db,'agents','select=id,team_id,name,fub_user_id,excluded,role&team_id=in.('+ids.join(',')+')&order=id.asc'),
    db.select<{sources:string[]|null}>('org_settings','select=sources&org_id=eq.'+filters.orgId,{strict:true}),
  ]);
  // Allowlist response fields; select=* supports a schema rolling out separately.
  let leads:PipelineLead[]=raw.map(l=>({team_id:l.team_id,fub_person_id:l.fub_person_id,name:l.name,stage:l.stage,
    stage_id:l.stage_id,assigned_to:l.assigned_to,assigned_user_id:l.assigned_user_id,assigned_pond_id:l.assigned_pond_id,
    pond:l.pond,source:l.source,source_family:l.source_family,fub_created:l.fub_created,synced_at:l.synced_at}));
  let historyState='not_available',historyThrough:string|null=null;
  const legacy=await env.SESSIONS.get('pulse-history:v1:'+filters.orgId,'json') as {orgId:string;teamId?:string}|null;
  let history;
  try{history=await readHistoryVersion(serviceDb(env),filters.orgId,legacy);}
  catch{throw new PipelineError('Historical coverage could not be verified. Refresh to retry.',502);}
  const snap=history.snapshot as {orgId:string;teamId:string;leads:PipelineLead[];sourceStarts:Record<string,string>;through:string}|null;
  if(snap){
    if(snap.orgId!==filters.orgId)throw new PipelineError('Historical report scope mismatch.',502);
    // History may belong to a different, inaccessible team in the same org.
    if(ids.includes(snap.teamId)){
      if(!Array.isArray(snap.leads)||!snap.sourceStarts)throw new PipelineError('Historical report is incomplete.',502);
      leads=[...leads.filter(l=>l.team_id!==snap.teamId),...mergePipelineLeads(snap.leads,leads,snap.teamId,snap.sourceStarts)];
      historyThrough=snap.through;
    }
  }
  historyState=history.coverage.state || (history.coverage.complete?'complete':'partial');
  const enabled=settings[0]?.sources;
  if(enabled?.length){
    const currentFamilies=new Map(raw.map(l=>[l.team_id+':'+l.fub_person_id,l.source_family]));
    leads=leads.filter(l=>enabled.includes(l.source_family || '') || enabled.includes(currentFamilies.get(l.team_id+':'+l.fub_person_id) || ''));
  }
  const report=calculatePipeline({leads,agents:roster,teams:teams.map(t=>({id:t.id,org_id:t.org_id,name:t.name,fub_subdomain:t.fub_subdomain,pipeline_stage_mappings:t.pipeline_stage_mappings})),
    filters,historyState,historyThrough,canMapStages:manage,insightsEnabled:env.PIPELINE_INSIGHTS_ENABLED==='1'});
  report.snapshotId=await digest(pipelineSnapshotContent(report));
  return report;
}
export async function handlePipeline(req:Request,env:Env,db:UserClient,url:URL,cors:Record<string,string>,originOk:boolean):Promise<Response|null> {
  if(!url.pathname.startsWith('/data/pipeline'))return null;
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{...cors,'Cache-Control':'private, no-store'}});
  try{
    if(req.method!=='GET'&&!originOk)return json({error:'Untrusted origin.'},403);
    const rawBody=req.method==='GET'?Object.fromEntries(url.searchParams):await req.json().catch(()=>{throw new PipelineError('Invalid request.',400);});
    if(!rawBody || typeof rawBody!=='object'||Array.isArray(rawBody))throw new PipelineError('Invalid request.',400);
    const body=rawBody as Record<string,unknown>;
    if(req.method==='GET')body.sources=url.searchParams.getAll('source');
    const filters=parsePipelineFilters(body);
    if(url.pathname==='/data/pipeline'&&req.method==='GET')return json(await loadPipeline(env,db,filters));
    if(url.pathname==='/data/pipeline/mappings'&&req.method==='PUT'){
      const {teams,manage}=await pipelineAccess(db,filters);
      if(!manage||!filters.teamId||teams.length!==1)throw new PipelineError('Only a team leader can change stage mappings.',403);
      if(!Object.hasOwn(teams[0],'pipeline_stage_mappings'))throw new PipelineError('Stage mapping becomes available after the reviewed migration is applied.',409);
      const mappings=body.mappings as Record<string,StageMapping>;
      if(!mappings||Array.isArray(mappings)||typeof mappings!=='object'||Object.keys(mappings).length>300)throw new PipelineError('Invalid stage mappings.',400);
      for(const [key,mapping] of Object.entries(mappings)){
        if(!/^(id:\d+|name:.{0,150})$/.test(key)||!mapping||!PIPELINE_CATEGORIES.includes(mapping.category)||!Number.isInteger(mapping.order)||mapping.order<0||mapping.order>10000)throw new PipelineError('Invalid stage mapping.',400);
      }
      if(body.mappingVersion!==await digest(JSON.stringify(teams[0].pipeline_stage_mappings || {})))throw new PipelineError('Stage mappings changed. Refresh before saving.',409);
      await serviceDb(env).update('teams','id=eq.'+filters.teamId+'&org_id=eq.'+filters.orgId,{pipeline_stage_mappings:mappings});
      return json({saved:true});
    }
    return json({error:'Unsupported pipeline operation.'},405);
  }catch(e){
    return json({error:e instanceof PipelineError?e.message:'Pipeline data could not be loaded. Please retry.'},e instanceof PipelineError?e.status:502);
  }
}
