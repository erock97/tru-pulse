// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PracticeRecord} from './PracticeRecord';
vi.mock('../lib/api',()=>({isDemo:false,gradeRecordPractice:vi.fn(async()=>({passed:false,checks:[]}))}));
vi.mock('../lib/liveSessions',()=>({readDraft:()=>null}));

describe('native record controls in the workshop shadow root',()=>{
 let root:Root,container:HTMLDivElement;
 beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1810);
  const host=document.createElement('div');document.body.append(host);
  container=document.createElement('div');host.attachShadow({mode:'open'}).append(container);root=createRoot(container);
 });
 afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
 async function click(selector:string){await act(async()=>{container.querySelector<HTMLButtonElement>(selector)!.click();});}
 async function input(selector:string,value:string){await act(async()=>{
  const field=container.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);
  field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
 });}
 it('retains date and time on save, and lets an incomplete task be corrected',async()=>{
  await act(async()=>root.render(<PracticeRecord scenario="noanswer-task"/>));
  await click('[title="Add a task"]');await input('[aria-label="Task name"]','Call Avery');
  await click('.fub-blue');expect(container.textContent).toContain('no date');
  await click('[aria-label="Edit task: Call Avery"]');
  await input('[type="date"]','2026-09-13');await input('[type="time"]','09:00');await click('.fub-blue');
  expect(container.textContent).toContain('Sep 13th 2026');expect(container.textContent).toContain('09:00');
  expect(container.querySelectorAll('.fub-taskitem')).toHaveLength(1);
 });
 it('saves and corrects a deal close date without creating a second deal',async()=>{
  await act(async()=>root.render(<PracticeRecord scenario="offer-accepted"/>));
  await click('[title="Add a deal"]');await input('[aria-label="Deal name or property address"]','Elena');
  await input('[placeholder="Add price"]','265000');await input('[type="date"]','2026-09-29');await click('.fub-blue');
  await click('[aria-label="Edit deal: Elena"]');await input('[type="date"]','2026-09-30');await click('.fub-blue');
  expect(container.querySelectorAll('.fub-dealitem')).toHaveLength(1);expect(container.querySelector('.fub-dealmeta')!.textContent).toContain('2026-09-30');
 });
 it('blocks keyboard and programmatic control activation before diagnosis',async()=>{
  await act(async()=>root.render(<PracticeRecord scenario="avery-repair"/>));
  for(const selector of ['.fub-stageread','[title="Add a task"]','[title="Add a deal"]']){
   expect(container.querySelector<HTMLButtonElement>(selector)!.disabled).toBe(true);await click(selector);
  }
  expect(container.querySelector('.fub-modal')).toBeNull();expect(container.querySelector('.fub-stageedit')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Contact note"]')!.readOnly).toBe(true);
 });
});
