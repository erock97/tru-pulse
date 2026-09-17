import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({full:vi.fn(),target:vi.fn(),values:vi.fn()}));
vi.mock('./sync.js',()=>({syncTeam:mocks.full,syncPeopleByIds:mocks.target}));
vi.mock('./pipelineValueCollector.js',()=>({queuePipelineValues:mocks.values}));
vi.mock('./stageDrain.js',()=>({drainStageReceipts:async()=>{}}));
vi.mock('./db.js',()=>({db:()=>({select:async()=>[{id:'team'}]})}));
import {FubSyncQueue} from './syncQueue.js';
function make(env:any={}){const m=new Map<string,any>();let alarm:number|null=null;const storage={list:async({prefix,limit}:any)=>new Map([...m].filter(([k])=>k.startsWith(prefix)).slice(0,limit)),get:async(k:string)=>m.get(k),put:async(k:string,v:any)=>{m.set(k,v);},delete:async(k:string)=>m.delete(k),getAlarm:async()=>alarm,setAlarm:async(n:number)=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}};return {m,queue:new FubSyncQueue({storage} as any,env),alarm:()=>alarm};}
const req=(ids?:string[])=>new Request('https://sync',{method:'POST',body:JSON.stringify({team:{id:'team',org_id:'org'},ids})});
beforeEach(()=>{vi.clearAllMocks();mocks.full.mockResolvedValue({});});
it('durably records work before acknowledgement and retries failed sync',async()=>{const {queue,m,alarm}=make();await queue.fetch(req());expect(m.get('pending')).toBe('full');mocks.full.mockRejectedValueOnce(Error('network'));await queue.alarm();expect(m.get('pending')).toBe('full');expect(alarm()).toBeGreaterThan(Date.now());await queue.alarm();expect(m.get('status').lastSuccess).toBeDefined();});
it('does not let targeted events starve periodic full reconciliation',async()=>{const {queue,m}=make();await queue.fetch(req(['12']));m.set('fullDue',0);await queue.alarm();expect(mocks.full).toHaveBeenCalledTimes(1);expect(mocks.target).not.toHaveBeenCalled();});

it('wakes inquiry collection after persisted lead sync and isolates collection failures',async()=>{
 const env={PIPELINE_VALUES:{}};const {queue,m}=make(env);await queue.fetch(req(['12']));
 mocks.values.mockRejectedValueOnce(Error('collector unavailable'));await queue.alarm();
 expect(mocks.values).toHaveBeenCalledWith(env,['team'],true);expect(mocks.full.mock.invocationCallOrder[0]).toBeLessThan(mocks.values.mock.invocationCallOrder[0]);
 expect(m.get('status').lastSuccess).toBeDefined();expect(m.get('value-health').error).toContain('periodic retry');
});
