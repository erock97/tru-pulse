// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import {RecordMap, RECORD_TOOLS} from './RecordMap';

describe('contact record exploration',()=>{
 it('opens each tool explanation without changing the original product image or saving a record',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  HTMLElement.prototype.scrollTo=vi.fn();
  const container=document.createElement('div');document.body.append(container);
  const root=createRoot(container);
  try{
   await act(async()=>root.render(<RecordMap/>));
   for(const tool of RECORD_TOOLS){
    const button=container.querySelector<HTMLButtonElement>(`[aria-label="Explore ${tool.label}"]`)!;
    await act(async()=>button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-live]')!.textContent).toContain(tool.where);
    expect(container.querySelector('[aria-live]')!.textContent).toContain(tool.when);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/rep-lab/detail-full.png');
   }
   expect(container.querySelectorAll('textarea,input')).toHaveLength(0);
   expect(container.textContent).toContain('nothing here is graded');
  }finally{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();}
 });
});
