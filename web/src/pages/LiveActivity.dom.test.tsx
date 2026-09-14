// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Activity} from './LiveSessions';
import {getWorkshopDefinition} from '../../../shared/workshopCatalog';
import {liveDraftKey, type LiveSessionState} from '../../../shared/liveWorkshops';
const mocks=vi.hoisted(()=>({request:vi.fn(async()=>({})),submit:vi.fn(async()=>({id:'saved',grade:null}))}));
vi.mock('../lib/liveSessions',async(original)=>({...await original<any>(),liveRequest:mocks.request,submitAttempt:mocks.submit}));
describe('live short-answer continuation',()=>{
 let root:Root,container:HTMLDivElement;
 const slide=getWorkshopDefinition(1)!.slides.find(s=>s.activity?.fields?.some(f=>f.id==='readiness'))!;
 const state={viewerId:'user',myAgentId:'learner',session:{id:'session',version:'test'},attempts:[],observations:[],revealedActivityIds:[]} as unknown as LiveSessionState;
 const key=liveDraftKey('user','session','test',slide.activity!.id);
 beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();mocks.submit.mockClear();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
 afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.unstubAllGlobals();});
 it.each(['','I do not know.','I would ignore the source.'])('can continue with any draft without submitting or losing it: %s',async answer=>{
  const draft={'readiness':answer};localStorage.setItem(key,JSON.stringify(draft));const onContinue=vi.fn();
  await act(async()=>root.render(<Activity state={state} slide={slide} activity={slide.activity!} refresh={()=>{}} onContinue={onContinue}/>));
  const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Continue with presenter')!;
  expect(button.disabled).toBe(false);
  await act(async()=>button.click());
  expect(onContinue).toHaveBeenCalledOnce();expect(mocks.submit).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(draft);
 });
 it('submits an opinion unchanged without requiring a correct answer',async()=>{
  const draft={'readiness':'I would ignore the source.'};localStorage.setItem(key,JSON.stringify(draft));
  await act(async()=>root.render(<Activity state={state} slide={slide} activity={slide.activity!} refresh={()=>{}} onContinue={()=>{}}/>));
  const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='Submit response')!;
  expect(button.disabled).toBe(false);await act(async()=>button.click());
  expect(mocks.submit).toHaveBeenCalledWith('session',key,slide.activity!.id,draft);
  expect(container.textContent).toContain('Submitted');
 });
 it('shows presenter feedback only for this learner and activity',async()=>{
  const observation={id:'feedback',agentId:'learner',activityId:slide.activity!.id,coachReviewed:true,round:1,correction:'Ask what more space would change.',retry:'Asked about garden plans.',retryObserved:true};
  const value={...state,observations:[observation,{...observation,id:'private',agentId:'someone-else',correction:'Private feedback'},{...observation,id:'other',activityId:'other-activity',correction:'Other activity feedback'}]} as LiveSessionState;
  await act(async()=>root.render(<Activity state={value} slide={slide} activity={slide.activity!} refresh={()=>{}} onContinue={()=>{}}/>));
  expect(container.textContent).toContain('Presenter feedback');
  expect(container.textContent).toContain('Ask what more space would change.');
  expect(container.textContent).toContain('Asked about garden plans.');
  expect(container.textContent).not.toContain('Private feedback');
  expect(container.textContent).not.toContain('Other activity feedback');
 });
});
