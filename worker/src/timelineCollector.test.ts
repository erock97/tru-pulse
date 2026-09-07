vi.mock('./db.js',()=>({db:()=>({select:async()=>[{id:'team'}]})}));
import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({login:vi.fn(),json:vi.fn(),timeline:vi.fn()}));
vi.mock('./fubTimeline.js',()=>({FubTimelineSession:class{login=mocks.login;json=mocks.json;timeline=mocks.timeline;}}));
import {TimelineCollector,eligiblePerson,refreshDelay} from './timelineCollector.js';
function storage(){const m=new Map<string,any>();return {m,get:vi.fn(async(k:string)=>m.get(k)),put:vi.fn(async(k:string,v:any)=>m.set(k,structuredClone(v))),delete:vi.fn(async(k:string)=>m.delete(k)),getAlarm:vi.fn(async()=>null),setAlarm:vi.fn(async()=>{}),list:vi.fn(async({prefix}:any)=>new Map([...m].filter(([k])=>k.startsWith(prefix))))};}
const team={id:'team',org_id:'org',fub_subdomain:'compass627'};
const person={id:123,created:new Date(Date.now()-3600000).toISOString(),assignedUserId:7,assignedTo:'Agent',name:'Lead'};
describe('automatic timeline collector',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.login.mockResolvedValue(undefined);mocks.json.mockResolvedValue(person);mocks.timeline.mockResolvedValue([]);});
 it('does not count ponds, missing owners or invalid creation dates',()=>{expect(eligiblePerson(person)).toBe(true);expect(eligiblePerson({...person,assignedPondId:3})).toBe(false);expect(eligiblePerson({...person,created:'bad'})).toBe(false);expect(eligiblePerson({...person,assignedUserId:null})).toBe(false);expect(refreshDelay(person.created)).toBe(300000);});
 it('runs from a durable alarm and preserves last evidence after an upstream failure',async()=>{
  const store=storage();const c=new TimelineCollector({storage:store} as any,{} as any);
  await c.fetch(new Request('https://collector/enqueue',{method:'POST',body:JSON.stringify({team,people:[person]})}));
  await c.alarm();expect(store.setAlarm).toHaveBeenCalled();expect(store.m.get('evidence:123')).toBeDefined();
  const previous=structuredClone(store.m.get('evidence:123'));store.m.get('person:123').due=0;mocks.timeline.mockRejectedValueOnce(Error('FUB unavailable'));
  await c.alarm();expect(store.m.get('evidence:123')).toEqual(previous);
  const report:any=await (await c.fetch(new Request('https://collector/report'))).json();expect(report.health.state).toBe('attention');expect(report.snapshot.leads).toHaveLength(1);
 });
 it('rejects a different tenant and never reattributes old evidence after reassignment',async()=>{
  const store=storage();const c=new TimelineCollector({storage:store} as any,{} as any);
  const post=(t:any,p:any)=>c.fetch(new Request('https://collector/enqueue',{method:'POST',body:JSON.stringify({team:t,people:[p]})}));
  await post(team,person);await c.alarm();expect((await post({...team,org_id:'foreign'},person)).status).toBe(409);
  await post(team,{...person,assignedUserId:8});const r:any=await (await c.fetch(new Request('https://collector/report'))).json();expect(r.snapshot.leads[0].events).toEqual([]);expect(r.health.collected).toBe(0);
 });
});
