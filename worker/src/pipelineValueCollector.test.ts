import {it,expect,vi,beforeEach} from 'vitest';
import {PipelineValueCollector,queueActivePipelineValues} from './pipelineValueCollector';
import {inquiryValue} from '../../shared/pipelineValue';
const mocks=vi.hoisted(()=>({select:vi.fn(),update:vi.fn(),check:vi.fn()}));
vi.mock('./db',()=>({db:()=>({select:mocks.select,update:mocks.update})}));
vi.mock('./pipelineValue',()=>({checkPipelineValues:mocks.check}));
const teamId='00000000-0000-4000-8000-000000000001';
function make(){const data=new Map<string,unknown>();let alarm:number|null=null;const storage={get:async(k:string)=>data.get(k),put:async(k:string,v:unknown)=>{data.set(k,v);},delete:async(k:string)=>data.delete(k),getAlarm:async()=>alarm,setAlarm:async(n:number)=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}};return {data,alarm:()=>alarm,collector:new PipelineValueCollector({storage} as any,{} as any)};}
const queue=(c:PipelineValueCollector,id=teamId)=>c.fetch(new Request('https://values/queue',{method:'POST',body:JSON.stringify({teamId:id})}));
beforeEach(()=>{vi.clearAllMocks();mocks.select.mockImplementation(async(t:string)=>t==='teams'?[{id:teamId,fub_subdomain:'sample'}]:[{team_id:teamId,fub_person_id:1,fub_created:'2026-01-01T00:00:00Z'}]);mocks.update.mockResolvedValue(undefined);mocks.check.mockResolvedValue({[teamId+':1']:{...inquiryValue(),status:'missing'}});});
it('queues all active teams and resumes durably without a browser',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response('{}'));const env={PIPELINE_VALUES:{idFromName:vi.fn((id:string)=>id),get:()=>({fetch})}};
 await queueActivePipelineValues(env as any);expect(fetch).toHaveBeenCalledTimes(1);
 const x=make();await queue(x.collector);expect(x.alarm()).toBeGreaterThan(Date.now());await x.collector.alarm();
 expect(mocks.check).toHaveBeenCalledOnce();expect(mocks.update.mock.calls[0][1]).toContain('team_id=eq.'+teamId+'&fub_person_id=eq.1&or=');
 expect(x.data.get('status')).toMatchObject({state:'running'});expect(x.alarm()).toBeGreaterThan(Date.now());
});
it('does not swap team identities or read inactive teams',async()=>{
 const x=make();await queue(x.collector);expect((await queue(x.collector,'00000000-0000-4000-8000-000000000002')).status).toBe(400);
 mocks.select.mockResolvedValue([]);await x.collector.alarm();expect(mocks.check).not.toHaveBeenCalled();expect(x.alarm()).toBeNull();
});
it('records failures separately after bounded retries and moves on instead of blocking every lead',async()=>{
 const x=make();await queue(x.collector);mocks.check.mockRejectedValue(Error('private upstream details'));
 await x.collector.alarm();await x.collector.alarm();expect(mocks.update).not.toHaveBeenCalled();await x.collector.alarm();
 expect(mocks.update.mock.calls[0][2].pipeline_inquiry_value).toMatchObject({status:'failed',amount:null});
 expect(JSON.stringify([...x.data.values()])).not.toContain('private upstream');expect(x.alarm()).toBeGreaterThan(Date.now());
});
it('keeps checking for new leads after the current backlog is complete',async()=>{
 const x=make();await queue(x.collector);mocks.select.mockImplementation(async(t:string)=>t==='teams'?[{id:teamId}]:[]);
 await x.collector.alarm();expect(x.data.get('status')).toMatchObject({state:'up_to_date'});expect(x.alarm()).toBeGreaterThan(Date.now()+14*60000);
});
