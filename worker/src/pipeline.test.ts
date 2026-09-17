import {describe,it,expect} from 'vitest';
import {pipelineFixture} from '../../shared/pipelineFixture';
import {calculatePipeline,classifyPipelineStage,mergePipelineLeads,pipelineSnapshotContent,type PipelineLead,type PipelineFilters} from '../../shared/pipeline';
const filters:PipelineFilters={orgId:'o',teamId:null,from:'2026-01-01T00:00:00Z',through:'2026-10-01T00:00:00Z',timezone:'UTC',sources:[]};
const team={id:'t',org_id:'o',name:'Team',fub_subdomain:'sample'};
const lead=(patch:Partial<PipelineLead>={}):PipelineLead=>({team_id:'t',fub_person_id:1,name:'Lead',stage:'Nurture',assigned_to:'Alex',assigned_user_id:7,source_family:'Zillow',source:'Zillow',fub_created:'2026-09-01T12:00:00Z',synced_at:'2026-09-15T12:00:00Z',...patch});
const roster=[{id:'a',team_id:'t',name:'Alex',fub_user_id:7}];
const calc=(leads:PipelineLead[],f=filters)=>calculatePipeline({leads,agents:roster,teams:[team],filters:f});
describe('current-stage pipeline cohorts',()=>{
 it('reproduces the screenshot and reconciles every lead',()=>{
  const r=pipelineFixture(),a=r.agents.find(a=>a.name==='Alex Morgan')!;
  expect(r.totals).toMatchObject({total:504,conversions:31,nurture:240,rejected:80});
  expect(a).toMatchObject({total:165,conversions:12,nurture:76,rejected:26});
  expect(a.leadShare?.toFixed(1)).toBe('32.7');expect(a.conversionShare?.toFixed(1)).toBe('38.7');expect(a.conversionRate?.toFixed(1)).toBe('7.3');
  expect(r.agents.reduce((s,a)=>s+a.total,0)).toBe(504);expect(r.stages.reduce((s,a)=>s+a.count,0)).toBe(504);
  expect(new Set(r.stages.flatMap(s=>s.leadKeys)).size).toBe(504);
 });
 it('counts each team/person once, choosing the newer observation',()=>{
  const r=calc([lead(),lead({stage:'Closed',synced_at:'2026-09-16T00:00:00Z'})]);expect(r.totals.total).toBe(1);expect(r.totals.conversions).toBe(1);
 });
 it('does not conflate person IDs across teams or same-name owners',()=>{
  const r=calculatePipeline({leads:[lead(),lead({team_id:'t2',stage:'Closed'})],agents:[...roster,{...roster[0],id:'b',team_id:'t2'}],teams:[team,{...team,id:'t2'}],filters});
  expect(r.leads).toHaveLength(2);expect(r.agents).toHaveLength(2);expect(r.agents.map(a=>a.key)).toEqual(['t:user:7','t2:user:7']);
 });
 it('preserves the team denominator when drilling into an agent',()=>{
  const r=calc([lead(),lead({fub_person_id:2,assigned_user_id:9,stage:'Closed'})]);
  expect(r.agents[0].leadShare).toBe(50);expect(r.totals.total).toBe(2);
 });
 it('credits the current owner and survives a roster name change',()=>{
  const r=calc([lead({assigned_to:'Old spelling',assigned_user_id:7,stage:'Closed'})]);expect(r.agents[0].name).toBe('Alex');
  expect(calc([lead({assigned_user_id:8})]).agents.find(a=>a.total)?.kind).toBe('former');
 });
 it('does not guess legacy identity, even with a matching name',()=>{
  const r=calc([lead({assigned_user_id:undefined})]);expect(r.agents.find(a=>a.total)?.kind).toBe('unresolved');expect(r.coverage.unresolvedOwners).toBe(1);
 });
 it('keeps ponds, unassigned and former books in team totals',()=>{
  const r=calc([lead({assigned_pond_id:3,pond:'Team book'}),lead({fub_person_id:2,assigned_user_id:null,assigned_to:null}),lead({fub_person_id:3,assigned_user_id:99})]);
  expect(r.totals.total).toBe(3);expect(r.agents.filter(a=>a.total).map(a=>a.kind).sort()).toEqual(['former','pond','unassigned']);
 });
 it('never silently classifies custom or negative stage names',()=>{
  for(const stage of ['Not under contract','Nurture - six months','Inactive','No longer looking','Disclosure'])expect(classifyPipelineStage(lead({stage})).category).toBe('unmapped');
 });
 it('blends Trash with Rejected while preserving raw stage and earlier progress',()=>{
  const r=calc([lead({stage:'Trash',history:{met:{date:'2026-09-02T00:00:00Z'}}}),lead({fub_person_id:2,stage:'Rejected'})]);
  expect(r.totals.rejected).toBe(2);expect(r.totals.rejectedPct).toBe(100);expect(r.totals.conversions).toBe(0);
  expect(r.stages.map(s=>s.rawName)).toContain('Trash');
  expect(r.leads[0].progress.met).toBeTruthy();expect(r.leads[0].progress.appointment).toBeTruthy();expect(r.leads[0].progress.offer).toBeUndefined();
 });
 it('retains prior observed steps without inventing an achievement date or future steps',()=>{
  const r=calc([lead({stage:'Trash',observedStages:{'Met with customer':'2026-09-01T12:00:00Z','Closed':'2099-01-01T00:00:00Z'}})]);
  expect(r.leads[0].progress.met).toMatchObject({source:'previous FUB observation',at:null});
  expect(r.leads[0].progress.appointment).toBeTruthy();expect(r.leads[0].progress.closed).toBeUndefined();
 });
 it('uses team-specific stage-ID mappings without losing raw labels',()=>{
  const r=calculatePipeline({leads:[lead({stage:'Long horizon',stage_id:42})],agents:roster,teams:[{...team,pipeline_stage_mappings:{'id:42':{category:'nurture',order:90}}}],filters});
  expect(r.stages[0].rawName).toBe('Long horizon');expect(r.totals.nurture).toBe(1);
 });
 it('does not inflate conversion with historical achievement or rejected leads',()=>{
  const r=calc([lead({stage:'Under contract'}),lead({fub_person_id:2,stage:'Closed'}),lead({fub_person_id:3,stage:'Rejected'})]);
  expect(r.totals.conversions).toBe(2);expect(r.stages).toHaveLength(3);
 });
 it('filters sources and excludes undated, future and boundary leads',()=>{
  const r=calc([lead(),lead({fub_person_id:2,source_family:'Facebook'}),lead({fub_person_id:3,fub_created:null}),lead({fub_person_id:4,fub_created:filters.through})],{...filters,sources:['Zillow']});
  expect(r.totals.total).toBe(1);expect(r.coverage.undated).toBe(1);
 });
 it('returns null only when a rate denominator is empty',()=>{
  const empty=calc([]);expect(empty.totals.conversionRate).toBeNull();
  const r=calc([lead()]);expect(r.totals.conversionRate).toBe(0);expect(r.agents[0].conversionShare).toBeNull();
 });
 it('keeps historical-only owners separate and preserves live current stages',()=>{
  const merged=mergePipelineLeads([lead(),lead({fub_person_id:2})],[lead({stage:'Closed'})],'t',{Zillow:'2026-01-01'});
  const r=calc(merged);expect(r.coverage.historicalOnly).toBe(1);expect(r.totals.conversions).toBe(1);
  expect(r.agents.find(a=>a.kind==='historical')?.total).toBe(1);
 });
 it('preserves verified source-start rules',()=>{
  const merged=mergePipelineLeads([], [lead(),lead({fub_person_id:2,source:'Zillow rentals'}),lead({fub_person_id:3,fub_created:'2025-12-01T00:00:00Z'})],'t',{Zillow:'2026-01-01'});
  expect(merged).toHaveLength(1);
 });
 it('changes snapshot content on reassignment or mapping but not unchanged polling',()=>{
  const a=pipelineSnapshotContent(calc([lead()]));
  expect(pipelineSnapshotContent(calc([lead({synced_at:'2026-09-16T00:00:00Z'})]))).toBe(a);
  expect(pipelineSnapshotContent(calc([lead({assigned_user_id:8})]))).not.toBe(a);
 });
});
