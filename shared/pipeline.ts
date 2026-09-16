import { PROGRESSION, progressForLead, type ProgressEvent, type ProgressProof, type ProgressRow } from './pipelineProgress';
/** Received-date cohorts with current dispositions and retained stage progression. */
export const PIPELINE_CATEGORIES = ['active', 'under_contract', 'closed', 'nurture', 'rejected', 'unmapped'] as const;
export type PipelineCategory = typeof PIPELINE_CATEGORIES[number];
export interface PipelineLead {
  team_id: string; fub_person_id: number; name: string | null;
  stage: string | null; stage_id?: number | null; assigned_to: string | null;
  assigned_user_id?: number | null; assigned_pond_id?: number | null; pond?: string | null;
  source?: string | null; source_family: string | null; fub_created: string | null;
  synced_at?: string | null; historicalOnly?: boolean;
  history?: Record<string, {date?: string | null; eventId?: string} | null>;
}
export interface PipelineAgent {
  id: string; team_id: string; name: string; fub_user_id: number | null; excluded?: boolean; role?: string | null;
}
export interface StageMapping { category: PipelineCategory; order: number }
export interface PipelineTeam {
  id: string; org_id: string; name: string; fub_subdomain: string | null;
  pipeline_stage_mappings?: Record<string, StageMapping>;
}
export interface PipelineFilters {
  orgId: string; teamId: string | null; from: string | null; through: string; timezone: string; sources: string[];
}
export interface PipelineCount {
  total: number; conversions: number; conversionRate: number | null;
  nurture: number; nurturePct: number | null; rejected: number; rejectedPct: number | null;
}
export interface PipelineOwner extends PipelineCount {
  key: string; teamId: string; name: string; agentId: string | null;
  kind: 'agent' | 'former' | 'pond' | 'unassigned' | 'unresolved' | 'historical';
  leadShare: number | null; conversionShare: number | null; leadKeys: string[];
}
export interface PipelineStage {
  key: string; teamId: string; rawName: string; stageId: number | null;
  category: PipelineCategory; order: number; count: number; percent: number | null; leadKeys: string[];
}
export interface PipelineRecord extends PipelineLead {
  key: string; ownerKey: string; stageKey: string; category: PipelineCategory; fubUrl: string | null;
  progress: Record<string, ProgressProof>;
}
export interface PipelineReport {
  filters: PipelineFilters; snapshotId: string; generatedAt: string; teams: PipelineTeam[];
  sources: string[]; totals: PipelineCount; agents: PipelineOwner[]; stages: PipelineStage[]; leads: PipelineRecord[];
  progression: ProgressRow[];
  coverage: { undated: number; historicalOnly: number; unresolvedOwners: number; unknownStages: number; historyState: string; historyThrough: string | null };
  freshness: { oldestSync: string | null; newestSync: string | null; unknown: number };
  canMapStages: boolean; insightsEnabled: boolean;
}
const normalize = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const leadKey = (l: Pick<PipelineLead, 'team_id' | 'fub_person_id'>) => l.team_id + ':' + l.fub_person_id;
export const stageKey = (l: Pick<PipelineLead, 'stage_id' | 'stage'>) => l.stage_id != null ? 'id:' + l.stage_id : 'name:' + normalize(l.stage);
export const percentage = (n: number, d: number) => d ? n / d * 100 : null;
const defaults: Array<[string[], PipelineCategory, number]> = [
  [['lead', 'new', 'new lead', 'uncontacted'], 'active', 0],
  [['attempted contact', 'attempting contact'], 'active', 10],
  [['spoke with customer', 'contacted'], 'active', 20],
  [['appointment set'], 'active', 30],
  [['met with customer', 'met with', 'met'], 'active', 40],
  [['showing homes'], 'active', 50],
  [['submitting offers', 'offer', 'offers', 'offer submitted'], 'active', 60],
  [['under contract', 'pending', 'escrow'], 'under_contract', 70],
  [['sale closed', 'closed'], 'closed', 80],
  [['nurture'], 'nurture', 90],
  [['rejected'], 'rejected', 100],
];
export function classifyPipelineStage(lead: PipelineLead, mappings: Record<string, StageMapping> = {}): StageMapping {
  const mapped = mappings[stageKey(lead)] ?? mappings['name:' + normalize(lead.stage)];
  if (mapped && PIPELINE_CATEGORIES.includes(mapped.category) && Number.isFinite(mapped.order)) return mapped;
  const match = defaults.find(([names]) => names.includes(normalize(lead.stage)));
  return match ? { category: match[1], order: match[2] } : { category: 'unmapped', order: 110 };
}
export function pipelineCounts(leads: Array<{category: PipelineCategory}>): PipelineCount {
  const total = leads.length, conversions = leads.filter(l => l.category === 'under_contract' || l.category === 'closed').length;
  const nurture = leads.filter(l => l.category === 'nurture').length, rejected = leads.filter(l => l.category === 'rejected').length;
  return {total, conversions, conversionRate: percentage(conversions,total), nurture, nurturePct: percentage(nurture,total), rejected, rejectedPct: percentage(rejected,total)};
}
export function safeFubUrl(subdomain: string | null, id: number): string | null {
  return subdomain && /^[a-z0-9-]+$/i.test(subdomain) && Number.isSafeInteger(id) ? 'https://' + subdomain + '.followupboss.com/2/people/view/' + id : null;
}
function owner(lead: PipelineLead, roster: PipelineAgent[]): Pick<PipelineOwner,'key'|'teamId'|'name'|'agentId'|'kind'> {
  const base = {teamId: lead.team_id, agentId: null};
  if (lead.historicalOnly) return {...base,key:lead.team_id+':historical',name:'Historical only · owner unverified',kind:'historical'};
  if (lead.assigned_pond_id || lead.pond) return {...base,key:lead.team_id+':pond:'+(lead.assigned_pond_id ?? normalize(lead.pond)),name:'Pond · '+(lead.pond || lead.assigned_pond_id),kind:'pond'};
  if (lead.assigned_user_id != null) {
    const found = roster.find(a => a.team_id === lead.team_id && a.fub_user_id === lead.assigned_user_id);
    return {...base,key:lead.team_id+':user:'+lead.assigned_user_id,name:found?.name || lead.assigned_to || 'Former team member',
      agentId:found?.id ?? null,kind:!found || found.excluded ? 'former' : 'agent'};
  }
  // Names alone cannot prove identity, even when exactly one roster name matches.
  if (lead.assigned_to) return {...base,key:lead.team_id+':unresolved:'+normalize(lead.assigned_to),name:lead.assigned_to+' · identity unverified',kind:'unresolved'};
  return {...base,key:lead.team_id+':unassigned',name:'Unassigned',kind:'unassigned'};
}
/** Historical source rules constrain the denominator; live observations win fields. */
export function mergePipelineLeads(saved: PipelineLead[], live: PipelineLead[], teamId: string, starts: Record<string,string>) {
  const rows = new Map(saved.filter(l=>l.team_id===teamId).map(l=>[leadKey(l),{...l,historicalOnly:true}]));
  for (const lead of live.filter(l=>l.team_id===teamId)) {
    const old = rows.get(leadKey(lead));
    if (old) { rows.set(leadKey(lead),{...old,...lead,source_family:old.source_family,historicalOnly:false}); continue; }
    const start = Object.entries(starts).find(([label])=>normalize(label)===normalize(lead.source || lead.source_family))?.[1];
    const created = Date.parse(lead.fub_created || '');
    if (!start || !Number.isFinite(created)) continue;
    const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(created);
    if (day >= start) rows.set(leadKey(lead),{...lead,source_family:lead.source || lead.source_family,historicalOnly:false});
  }
  return [...rows.values()];
}
export function calculatePipeline(input: {
  leads: PipelineLead[]; agents: PipelineAgent[]; teams: PipelineTeam[]; filters: PipelineFilters;
  historyState?: string; historyThrough?: string | null; now?: string; canMapStages?: boolean; insightsEnabled?: boolean;
  events?: ProgressEvent[];
}): PipelineReport {
  const {filters} = input, teams = input.teams.filter(t=>t.org_id===filters.orgId && (!filters.teamId || t.id===filters.teamId));
  const teamMap = new Map(teams.map(t=>[t.id,t]));
  const unique = new Map<string,PipelineLead>();
  for (const l of input.leads) {
    if (!teamMap.has(l.team_id) || !Number.isSafeInteger(l.fub_person_id)) continue;
    const old = unique.get(leadKey(l));
    if (!old || old.historicalOnly && !l.historicalOnly || !!old.historicalOnly === !!l.historicalOnly && (l.synced_at || '') >= (old.synced_at || '')) unique.set(leadKey(l),l);
  }
  const sources = [...new Set([...unique.values()].map(l=>l.source_family).filter((s):s is string=>!!s))].sort();
  let undated = 0;
  const selected = [...unique.values()].filter(l=>{
    if (!l.source_family || filters.sources.length && !filters.sources.includes(l.source_family)) return false;
    const created=Date.parse(l.fub_created || '');
    if (!Number.isFinite(created)) { undated++; return false; }
    return (!filters.from || created>=Date.parse(filters.from)) && created<Date.parse(filters.through);
  });
  const eventsByLead=new Map<string,ProgressEvent[]>();
  for(const e of input.events || []){
    const key=e.team_id+':'+e.person_id;
    const events=eventsByLead.get(key) || [];events.push(e);eventsByLead.set(key,events);
  }
  const owners=new Map<string,ReturnType<typeof owner>>(), stages=new Map<string,PipelineStage>();
  const leads = selected.map(l=>{
    const team=teamMap.get(l.team_id)!, o=owner(l,input.agents), mapping=classifyPipelineStage(l,team.pipeline_stage_mappings);
    owners.set(o.key,o);
    const sk=l.team_id+':'+stageKey(l), key=leadKey(l);
    if(!stages.has(sk)) stages.set(sk,{key:sk,teamId:l.team_id,rawName:l.stage || 'No stage recorded',stageId:l.stage_id ?? null,...mapping,count:0,percent:null,leadKeys:[]});
    const s=stages.get(sk)!;s.count++;s.leadKeys.push(key);
    return {...l,key,ownerKey:o.key,stageKey:sk,category:mapping.category,fubUrl:safeFubUrl(team.fub_subdomain,l.fub_person_id),
      progress:progressForLead(l,eventsByLead.get(key) || [],input.now?Date.parse(input.now):Date.now(),mapping.category)};
  }).sort((a,b)=>a.key.localeCompare(b.key));
  // Active roster members with no leads remain visible, separately by team/id.
  for(const a of input.agents) if(teamMap.has(a.team_id)&&!a.excluded&&a.fub_user_id!=null){
    const key=a.team_id+':user:'+a.fub_user_id;
    if(!owners.has(key))owners.set(key,{key,teamId:a.team_id,name:a.name,agentId:a.id,kind:'agent'});
  }
  const totals=pipelineCounts(leads);
  const agents=[...owners.values()].map(o=>{
    const own=leads.filter(l=>l.ownerKey===o.key), counts=pipelineCounts(own);
    return {...o,...counts,leadShare:percentage(counts.total,totals.total),conversionShare:percentage(counts.conversions,totals.conversions),leadKeys:own.map(l=>l.key)};
  }).sort((a,b)=>b.total-a.total||a.key.localeCompare(b.key));
  const times=leads.filter(l=>!l.historicalOnly).map(l=>l.synced_at).filter((s):s is string=>!!s&&Number.isFinite(Date.parse(s))).sort();
  return {filters,snapshotId:'',generatedAt:input.now || new Date().toISOString(),teams,sources,totals,agents,leads,
    progression:PROGRESSION.map(([key,label])=>{const leadKeys=leads.filter(l=>!!l.progress[key]).map(l=>l.key);return {key,label,leadKeys,count:leadKeys.length,percent:percentage(leadKeys.length,totals.total)};}),
    stages:[...stages.values()].map(s=>({...s,percent:percentage(s.count,totals.total)})).sort((a,b)=>a.order-b.order||a.rawName.localeCompare(b.rawName)||a.key.localeCompare(b.key)),
    coverage:{undated,historicalOnly:leads.filter(l=>l.historicalOnly).length,unresolvedOwners:leads.filter(l=>l.ownerKey.includes(':unresolved:')).length,unknownStages:leads.filter(l=>l.category==='unmapped').length,historyState:input.historyState || 'not_available',historyThrough:input.historyThrough || null},
    freshness:{oldestSync:times[0] || null,newestSync:times.at(-1) || null,unknown:leads.filter(l=>!l.synced_at&&!l.historicalOnly).length},
    canMapStages:!!input.canMapStages,insightsEnabled:!!input.insightsEnabled};
}
/** Exclude mere polling timestamps: an unchanged sync must not invalidate insights. */
export function pipelineSnapshotContent(report: PipelineReport) {
  return JSON.stringify({filters:report.filters,teams:report.teams,coverage:report.coverage,
    agents:report.agents,leads:report.leads.map(({synced_at:_sync,...lead})=>lead)});
}
