// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {PipelineValue,demoValues} from './PipelineValue';
import {pipelineFixture} from '../../../shared/pipelineFixture';
import {valueSummary} from '../../../shared/pipelineValue';
const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('../lib/api',()=>({isDemo:false,workerFetch:mocks.fetch}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const click=async(label:string)=>{await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(label))!.click();});};
it('checks exactly five selected-agent leads and opens exact included evidence',async()=>{
 const r={...pipelineFixture(),snapshotId:'v1'},own=r.leads.filter(l=>l.ownerKey==='demo-team:user:1');
 const values=demoValues(r),five=Object.fromEntries(own.slice(0,5).map(l=>[l.key,values[l.key]]));
 mocks.fetch.mockResolvedValue(Response.json({snapshotId:'v1',values:five}));
 await act(async()=>root.render(<PipelineValue report={r} agentKey="demo-team:user:1"/>));await click('Check next');
 expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({snapshotId:'v1',leadKeys:own.slice(0,5).map(l=>l.key)});
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="View property volume evidence"]')!.click());
 expect(host.querySelectorAll('li')).toHaveLength(valueSummary(own,five).included);
 expect(host.textContent).toContain('of 165 leads included');
});
it('discards in-flight values after filters change and leaves failures retryable',async()=>{
 const r={...pipelineFixture(),snapshotId:'v1'};let resolve!:(r:Response)=>void;
 mocks.fetch.mockReturnValue(new Promise<Response>(r=>resolve=r));
 await act(async()=>root.render(<PipelineValue report={r} agentKey=""/>));await click('Check next');
 await act(async()=>root.render(<PipelineValue report={{...r,snapshotId:'v2'}} agentKey=""/>));
 await act(async()=>resolve(Response.json({snapshotId:'v1',values:demoValues(r)})));
 expect(host.textContent).toContain('0 of 504 leads included');
 mocks.fetch.mockResolvedValue(Response.json({error:'FUB unavailable'},{status:502}));await click('Check next');
 expect(host.querySelector('[role=alert]')?.textContent).toContain('FUB unavailable');
 expect([...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Check next'))?.disabled).toBe(false);
});
