// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountWorkshop} from './runtime';
import shell from './shell.html?raw';
import day1 from '../../public/workshops/day1.json';
import day2 from '../../public/workshops/day2.json';
import day3 from '../../public/workshops/day3.json';
import day4 from '../../public/workshops/day4.json';
import type {WorkshopData} from './types';

describe('rendered workshop responses',()=>{
 let stop:()=>void;
 beforeEach(()=>{localStorage.clear();HTMLElement.prototype.scrollIntoView=vi.fn();});
 afterEach(()=>{stop?.();document.body.replaceChildren();vi.restoreAllMocks();});
 function open(data:WorkshopData){
  const host=document.createElement('div');document.body.append(host);
  const root=host.attachShadow({mode:'open'});root.innerHTML=shell;
  stop=mountWorkshop(root,host,data,{preview:true,draftOwner:'qa',back:vi.fn(),done:vi.fn(),native:vi.fn()}).destroy;
  const go=(index:number)=>(root.querySelectorAll('#agenda-list button')[index] as HTMLButtonElement).click();
  return {root,go};
 }
 it.each([day1,day2,day3,day4])('renders each Day $day question once, with unique draft keys', raw=>{
  const data=raw as WorkshopData,{root,go}=open(data),keys=new Set<string>();
  data.slides.forEach((slide,i)=>{
   go(i);if(slide.native)return;
   const fields=[...root.querySelectorAll<HTMLTextAreaElement>('#stage textarea[data-save]')];
   const labels=fields.map(el=>el.closest('label')?.textContent?.trim());
   expect(new Set(labels).size,slide.title).toBe(labels.length);
   for(const field of slide.activity?.fields||[])expect(fields.some(el=>el.dataset.fieldId===field.id),slide.title+' / '+field.id).toBe(true);
   for(const field of fields){expect(keys.has(field.dataset.save!),slide.title).toBe(false);keys.add(field.dataset.save!);}
  });
 });
 it('keeps corrections independent across rounds and restores a previous answer',()=>{
  const data=day2 as WorkshopData,{root,go}=open(data);
  const rounds=data.slides.flatMap((s,i)=>s.activity?.fields?.some(f=>f.id==='correction')?[i]:[]);
  go(rounds[0]);const first=root.querySelector<HTMLTextAreaElement>('textarea')!;
  first.value='First round correction';first.dispatchEvent(new Event('input',{bubbles:true}));
  go(rounds[1]);expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  go(rounds[0]);expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('First round correction');
 });
 it.each([day2,day3,day4])('runs all Day $day practice choices, case rotations, score resets, and draft fields',raw=>{
  const data=raw as WorkshopData,{root,go}=open(data);
  data.slides.forEach((slide,i)=>{
   go(i);
   for(const choice of root.querySelectorAll<HTMLButtonElement>('[data-quiz] button')){
    choice.click();expect(root.querySelector('.feedback')!.textContent).toMatch(/Good choice|Try another approach/);
    expect(choice.getAttribute('aria-pressed')).toBe('true');
   }
   const nextCase=root.querySelector<HTMLButtonElement>('[data-action="scenario"]');
   if(nextCase){const first=root.querySelector('#scenario')!.textContent;nextCase.click();expect(root.querySelector('#scenario')!.textContent).not.toBe(first);nextCase.click();nextCase.click();expect(root.querySelector('#scenario')!.textContent).toBe(first);}
   const rubric=[...root.querySelectorAll<HTMLInputElement>('.scorecard input')];
   if(rubric.length){for(const field of rubric){field.checked=true;field.dispatchEvent(new Event('input',{bubbles:true}));}expect(root.querySelector('#score')!.textContent).toContain(`${rubric.length} / ${rubric.length}`);root.querySelector<HTMLButtonElement>('[data-action="clear-score"]')!.click();expect(rubric.every(el=>!el.checked)).toBe(true);}
   for(const field of root.querySelectorAll<HTMLTextAreaElement>('textarea[data-save]')){field.value=`QA ${slide.id} ${field.dataset.save}`;field.dispatchEvent(new Event('input',{bubbles:true}));}
   const answers=[...root.querySelectorAll<HTMLTextAreaElement>('textarea[data-save]')].map(f=>f.value);go(Math.max(0,i-1));go(i);expect([...root.querySelectorAll<HTMLTextAreaElement>('textarea[data-save]')].map(f=>f.value)).toEqual(answers);
  });
 });
 it('downloads newly added activity fields as well as authored worksheet fields',()=>{
  const {root,go}=open(day1 as WorkshopData);go(2);
  const field=root.querySelector<HTMLTextAreaElement>('textarea')!;field.value='People, search, confirm source';field.dispatchEvent(new Event('input',{bubbles:true}));
  const blobs:Blob[]=[];
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:(blob:Blob)=>{blobs.push(blob);return 'blob:qa';},revokeObjectURL:vi.fn()}));
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  (root.querySelector('[data-action="download"]') as HTMLButtonElement).click();
  return new Promise<void>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{try{expect(String(reader.result)).toContain('People, search, confirm source');expect(String(reader.result)).toContain('What next action would remain');resolve();}catch(e){reject(e);}};reader.readAsText(blobs[0]);});
 });
});
