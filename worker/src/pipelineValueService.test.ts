import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {checkPipelineValues} from './pipelineValue';
import {pipelineFixture} from '../../shared/pipelineFixture';
import type {Env} from './env';
const mocks=vi.hoisted(()=>({get:vi.fn(),key:vi.fn()}));
vi.mock('./fub',()=>({fubGet:mocks.get}));
vi.mock('./sync',()=>({decryptTeamKey:mocks.key}));
vi.mock('./db',()=>({db:()=>({})}));
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();mocks.key.mockResolvedValue('private-key');});
afterEach(()=>vi.useRealTimers());
const report=()=>{const r=pipelineFixture();r.teams[0].fub_subdomain='sample';return r;};
it('rejects out-of-scope leads and oversized batches before reading credentials',async()=>{
 await expect(checkPipelineValues({} as Env,report(),['another-team:1'])).rejects.toMatchObject({status:403});
 await expect(checkPipelineValues({} as Env,report(),Array.from({length:6},(_,i)=>String(i)))).rejects.toMatchObject({status:400});
 expect(mocks.key).not.toHaveBeenCalled();
});
it('verifies account identity before requesting events',async()=>{
 mocks.get.mockResolvedValue({status:200,body:{account:{domain:'wrong-team'}}});
 await expect(checkPipelineValues({} as Env,report(),['demo-team:1'])).rejects.toMatchObject({status:502});
 expect(mocks.get).toHaveBeenCalledTimes(1);
});
it('returns minimal evidence and follows safe cursor pagination to the original inquiry',async()=>{
 const r=report(),date=r.leads[0].fub_created;
 mocks.get.mockResolvedValueOnce({status:200,body:{account:{domain:'sample'}}})
 .mockResolvedValueOnce({status:200,body:{events:[],_metadata:{nextLink:'https://api.followupboss.com/v1/events?next=abc'}}})
 .mockResolvedValueOnce({status:200,body:{events:[{id:12,personId:1,type:'Property Inquiry',created:date,property:{price:'289900',forRent:0,street:'PRIVATE'},message:'PRIVATE'}]}});
 const pending=checkPipelineValues({} as Env,r,['demo-team:1']);await vi.runAllTimersAsync();const result=await pending;
 expect(result['demo-team:1']).toMatchObject({status:'included',amount:289900});
 expect(mocks.get.mock.calls[2][2]).toMatchObject({personId:1,next:'abc'});
 expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('never follows foreign pagination URLs or treats a truncated page as complete',async()=>{
 mocks.get.mockResolvedValueOnce({status:200,body:{account:{domain:'sample'}}}).mockResolvedValueOnce({status:200,body:{events:[],_metadata:{nextLink:'https://evil.test/?next=x'}}});
 const pending=checkPipelineValues({} as Env,report(),['demo-team:1']);await vi.runAllTimersAsync();
 expect((await pending)['demo-team:1'].status).toBe('incomplete');expect(mocks.get).toHaveBeenCalledTimes(2);
});
