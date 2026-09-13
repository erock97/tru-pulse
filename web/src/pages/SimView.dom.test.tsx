// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SimView} from './AgentCourse';
const mocks=vi.hoisted(()=>({start:vi.fn(),finish:vi.fn(),connect:vi.fn(),clients:[] as any[]}));
vi.mock('../lib/api',async(importOriginal)=>({...await importOriginal<any>(),isDemo:false,simStart:mocks.start,simFinish:mocks.finish}));
vi.mock('retell-client-js-sdk',()=>({RetellWebClient:class {
 handlers:Record<string,()=>void>={};startCall=mocks.connect;stopCall=vi.fn();startAudioPlayback=vi.fn(async()=>{});
 constructor(){mocks.clients.push(this);}on(name:string,fn:()=>void){this.handlers[name]=fn;}
}}));
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
const scenario={key:'qa',name:'QA Buyer',label:'QA scenario',blurb:'Fictional buyer'};
describe('voice setup and teardown',()=>{
 let root:Root,container:HTMLDivElement;
 beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.clients.length=0;mocks.start.mockReset();mocks.finish.mockReset();mocks.connect.mockReset().mockResolvedValue(undefined);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
 afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.unstubAllGlobals();});
 async function start(){await act(async()=>root.render(<SimView scenarios={[scenario]} configured attempts={[]} onBack={()=>{}} onGraded={()=>{}}/>));await act(async()=>container.querySelector<HTMLDivElement>('.ac-simopt')!.click());await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('Call QA Buyer'))!.click());}
 it('does not open the microphone when call allocation finishes after leaving',async()=>{
  const pending=deferred<any>();mocks.start.mockReturnValue(pending.promise);await start();
  await act(async()=>root.render(null));
  await act(async()=>pending.resolve({practiceId:'qa',accessToken:'fixture-token'}));
  expect(mocks.clients).toHaveLength(0);
 });
 it('does not grade a dropped call when stopCall also emits call_ended',async()=>{
  mocks.start.mockResolvedValue({practiceId:'qa',accessToken:'fixture-token'});await start();
  const client=mocks.clients[0];client.stopCall.mockImplementation(()=>client.handlers.call_ended());
  await act(async()=>client.handlers.error());
  expect(mocks.finish).not.toHaveBeenCalled();expect(container.textContent).toContain('The call dropped');
 });
 it('grades an ended call only once even if the provider repeats the event',async()=>{
  mocks.start.mockResolvedValue({practiceId:'qa',accessToken:'fixture-token'});mocks.finish.mockReturnValue(new Promise(()=>{}));await start();
  const client=mocks.clients[0];await act(async()=>{client.handlers.call_ended();client.handlers.call_ended();});
  expect(mocks.finish).toHaveBeenCalledTimes(1);
 });
 it('does not restart audio when connection resolves after the call has already ended',async()=>{
  const pending=deferred<void>();mocks.connect.mockReturnValue(pending.promise);
  mocks.start.mockResolvedValue({practiceId:'qa',accessToken:'fixture-token'});mocks.finish.mockReturnValue(new Promise(()=>{}));await start();
  const client=mocks.clients[0];await act(async()=>client.handlers.call_ended());
  await act(async()=>pending.resolve());
  expect(client.startAudioPlayback).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledTimes(1);
 });
 it('stops a late connection after leaving without grading it',async()=>{
  const pending=deferred<void>();mocks.connect.mockReturnValue(pending.promise);
  mocks.start.mockResolvedValue({practiceId:'qa',accessToken:'fixture-token'});await start();
  const client=mocks.clients[0];client.stopCall.mockImplementation(()=>client.handlers.call_ended());
  await act(async()=>root.render(null));await act(async()=>pending.resolve());
  expect(client.stopCall).toHaveBeenCalled();expect(mocks.finish).not.toHaveBeenCalled();
  expect(client.startAudioPlayback).not.toHaveBeenCalled();
 });
});
