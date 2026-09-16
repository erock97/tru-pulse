import type { Env } from './env.js';
import type { UserClient } from './asUser.js';
import { db as serviceDb } from './db.js';
import { readHistoryVersion } from './historyMetadata.js';
import { calculatePipeline, mergePipelineLeads, pipelineSnapshotContent, PIPELINE_CATEGORIES,
  type PipelineFilters, type PipelineTeam, type PipelineLead, type PipelineAgent, type PipelineReport, type StageMapping } from '../../shared/pipeline.js';
import { pipelineInsights } from './pipelineInsights.js';
import { checkPipelineValues } from './pipelineValue.js';
import { VALUE_POLICY, type InquiryValue } from '../../shared/pipelineValue.js';
import type { ProgressEvent } from '../../shared/pipelineProgress.js';
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
    db.rpc<boolean>('is_admin',{}),
    db.select<PipelineTeam>('teams','select=*&org_id=eq.'+filters.orgId+(filters.teamId?'&id=eq.'+filters.teamId:''),{strict:true}),
  ]);
  const manage=admins.ok&&admins.data===true||members.some(m=>['leader','admin','owner'].includes(m.role));
  if(!manage&&!members.some(m=>m.role==='coach')||!teams.length||teams.some(t=>t.org_id!==filters.orgId || filters.teamId&&t.id!==filters.teamId))throw new PipelineError('You cannot access this team.',403);
  return {teams,manage};
}
export async function loadPipeline(env:Env,db:UserClient,filters:PipelineFilters):Promise<PipelineReport> {
  const {teams,manage}=await pipelineAccess(db,filters);
  const ids=teams.map(t=>t.id);
  if(ids.some(id=>!UUID.test(id)))throw new PipelineError('Invalid team configuration.',502);
  const [raw,roster,settings]=await Promise.all([
    all<PipelineLead & {pipeline_inquiry_value?:InquiryValue}>(db,'leads','select=*&team_id=in.('+ids.join(',')+')&order=team_id.asc,fub_person_id.asc'),
    all<PipelineAgent>(db,'agents','select=id,team_id,name,fub_user_id,excluded,role&team_id=in.('+ids.join(',')+')&order=id.asc'),
    db.select<{sources:string[]|null}>('org_settings','select=sources&org_id=eq.'+filters.orgId,{strict:true}),
  ]);
  const events:ProgressEvent[]=[];
  // Allowlist response fields; select=* supports a schema rolling out separately.
  let leads:PipelineLead[]=raw.map(l=>({team_id:l.team_id,fub_person_id:l.fub_person_id,name:l.name,stage:l.stage,
    stage_id:l.stage_id,assigned_to:l.assigned_to,assigned_user_id:l.assigned_user_id,assigned_pond_id:l.assigned_pond_id,
    pond:l.pond,source:l.source,source_family:l.source_family,fub_created:l.fub_created,synced_at:l.synced_at}));
  let historyState='not_available',historyThrough:string|null=null;
  const legacy=await env.SESSIONS.get('pulse-history:v1:'+filters.orgId,'json') as {orgId:string;teamId?:string}|null;
  let history;
  try{history=await readHistoryVersion(serviceDb(env),filters.orgId,legacy);}
  catch{throw new PipelineError('Historical coverage could not be verified. Refresh to retry.',502);}
  const snap=history.snapshot as {orgId:string;teamId:string;leads:PipelineLead[];sourceStarts:Record<string,string>;through:string;stageLog?:Array<{team_id:string;fub_person_id:number;stage_class:string;changed_at:string|null;date_source:string;event_id?:string}>}|null;
  if(snap){
    if(snap.orgId!==filters.orgId)throw new PipelineError('Historical report scope mismatch.',502);
    // History may belong to a different, inaccessible team in the same org.
    if(ids.includes(snap.teamId)){
      if(!Array.isArray(snap.leads)||!snap.sourceStarts)throw new PipelineError('Historical report is incomplete.',502);
      leads=[...leads.filter(l=>l.team_id!==snap.teamId),...mergePipelineLeads(snap.leads,leads,snap.teamId,snap.sourceStarts)];
      for(const hit of snap.stageLog || [])if(hit.team_id===snap.teamId&&hit.date_source!=='seed')events.push({
        team_id:hit.team_id,person_id:hit.fub_person_id,from_stage:null,to_stage:hit.stage_class,
        occurred_at:hit.changed_at,upstream_kind:'historical backfill',upstream_id:hit.event_id || 'snapshot:'+hit.fub_person_id+':'+hit.stage_class,
      });
      historyThrough=snap.through;
    }
  }
  historyState=history.coverage.state || (history.coverage.complete?'complete':'partial');
  const enabled=settings[0]?.sources;
  if(enabled?.length){
    const currentFamilies=new Map(raw.map(l=>[l.team_id+':'+l.fub_person_id,l.source_family]));
    leads=leads.filter(l=>enabled.includes(l.source_family || '') || enabled.includes(currentFamilies.get(l.team_id+':'+l.fub_person_id) || ''));
  }
  const cohort=leads.filter(l=>Number.isFinite(Date.parse(l.fub_created || ''))&&
    (!filters.from||Date.parse(l.fub_created!)>=Date.parse(filters.from))&&Date.parse(l.fub_created!)<Date.parse(filters.through)&&
    (!filters.sources.length||filters.sources.includes(l.source_family || '')));
  events.push(...await readProgressEvents(env,filters.orgId,ids,cohort));
  const report=calculatePipeline({leads,agents:roster,teams:teams.map(t=>({id:t.id,org_id:t.org_id,name:t.name,fub_subdomain:t.fub_subdomain,pipeline_stage_mappings:t.pipeline_stage_mappings})),
    filters,events,historyState,historyThrough,canMapStages:manage,insightsEnabled:env.PIPELINE_INSIGHTS_ENABLED==='1'});
  report.snapshotId=await digest(pipelineSnapshotContent(report));
  const visible=new Set(report.leads.filter(l=>!l.historicalOnly).map(l=>l.key));
  report.propertyValues=Object.fromEntries(raw.filter(l=>visible.has(l.team_id+':'+l.fub_person_id)&&l.pipeline_inquiry_value?.policy===VALUE_POLICY)
    .map(l=>[l.team_id+':'+l.fub_person_id,l.pipeline_inquiry_value!]));
  return report;
}
/** Canonical history is private. Call only after user/RLS team authorization.
 * Read retained webhook events directly so progress survives queue coalescing,
 * a later Nurture status, and the older offer-only compatibility projection. */
async function readProgressEvents(env:Env,orgId:string,teamIds:string[],leads:PipelineLead[]):Promise<ProgressEvent[]> {
  const database=serviceDb(env),events:ProgressEvent[]=[];
  const batches:Array<{teamId:string;selectedIds:number[]}>=[];
  for(const teamId of teamIds){
   const personIds=[...new Set(leads.filter(l=>l.team_id===teamId&&Number.isSafeInteger(l.fub_person_id)).map(l=>l.fub_person_id))];
   for(let batch=0;batch<personIds.length;batch+=200){
    batches.push({teamId,selectedIds:personIds.slice(batch,batch+200)});
   }
  }
  // Bound database pressure while avoiding a serial round trip per 200 leads.
  let next=0;
  const ordered:ProgressEvent[][]=[];
  await Promise.all(Array.from({length:Math.min(4,batches.length)},async()=>{
   while(next<batches.length){
    const index=next++,{teamId,selectedIds}=batches[index];
    ordered[index]=[];
    for(let offset=0;;offset+=1000){
    if(events.length>=200000)throw new PipelineError('Stage history is too large. Choose a shorter received-date period.',422);
    const page=await database.select('history_stage_events',
      'select=org_id,team_id,person_id,from_stage,to_stage,occurred_at,upstream_id,upstream_kind&org_id=eq.'+orgId+
      '&team_id=eq.'+teamId+'&person_id=in.('+selectedIds.join(',')+')&order=person_id.asc,upstream_kind.asc,upstream_id.asc&limit=1000&offset='+offset);
    if(page.some(e=>e.org_id!==orgId||e.team_id!==teamId||!selectedIds.includes(e.person_id)))throw new PipelineError('Stage history scope mismatch.',502);
    if(events.length+page.length>200000)throw new PipelineError('Stage history is too large. Choose a shorter received-date period.',422);
    const rows=page.map(({org_id:_org,...event})=>event as ProgressEvent);
    events.push(...rows);ordered[index].push(...rows);
    if(page.length<1000)break;
    }
   }
  }));
  return ordered.flat();
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
    if(url.pathname==='/data/pipeline/property-values'&&req.method==='POST'){
      const report=await loadPipeline(env,db,filters);
      if(body.snapshotId!==report.snapshotId)throw new PipelineError('The pipeline changed. Refresh before checking inquiry values.',409);
      const values=await checkPipelineValues(env,report,body.leadKeys);
      if((await loadPipeline(env,db,filters)).snapshotId!==report.snapshotId)throw new PipelineError('The pipeline changed during the check. Refresh and retry.',409);
      for(const [key,value] of Object.entries(values)){
        const lead=report.leads.find(l=>l.key===key)!;
        await serviceDb(env).update('leads','team_id=eq.'+lead.team_id+'&fub_person_id=eq.'+lead.fub_person_id,{pipeline_inquiry_value:value});
      }
      return json({snapshotId:report.snapshotId,values,evidenceVersion:await digest(JSON.stringify(values))});
    }
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
    if(url.pathname==='/data/pipeline/insights'&&req.method==='POST'){
      const report=await loadPipeline(env,db,filters);
      if(body.snapshotId!==report.snapshotId)throw new PipelineError('The pipeline changed. Refresh the report before generating insights.',409);
      const owner=report.agents.find(a=>a.key===body.agentKey);
      if(!owner||!owner.agentId||owner.kind!=='agent')throw new PipelineError('Choose an agent with a verified identity.',422);
      if(!report.insightsEnabled)throw new PipelineError('AI insights are awaiting release validation.',503);
      const result=await pipelineInsights(env,db,report,owner);
      // Never attach an answer to a different pipeline after an in-flight update.
      const current=await loadPipeline(env,db,filters);
      if(current.snapshotId!==report.snapshotId)throw new PipelineError('The pipeline changed while insights were generated. Refresh and retry.',409);
      return json(result);
    }
    return json({error:'Unsupported pipeline operation.'},405);
  }catch(e){
    return json({error:e instanceof PipelineError?e.message:'Pipeline data could not be loaded. Please retry.'},e instanceof PipelineError?e.status:502);
  }
}
