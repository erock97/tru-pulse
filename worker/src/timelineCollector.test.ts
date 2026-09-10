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
