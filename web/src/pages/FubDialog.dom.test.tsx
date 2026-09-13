// @vitest-environment jsdom
import {act, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PracticeRecord} from './PracticeRecord';
import {DealMock} from './DealSlide';
vi.mock('../lib/api',()=>({isDemo:false,gradeRecordPractice:vi.fn(async()=>({passed:false,checks:[]}))}));
vi.mock('../lib/liveSessions',()=>({readDraft:()=>null}));

describe('FUB task and deal dialog accessibility',()=>{
 let root:Root,container:HTMLDivElement;
 beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1400);
  // jsdom has no top layer. Browser QA verifies actual focus containment and bounds.
  HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.open=true;});
  HTMLDialogElement.prototype.close=vi.fn(function(this:HTMLDialogElement){this.open=false;});
  const host=document.createElement('div');document.body.append(host);
  container=document.createElement('div');host.attachShadow({mode:'open'}).append(container);root=createRoot(container);
 });
 afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
 it.each(['task','deal'] as const)('opens the record %s as a named modal and cancels without saving',async(kind)=>{
  await act(async()=>root.render(<PracticeRecord scenario="noanswer-task"/>));
  const trigger=container.querySelector<HTMLButtonElement>(`[title="Add a ${kind}"]`)!;
  trigger.focus();await act(async()=>trigger.click());
  const dialog=container.querySelector('dialog');
  expect(dialog).not.toBeNull();
  expect(dialog!.open).toBe(true);
  expect(dialog!.getAttribute('aria-label')).toBe(`Create ${kind}`);
  expect((container.getRootNode() as ShadowRoot).activeElement).toBe(dialog!.querySelector('input'));
  await act(async()=>dialog!.dispatchEvent(new Event('cancel',{cancelable:true})));
  expect(container.querySelector('dialog')).toBeNull();
  expect((container.getRootNode() as ShadowRoot).activeElement).toBe(trigger);
  expect(container.querySelectorAll(`.fub-${kind}item`)).toHaveLength(0);
 });
 it('uses the same native modal for the ungraded deal demonstration',async()=>{
  await act(async()=>root.render(<DealMock/>));
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Add a deal"]')!.click());
  const dialog=container.querySelector('dialog');expect(dialog).not.toBeNull();
  expect(dialog!.open).toBe(true);expect(dialog!.getAttribute('aria-label')).toBe('Create deal');
  await act(async()=>dialog!.dispatchEvent(new Event('cancel',{cancelable:true})));
  expect(container.querySelector('dialog')).toBeNull();expect(container.textContent).toContain('No deals yet');
 });
 it('ignores a queued close event after Strict Mode reopens the dialog',async()=>{
  await act(async()=>root.render(<StrictMode><DealMock/></StrictMode>));
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Add a deal"]')!.click());
  const dialog=container.querySelector('dialog')!;
  await act(async()=>dialog.dispatchEvent(new Event('close')));
  expect(container.querySelector('dialog')).toBe(dialog);
  expect(dialog.open).toBe(true);
 });
});
