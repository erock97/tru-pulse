import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({people:vi.fn(),identity:vi.fn()}));
vi.mock('./sync.js',()=>({decryptTeamKey:async()=> 'key'}));
vi.mock('./fub.js',()=>({getPeopleByIds:mocks.people,fubGet:mocks.identity}));
import {drainStageReceipts} from './stageDrain.js';
const team={id:'team',org_id:'org',fub_subdomain:'domain'};
function setup(){
 const m=new Map<string,any>([['stage-pending:one:42',{teamId:'team',orgId:'org',personId:'42',eventId:'one',occurredAt:'2026-09-12T01:00:00Z',stage:'Nurture',capturedAt:'2026-09-12T02:00:00Z'}]]);
 const storage={list:async({prefix,limit}:any)=>new Map([...m].filter(([k])=>k.startsWith(prefix)).slice(0,limit)),get:async(k:string)=>m.get(k),put:async(k:string,v:any)=>{m.set(k,v);},delete:async(k:string)=>m.delete(k)} as any;
 const database={select:async()=>[{account_id:1,domain:'domain'}],rpc:vi.fn(async()=>1),upsert:vi.fn(async()=>{})} as any;
 return {m,storage,database};
}
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({status:200,body:{account:{id:1,domain:'domain'}}});mocks.people.mockResolvedValue([{id:42,source:'Zillow'}]);});
it('imports the supplied occurrence and stage and retains a provenance receipt',async()=>{
 const {m,storage,database}=setup();await drainStageReceipts(storage,{} as any,database,team);
 expect(database.rpc.mock.calls[0][1].p_events[0]).toMatchObject({to:'Nurture',occurredAt:'2026-09-12T01:00:00Z'});expect(database.upsert).toHaveBeenCalledTimes(1);expect(m.has('stage-pending:one:42')).toBe(false);
});
it('does not create canonical events for excluded sources',async()=>{
 const {storage,database}=setup();mocks.people.mockResolvedValue([{id:42,source:'Zillow Rentals'}]);await drainStageReceipts(storage,{} as any,database,team);expect(database.rpc).not.toHaveBeenCalled();expect(database.upsert).toHaveBeenCalledTimes(1);
});
it('keeps retry work when remote persistence fails',async()=>{
 const {m,storage,database}=setup();database.rpc.mockRejectedValueOnce(Error('offline'));await expect(drainStageReceipts(storage,{} as any,database,team)).rejects.toThrow();expect(m.has('stage-pending:one:42')).toBe(true);
 await drainStageReceipts(storage,{} as any,database,team);expect(m.has('stage-pending:one:42')).toBe(false);
});
it('records inaccessible people without blocking later receipts',async()=>{
 const {m,storage,database}=setup();mocks.people.mockResolvedValue([]);await drainStageReceipts(storage,{} as any,database,team);expect(database.rpc).not.toHaveBeenCalled();expect(m.has('stage-unresolved:one:42')).toBe(true);expect(m.has('stage-pending:one:42')).toBe(false);
});
it('fails closed on upstream account mismatch',async()=>{
 const {storage,database}=setup();mocks.identity.mockResolvedValue({status:200,body:{account:{id:2,domain:'domain'}}});await expect(drainStageReceipts(storage,{} as any,database,team)).rejects.toThrow('identity');expect(database.rpc).not.toHaveBeenCalled();
});
