// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {PipelinePanel,pipelineDateRange} from './PipelinePanel';
import {pipelineFixture} from '../../../shared/pipelineFixture';
const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('../lib/api',()=>({isDemo:false,workerFetch:mocks.fetch}));
vi.mock('../lib/rosterData',()=>({WINDOWS:[{key:'mtd',label:'Month to date',days:'mtd'},{key:'90',label:'90 days',days:90}]}));
let root:Root,host:HTMLDivElement;
const report=()=>({...pipelineFixture(),snapshotId:'snapshot-v1'});
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 mocks.fetch.mockImplementation(async()=>Response.json(report()));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=async()=>{await act(async()=>root.render(<PipelinePanel orgId="org" period="mtd"/>));};
const click=async(label:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(label));expect(b).toBeTruthy();await act(async()=>b!.click());};
it('selects an agent without shrinking team denominators and reveals exactly the nurture records',async()=>{
 await render();await click('Alex Morgan');
 const detail=host.querySelector('[aria-label="Stage breakdown"]')!;
 expect(detail.textContent).toContain('32.7% of team leads');expect(detail.textContent).toContain('38.7% of team current conversions');
 const nurture=detail.querySelector<HTMLButtonElement>('[aria-label="Nurture: 76 leads"]')!;
 await act(async()=>nurture.click());
 expect(host.querySelector('[aria-label="Matching leads"]')?.querySelectorAll('li')).toHaveLength(76);
 expect(host.querySelector('[aria-label="Team pipeline summary"]')?.textContent).toContain('504');
});
it('shows retained progression and opens the exact leads including the lead now in Nurture',async()=>{
 await render();await click('Alex Morgan');
 const detail=host.querySelector('[aria-label="Stage breakdown"]')!;
 const counts:Record<string,number>={'Lead received':165,'Attempted contact':56,'Spoke with customer':49,'Appointment set':34,'Met with customer':32,'Showing homes':18,'Submitting offers':12,'Under contract':12,'Closed':11};
 for(const [stage,count] of Object.entries(counts)){
  const button=detail.querySelector<HTMLButtonElement>('[aria-label="'+stage+': '+count+' leads"]');
  expect(button).not.toBeNull();await act(async()=>button!.click());
  const list=host.querySelector('[aria-label="Matching leads"]')!;
  expect(list.querySelectorAll('li')).toHaveLength(count);
  if(stage==='Met with customer'||stage==='Appointment set'){
   expect(list.textContent).toContain('Sample lead 64');expect(list.textContent).toContain('historical backfill');
  }
  if(stage==='Showing homes')expect([...list.querySelectorAll('li')].some(li=>li.textContent?.startsWith('Sample lead 64'))).toBe(false);
 }
});
it('sends the selected snapshot and owner to AI and leaves report usable on failure',async()=>{
 await render();await click('Alex Morgan');
 mocks.fetch.mockResolvedValueOnce(Response.json({error:'Provider unavailable'},{status:503}));
 await click('AI insights');
 const call=mocks.fetch.mock.calls.at(-1)!;
 expect(call[0]).toBe('/data/pipeline/insights');expect(JSON.parse(call[1].body)).toMatchObject({snapshotId:'snapshot-v1',agentKey:'demo-team:user:1'});
 expect(host.querySelector('[role=alert]')?.textContent).toContain('Provider unavailable');
 expect(host.querySelector('table')).not.toBeNull();expect(host.textContent).toContain('504');
});
it('does not show an in-flight insight after the selected agent changes',async()=>{
 await render();await click('Alex Morgan');
 let resolve!:(value:Response)=>void;
 mocks.fetch.mockReturnValueOnce(new Promise<Response>(r=>{resolve=r;}));
 await click('AI insights');await click('Taylor Reed');
 await act(async()=>resolve(Response.json({snapshotId:'snapshot-v1',generatedAt:new Date().toISOString(),coverage:'OLD INSIGHT',insights:[]})));
 expect(host.textContent).not.toContain('OLD INSIGHT');
});
it('changes the date filter without reusing old insights or records',async()=>{
 await render();
 const select=host.querySelector<HTMLSelectElement>('select')!;
 await act(async()=>{select.value='90';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(mocks.fetch.mock.calls.at(-1)?.[0]).toContain('from=');
 expect(host.textContent).not.toContain('Loading pipeline');
});
it('rejects invalid custom ranges and uses exclusive next-day boundaries',()=>{
 const now=new Date(2026,8,16,12),range=pipelineDateRange('mtd',true,'2026-09-01','2026-09-05',now);
 expect(new Date(range.from!).getDate()).toBe(1);expect(new Date(range.through).getDate()).toBe(6);
 expect(()=>pipelineDateRange('mtd',true,'2026-09-06','2026-09-05',now)).toThrow();
 expect(()=>pipelineDateRange('mtd',true,'2026-09-01','2026-09-20',now)).toThrow();
});
it('keeps custom midnight boundaries across daylight-saving transitions',()=>{
 for(const day of ['2026-03-08','2026-11-01']){
  const range=pipelineDateRange('mtd',true,day,day,new Date(2026,11,1));
  const first=new Date(range.from!),next=new Date(range.through);
  expect(first.getHours()).toBe(0);expect(next.getHours()).toBe(0);
  expect(next.getDate()).toBe(first.getDate()+1);
  expect(next.getTime()-first.getTime()).toBe(86400000+(next.getTimezoneOffset()-first.getTimezoneOffset())*60000);
 }
});
it('discloses historical-only and unresolved-owner coverage',async()=>{
 const r=report();r.coverage.historicalOnly=4;r.coverage.unresolvedOwners=7;
 mocks.fetch.mockResolvedValueOnce(Response.json(r));await render();
 expect(host.textContent).toContain('4 leads are available only from historical records');
 expect(host.textContent).toContain('7 lead owners need a refreshed FUB identity');
});
