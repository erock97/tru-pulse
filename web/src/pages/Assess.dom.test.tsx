// @vitest-environment jsdom
import {act,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import Assess from './Assess';
import {myAgent,submitOwnAssessment} from '../lib/api';
import {readAssessmentDraft,writeAssessmentDraft} from '../lib/assessmentDraft';
vi.mock('../lib/api',()=>({myAgent:vi.fn(),submitOwnAssessment:vi.fn(),resolveCohortRoster:vi.fn(),submitCohortAssessment:vi.fn(),claimAgent:vi.fn()}));
vi.mock('../lib/auth',()=>({signUp:vi.fn()}));
let root:Root,container:HTMLDivElement;
const agent='00000000-0000-4000-8000-000000000001';
const draft={submissionId:'00000000-0000-4000-8000-000000000004',pAns:Array(20).fill(0),bAns:Array(32).fill(2)};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();localStorage.clear();window.location.hash='/assess?self=1';vi.mocked(myAgent).mockResolvedValue({id:agent,name:'Test Agent'} as Awaited<ReturnType<typeof myAgent>>);vi.mocked(submitOwnAssessment).mockResolvedValue();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(<StrictMode><Assess token=""/></StrictMode>));}
async function click(text:string){await act(async()=>{[...container.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});}
it('automatically saves on the last answer and leaves the result visible without a save click',async()=>{
 await mount();await click('Start Part 1 →');
 for(let i=0;i<20;i++)await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="Neutral"]')!.click();});
 await click('Now, how you work →');
 for(let i=0;i<32;i++)await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="Left option, strength 1"]')!.click();});
 expect(submitOwnAssessment).toHaveBeenCalledTimes(1);expect(container.querySelector('h1')?.textContent).toBeTruthy();
 expect(container.textContent).toContain('Your results are saved.');expect(window.location.hash).toBe('#/assess?self=1');expect(readAssessmentDraft(agent)).toBeNull();
});
it('restores failed results after refresh and retries with the same ID',async()=>{
 writeAssessmentDraft(agent,draft);vi.mocked(submitOwnAssessment).mockRejectedValue(new Error('Offline'));await mount();
 expect(container.textContent).toContain('haven’t reached TRU HQ');expect(readAssessmentDraft(agent)).toEqual(draft);
 await act(async()=>root.unmount());root=createRoot(container);await mount();
 vi.mocked(submitOwnAssessment).mockResolvedValue();await click('Retry saving');
 expect(container.textContent).toContain('Your results are saved.');
 for(const [p] of vi.mocked(submitOwnAssessment).mock.calls)expect(p.submissionId).toBe(draft.submissionId);
});
it('resumes partial progress and keeps another account’s draft isolated',async()=>{
 writeAssessmentDraft('other',draft);await mount();expect(container.textContent).toContain('Start Part 1');expect(submitOwnAssessment).not.toHaveBeenCalled();
 await act(async()=>root.unmount());root=createRoot(container);writeAssessmentDraft(agent,{...draft,pAns:[0,-1,2],bAns:[]});await mount();expect(container.textContent).toContain('4 / 20');
});
it('handles unavailable browser storage without losing the visible result or blocking save',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});
 writeAssessmentDraft(agent,draft);await mount();await click('Start Part 1 →');
 await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Neutral"]')!.click());expect(container.textContent).toContain('couldn’t keep a backup');
});
it('retries automatically when the browser comes back online',async()=>{
 writeAssessmentDraft(agent,draft);vi.mocked(submitOwnAssessment).mockRejectedValueOnce(new Error('Offline'));await mount();
 expect(container.textContent).toContain('haven’t reached TRU HQ');
 await act(async()=>window.dispatchEvent(new Event('online')));
 expect(container.textContent).toContain('Your results are saved.');expect(submitOwnAssessment).toHaveBeenCalledTimes(2);
});
it('shows the result while the save is pending and retains a backup',async()=>{
 writeAssessmentDraft(agent,draft);vi.mocked(submitOwnAssessment).mockImplementation(()=>new Promise(()=>{}));await mount();
 expect(container.querySelector('h1')?.textContent).toBeTruthy();expect(container.textContent).toContain('Who you are:');
 expect(container.textContent).toContain('Saving your results');expect(container.textContent).not.toContain('Your results are saved.');
 expect(readAssessmentDraft(agent)).toEqual(draft);expect(container.textContent).toContain('Download results');
});
