import {describe,it,expect,vi} from 'vitest';
import {TimelineCollector,enqueueTimelines} from './timelineCollector.js';
function setup(){
 const evidence={lead:{agentId:'7',events:[]},checkedAt:'2026-09-09T00:00:00Z'};
 const m=new Map<string,any>([['evidence:123',evidence]]);
 const storage={get:vi.fn(async(k:string)=>m.get(k)),deleteAlarm:vi.fn(async()=>{}),setAlarm:vi.fn(),put:vi.fn(),delete:vi.fn(),list:vi.fn(async()=>new Map())};
 const env=new Proxy({}, {get(){throw Error('Disabled collector must not access network bindings or secrets');}});
 return {m,evidence,storage,env,c:new TimelineCollector({storage} as any,env as any)};
}
describe('retired cloud timeline collector',()=>{
 it('cancels surviving alarms without collection or evidence deletion',async()=>{
  const {c,storage,m,evidence}=setup();await c.alarm();await c.alarm();
  expect(storage.deleteAlarm).toHaveBeenCalledTimes(2);
  expect(storage.setAlarm).not.toHaveBeenCalled();expect(storage.put).not.toHaveBeenCalled();expect(storage.delete).not.toHaveBeenCalled();
  expect(m.get('evidence:123')).toEqual(evidence);
 });
 it('declines enqueue requests and cancels any prior alarm',async()=>{
  const {c,storage}=setup();
  const r=await c.fetch(new Request('https://collector/enqueue',{method:'POST',body:'{}'}));
  expect(await r.json()).toEqual({queued:false,disabled:true});
  expect(storage.deleteAlarm).toHaveBeenCalledOnce();expect(storage.setAlarm).not.toHaveBeenCalled();expect(storage.put).not.toHaveBeenCalled();
 });
 it('makes sync enqueue a no-op without accessing bindings',async()=>{
  const {env}=setup();await expect(enqueueTimelines(env as any,{} as any,[],true)).resolves.toBeUndefined();
 });
 it('reports collection as disabled, never current',async()=>{
  const {c}=setup();const r:any=await (await c.fetch(new Request('https://collector/report'))).json();
  expect(r.snapshot).toBeNull();expect(r.health.state).toBe('disabled');
 });
});
it('does not expose archived evidence as current counts',async()=>{
 const {c,m,evidence}=setup();m.set('team',{id:'team',org_id:'org'});
 const r=await c.fetch(new Request('https://collector/counts'));
 expect(await r.json()).toEqual({});expect(m.get('evidence:123')).toEqual(evidence);
});
it('retains nonempty historical evidence with its original capture time',async()=>{
 const {c,m,storage}=setup();const capturedAt=new Date(Date.now()-86400000).toISOString();
 m.set('team',{id:'team',org_id:'org',fub_subdomain:'example'});
 m.set('status',{lastSuccess:capturedAt});
 storage.list.mockResolvedValue(new Map([['person:123',{id:'123',created:capturedAt,assignedUserId:'7',due:0}]]));
 const r:any=await (await c.fetch(new Request('https://collector/report'))).json();
 expect(r.snapshot.leads).toHaveLength(1);expect(r.snapshot.capturedAt).toBe(capturedAt);
 expect(r.snapshot.through).toBe(capturedAt);expect(r.health.state).toBe('disabled');
 expect(storage.put).not.toHaveBeenCalled();expect(storage.delete).not.toHaveBeenCalled();
});
