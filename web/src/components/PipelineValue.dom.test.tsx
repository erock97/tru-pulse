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
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.fetch.mockImplementation(async()=>Response.json({values:{},automatic:true}));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();});
const click=async(label:string)=>{await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(label))!.click();});};
it('does not show a team-wide property total or require manual five-lead collection',async()=>{
 await act(async()=>root.render(<PipelineValue report={pipelineFixture()} agentKey=""/>));
 expect(host.textContent).toBe('');expect(mocks.fetch).not.toHaveBeenCalled();
});
it('separates incomplete collection from missing prices and keeps partial money out of the headline',async()=>{
 const r={...pipelineFixture(),snapshotId:'v1'},own=r.leads.filter(l=>l.ownerKey==='demo-team:user:1');
 const values=demoValues(r),five=Object.fromEntries(own.slice(0,5).map(l=>[l.key,values[l.key]]));
 mocks.fetch.mockImplementation(async()=>Response.json({values:five,automatic:true}));
 await act(async()=>root.render(<PipelineValue report={r} agentKey="demo-team:user:1"/>));
 expect(host.textContent).toContain('5 of 165 leads checked');expect(host.textContent).toContain('160 awaiting lookup');
 expect(host.textContent).toContain('Database valuation is incomplete');expect(host.querySelector('.pipeline-value-amount')).toBeNull();
 expect(host.textContent).not.toContain('Check next');expect(host.textContent).toContain('continue when you leave');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="View property volume evidence"]')!.click());
 expect(host.querySelectorAll('li')).toHaveLength(valueSummary(own,five).included);
});
it('discards in-flight values after filters change and leaves refresh failures retryable',async()=>{
 const r={...pipelineFixture(),snapshotId:'v1'};let resolve!:(r:Response)=>void;
 mocks.fetch.mockReturnValueOnce(new Promise<Response>(r=>resolve=r));
 await act(async()=>root.render(<PipelineValue report={r} agentKey="demo-team:user:1"/>));
 await act(async()=>root.render(<PipelineValue report={{...r,snapshotId:'v2'}} agentKey="demo-team:user:1"/>));
 await act(async()=>resolve(Response.json({values:demoValues(r),automatic:true})));
 expect(host.textContent).toContain('0 of 165 leads checked');
 mocks.fetch.mockResolvedValueOnce(Response.json({error:'Values unavailable'},{status:502}));await click('Refresh values');
 expect(host.querySelector('[role=alert]')?.textContent).toContain('Values unavailable');
 expect([...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Refresh values'))?.disabled).toBe(false);
});
it('updates saved values automatically without rebuilding pipeline counts',async()=>{
 vi.useFakeTimers();const r=pipelineFixture(),values=demoValues(r);
 await act(async()=>root.render(<PipelineValue report={r} agentKey="demo-team:user:1"/>));
 mocks.fetch.mockImplementation(async()=>Response.json({values,automatic:true}));
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(host.textContent).toContain('165 of 165 leads checked');expect(host.querySelector('.pipeline-value-amount')).not.toBeNull();
 expect(mocks.fetch.mock.calls.every(c=>c[0].startsWith('/data/pipeline/property-values?'))).toBe(true);
});
