import {describe,it,expect,vi,beforeEach} from 'vitest';
import {handlePipeline,loadPipeline,parsePipelineFilters,digest} from './pipelineRoutes';
import type {UserClient} from './asUser';
import type {Env} from './env';
const mocks=vi.hoisted(()=>({history:vi.fn(),update:vi.fn(),insights:vi.fn(),events:vi.fn(),values:vi.fn()}));
vi.mock('./pipelineValue',()=>({checkPipelineValues:mocks.values}));
vi.mock('./historyMetadata',()=>({readHistoryVersion:mocks.history}));
vi.mock('./db',()=>({db:()=>({update:mocks.update,select:mocks.events})}));
vi.mock('./pipelineInsights',()=>({pipelineInsights:mocks.insights}));
const org='00000000-0000-4000-8000-000000000001',team='00000000-0000-4000-8000-000000000002',agent='00000000-0000-4000-8000-000000000003';
const filters={orgId:org,teamId:team,from:'2026-01-01T00:00:00Z',through:new Date().toISOString(),timezone:'America/Los_Angeles',sources:[]};
const teamRow={id:team,org_id:org,name:'Team',fub_subdomain:'team',pipeline_stage_mappings:{}};
const lead={team_id:team,fub_person_id:1,name:'Buyer',assigned_to:'Agent',assigned_user_id:3,stage:'Nurture',source_family:'Zillow',fub_created:'2026-02-01T00:00:00Z',synced_at:'2026-09-01T00:00:00Z'};
const env={SESSIONS:{get:vi.fn().mockResolvedValue(null)},PIPELINE_INSIGHTS_ENABLED:'1'} as unknown as Env;
function client(over:Record<string,unknown[]>={}){
 const tables:Record<string,unknown[]>={memberships:[{role:'leader'}],admins:[],teams:[teamRow],leads:[lead],agents:[{id:agent,team_id:team,name:'Agent',fub_user_id:3}],org_settings:[],...over};
 return {userId:'user',rpc:vi.fn(async()=>({ok:true,data:!!tables.admins.length})),select:vi.fn(async(table:string,query:string)=>Number(new URLSearchParams(query).get('offset')||0)>0?[]:tables[table]||[])} as unknown as UserClient;
}
async function call(db:UserClient,path='/data/pipeline',method='GET',body:Record<string,unknown>={},origin=true){
 const url=new URL('https://api.test'+path);
 if(method==='GET')for(const [k,v] of Object.entries(filters))if(typeof v==='string')url.searchParams.set(k,v);
 const req=new Request(url,{method,...(method==='GET'?{}:{body:JSON.stringify({...filters,...body})})});
 return (await handlePipeline(req,env,db,url,{},origin))!;
}
beforeEach(()=>{vi.clearAllMocks();mocks.events.mockResolvedValue([]);mocks.history.mockResolvedValue({snapshot:null,coverage:{state:'not_started',complete:false}});});
describe('pipeline route isolation and consistency',()=>{
 it('restricts saved-value refresh and collection to authorized teams',async()=>{
  for(const [path,method] of [['/data/pipeline/property-values','GET'],['/data/pipeline/property-values/collect','POST']]){
   const db=client({memberships:[{role:'agent'}]});expect((await call(db,path,method)).status).toBe(403);
   expect((db.select as any).mock.calls.some((c:any[])=>c[0]==='leads')).toBe(false);
   expect((await call(client({teams:[]}),path,method)).status).toBe(403);
  }
 });
 it('refreshes minimal saved values without rebuilding stage history or accessing FUB',async()=>{
  const value={policy:'inquiry-v1',status:'included',amount:300000};
  const db=client({leads:[{...lead,pipeline_inquiry_value:value},{...lead,fub_person_id:2,pipeline_inquiry_value:{...value,policy:'old'}}]});
  const response=await call(db,'/data/pipeline/property-values'),body=await response.json() as any;
  expect(body.values).toEqual({[team+':1']:value});expect(mocks.history).not.toHaveBeenCalled();expect(mocks.values).not.toHaveBeenCalled();
  expect((db.select as any).mock.calls.find((c:any[])=>c[0]==='leads')[1]).toContain('team_id=in.('+team+')');
 });
 it('overlaps at most four history batches without dropping leads or changing snapshots',async()=>{
  let active=0,maximum=0;
  mocks.events.mockImplementation(async(_table,query)=>{
   active++;maximum=Math.max(maximum,active);
   const ids=new URLSearchParams(query).get('person_id')!.slice(4,-1).split(',').map(Number);
   await new Promise(r=>setTimeout(r,ids[0]===1?12:1));active--;
   return ids.map(id=>({org_id:org,team_id:team,person_id:id,from_stage:'Lead',to_stage:'Met with Customer',occurred_at:'2026-03-01T00:00:00Z',upstream_id:'event-'+id,upstream_kind:'webhook'}));
  });
  const leads=Array.from({length:999},(_,i)=>({...lead,fub_person_id:i+1}));
  const first=await loadPipeline(env,client({leads}),filters);
  expect(maximum).toBe(4);expect(first.progression.find(s=>s.key==='met')?.count).toBe(999);
  expect((await loadPipeline(env,client({leads}),filters)).snapshotId).toBe(first.snapshotId);
 });
 it('reads retained webhook progression after the current lead has moved to Nurture',async()=>{
  mocks.events.mockResolvedValue([{org_id:org,team_id:team,person_id:1,from_stage:null,to_stage:'Met with Customer',occurred_at:'2026-03-01T00:00:00Z',upstream_id:'met',upstream_kind:'peopleStageUpdated'},
   {org_id:org,team_id:team,person_id:1,from_stage:null,to_stage:'Nurture',occurred_at:'2026-04-01T00:00:00Z',upstream_id:'nurture',upstream_kind:'peopleStageUpdated'}]);
  const report=await loadPipeline(env,client(),filters);
  expect(report.progression.filter(s=>s.count).map(s=>s.key)).toEqual(['lead','attempted','spoke','appointment','met']);
  expect(report.totals.nurture).toBe(1);
  expect(mocks.events.mock.calls[0][1]).toContain('org_id=eq.'+org);
  expect(mocks.events.mock.calls[0][1]).toContain('team_id=eq.'+team);
  expect(mocks.events.mock.calls[0][1]).toContain('person_id=in.(1)');
 });
 it('rejects foreign or partially fetched canonical history',async()=>{
  mocks.events.mockResolvedValue([{org_id:'foreign',team_id:team}]);
  expect((await call(client())).status).toBe(502);
  mocks.events.mockImplementation(async(_table,query)=>{
   if(query.includes('offset=1000'))throw Error('incomplete');
   return Array.from({length:1000},()=>({org_id:org,team_id:team,person_id:1,from_stage:null,to_stage:'Lead'}));
  });
  expect((await call(client())).status).toBe(502);
 });
 it('returns an authenticated scoped report with a stable hash',async()=>{
  const db=client(),response=await call(db),r=await response.json() as any;
  expect(response.status).toBe(200);expect(r.totals.total).toBe(1);expect(r.snapshotId).toMatch(/^[a-f0-9]{64}$/);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect((db.select as any).mock.calls.find((c:any[])=>c[0]==='leads')[1]).toContain('team_id=in.('+team+')');
 });
 it('rejects ordinary agents and unaffiliated users before reading leads or history',async()=>{
  const db=client({memberships:[{role:'agent'}]});expect((await call(db)).status).toBe(403);
  expect((db.select as any).mock.calls.some((c:any[])=>c[0]==='leads')).toBe(false);expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.events).not.toHaveBeenCalled();
 });
 it('rejects a team that is not visible to the user',async()=>expect((await call(client({teams:[]}))).status).toBe(403));
 it('allows platform owners while still requiring visible team scope',async()=>{
  expect((await call(client({memberships:[],admins:[{id:'user'}]}))).status).toBe(200);
 });
 it('rejects malicious IDs and invalid ranges',()=>{
  expect(()=>parsePipelineFilters({...filters,teamId:team+'&or=(id.neq.x)'})).toThrow();
  expect(()=>parsePipelineFilters({...filters,from:filters.through,through:filters.from})).toThrow();
  expect(()=>parsePipelineFilters({...filters,through:'2026-02-01'})).toThrow();
  expect(()=>parsePipelineFilters({...filters,timezone:'not-a-zone'})).toThrow();
 });
 it('returns an error rather than a partial report after pagination failure',async()=>{
  const db=client(),original=db.select;
  db.select=vi.fn(async(t,q,o)=>{if(t==='leads'){if(q.includes('offset=1000'))throw Error('down');return Array.from({length:1000},(_,i)=>({...lead,fub_person_id:i+1})) as any;}return original(t,q,o);});
  expect((await call(db)).status).toBe(502);
 });
 it('never merges history from another team or organization',async()=>{
  mocks.history.mockResolvedValue({snapshot:{orgId:'other',teamId:team,leads:[lead],sourceStarts:{}},coverage:{}});
  expect((await call(client())).status).toBe(502);
  mocks.history.mockResolvedValue({snapshot:{orgId:org,teamId:'other',leads:[{...lead,stage:'Closed'}],sourceStarts:{}},coverage:{}});
  const r=await (await call(client())).json() as any;expect(r.totals.conversions).toBe(0);
 });
 it('rejects stale insights before calling the provider',async()=>{
  expect((await call(client(),'/data/pipeline/insights','POST',{snapshotId:'old',agentKey:team+':user:3'})).status).toBe(409);
  expect(mocks.insights).not.toHaveBeenCalled();
 });
 it('checks the snapshot again after generation',async()=>{
  const db=client(),r=await loadPipeline(env,db,filters),original=db.select;
  mocks.insights.mockImplementation(async()=>{db.select=vi.fn(async(t,q,o)=>t==='leads'?[{...lead,stage:'Closed'}] as any:original(t,q,o));return {};});
  expect((await call(db,'/data/pipeline/insights','POST',{snapshotId:r.snapshotId,agentKey:team+':user:3'})).status).toBe(409);
 });
 it('rejects untrusted write origins',async()=>expect((await call(client(),'/data/pipeline/insights','POST',{},false)).status).toBe(403));
 it('lets leaders map only their selected team and does not write to FUB',async()=>{
  const response=await call(client(),'/data/pipeline/mappings','PUT',{mappingVersion:await digest('{}'),mappings:{'name:long horizon':{category:'nurture',order:90}}});
  expect(response.status).toBe(200);expect(mocks.update).toHaveBeenCalledWith('teams','id=eq.'+team+'&org_id=eq.'+org,{pipeline_stage_mappings:{'name:long horizon':{category:'nurture',order:90}}});
 });
 it('rejects coach mapping writes, changed mappings and missing migration',async()=>{
  expect((await call(client({memberships:[{role:'coach'}]}),'/data/pipeline/mappings','PUT',{mappings:{}})).status).toBe(403);
  expect((await call(client(),'/data/pipeline/mappings','PUT',{mappings:{},mappingVersion:'old'})).status).toBe(409);
  const {pipeline_stage_mappings:_,...old}=teamRow;
  expect((await call(client({teams:[old]}),'/data/pipeline/mappings','PUT',{mappings:{}})).status).toBe(409);
  expect(mocks.update).not.toHaveBeenCalled();
 });
 it('excludes disabled sources without broadening the historical denominator',async()=>{
  expect((await loadPipeline(env,client({org_settings:[{sources:['Facebook']}]}),filters)).totals.total).toBe(0);
 });
 it('keeps historical-only tracked sources when settings use family names',async()=>{
  mocks.history.mockResolvedValue({snapshot:{orgId:org,teamId:team,leads:[{...lead,source_family:'Zillow Preferred',stage:'Trash'}],sourceStarts:{'Zillow Preferred':'2026-01-01'},through:'2026-09-05'},coverage:{state:'partial'}});
  const r=await loadPipeline(env,client({leads:[],org_settings:[{sources:['Zillow']}]}),filters);
  expect(r.totals.total).toBe(1);expect(r.totals.rejected).toBe(1);expect(r.coverage.historicalOnly).toBe(1);
  expect((await loadPipeline(env,client({leads:[],org_settings:[{sources:['Facebook']}]}),filters)).totals.total).toBe(0);
 });
 it('binds inquiry checks to authorized snapshots and rejects stale requests',async()=>{
  const db=client(),report=await loadPipeline(env,db,filters);
  expect((await call(db,'/data/pipeline/property-values','POST',{snapshotId:'old',leadKeys:[team+':1']})).status).toBe(409);
  expect(mocks.values).not.toHaveBeenCalled();
  mocks.values.mockResolvedValue({[team+':1']:{status:'included',amount:300000}});
  expect((await call(db,'/data/pipeline/property-values','POST',{snapshotId:report.snapshotId,leadKeys:[team+':1']})).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith('leads','team_id=eq.'+team+'&fub_person_id=eq.1',{pipeline_inquiry_value:{status:'included',amount:300000}});
 });
 it('loads only current policy values from visible leads without changing the metric snapshot',async()=>{
  const original=await loadPipeline(env,client(),filters);
  const saved={policy:'inquiry-v1',status:'included',amount:300000};
  const r=await loadPipeline(env,client({leads:[{...lead,pipeline_inquiry_value:saved}]}),filters);
  expect(r.propertyValues).toEqual({[team+':1']:saved});expect(r.snapshotId).toBe(original.snapshotId);
  expect((await loadPipeline(env,client({leads:[{...lead,pipeline_inquiry_value:{...saved,policy:'old'}}]}),filters)).propertyValues).toEqual({});
 });
 it('discards values when the pipeline changes during inquiry retrieval',async()=>{
  const db=client(),r=await loadPipeline(env,db,filters),original=db.select;
  mocks.values.mockImplementation(async()=>{db.select=vi.fn(async(t,q,o)=>t==='leads'?[{...lead,stage:'Closed'}] as any:original(t,q,o));return {};});
  expect((await call(db,'/data/pipeline/property-values','POST',{snapshotId:r.snapshotId,leadKeys:[team+':1']})).status).toBe(409);
 });
});
