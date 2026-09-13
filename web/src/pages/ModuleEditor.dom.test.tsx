// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ModuleEditor} from './Rep';
const mocks=vi.hoisted(()=>({module:vi.fn(),questions:vi.fn(),load:vi.fn(),upload:vi.fn(),media:vi.fn()}));
vi.mock('../lib/api',async(importOriginal)=>({...await importOriginal<any>(),isDemo:false,saveRepModule:mocks.module,saveRepQuestions:mocks.questions,loadRepQuestionsForEdit:mocks.load,uploadRepMedia:mocks.upload,signRepMediaDownload:mocks.media}));
const question={prompt:'Question',choices:['One','Two'],answer:0,explain:'Explanation'};
const existing={id:'qa-module',idx:1,title:'QA module',status:'draft',cards:[],pass_pct:80};
describe('module authoring recovery',()=>{
 let root:Root,container:HTMLDivElement;
 beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();mocks.load.mockResolvedValue([question]);mocks.module.mockImplementation(async(input)=>({...input,id:input.id||'created-id'}));mocks.questions.mockResolvedValue({count:1});mocks.media.mockResolvedValue('https://example.test/qa.mp4');container=document.createElement('div');document.body.append(container);root=createRoot(container);});
 afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.unstubAllGlobals();});
 async function render(module:any=existing){await act(async()=>root.render(<ModuleEditor orgId="qa-org" module={module} onClose={()=>{}} onSaved={()=>{}}/>));}
 function button(label:string){return [...container.querySelectorAll('button')].find(b=>b.textContent===label)!;}
 async function click(label:string){await act(async()=>button(label).click());}
 async function input(selector:string,value:string){await act(async()=>{const el=container.querySelector<HTMLInputElement>(selector)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
 it('does not publish a module before its quiz saves',async()=>{
  mocks.questions.mockRejectedValue(new Error('Quiz write unavailable'));await render();await click('Publish');
  expect(mocks.module.mock.calls.every(([input])=>input.status==='draft')).toBe(true);
  expect(container.textContent).toContain('Quiz write unavailable');
 });
 it('retains the new module id after partial save so retry does not create a duplicate',async()=>{
  await render(null);await input('[placeholder="e.g. Our objection playbook"]','New QA');await click('+ Question');
  await input('[placeholder="Question prompt"]','Question');await input('[placeholder="Choice 1"]','One');await input('[placeholder="Choice 2"]','Two');
  mocks.questions.mockRejectedValueOnce(new Error('Temporary quiz failure'));await click('Publish');await click('Publish');
  expect(mocks.module.mock.calls.slice(1).every(([input])=>input.id==='created-id')).toBe(true);
 });
 it('persists removal of the final quiz question when saving a draft',async()=>{
  await render();await click('Remove');await click('Save as draft');
  expect(mocks.questions).toHaveBeenCalledWith('qa-module',[]);
 });
 it('previews uploaded media with the existing learner player',async()=>{
  await render({...existing,cards:[{t:'media',kind:'video',path:'qa-org/qa.mp4',title:'QA clip'}]});await click('Preview');
  expect(mocks.media).toHaveBeenCalledWith('qa-org/qa.mp4');expect(container.querySelector('video')).not.toBeNull();
 });
 it('waits for an in-flight upload before allowing publication',async()=>{
  let finish!:(value:string)=>void;
  mocks.upload.mockReturnValue(new Promise<string>(resolve=>{finish=resolve;}));
  await render();
  const fileInput=container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput,'files',{value:[new File(['QA fixture'],'qa.pdf',{type:'application/pdf'})]});
  await act(async()=>fileInput.dispatchEvent(new Event('change',{bubbles:true})));
  expect(button('Publish').disabled).toBe(true);expect(button('Save as draft').disabled).toBe(true);
  await act(async()=>finish('qa-org/qa.pdf'));await click('Publish');
  expect(mocks.module.mock.calls.at(-1)![0].cards).toContainEqual({t:'media',kind:'pdf',path:'qa-org/qa.pdf',title:'qa.pdf'});
 });
});
