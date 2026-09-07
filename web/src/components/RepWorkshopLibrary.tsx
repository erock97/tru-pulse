import { useEffect, useRef, useState } from 'react';
import WorkshopLesson from '../pages/WorkshopLesson';
import './repWorkshopLibrary.css';

/** Supplemental workshop: existing certification requirements and records stay authoritative. */
export function RepWorkshopLibrary({ presenter=false }: {presenter?: boolean}) {
  const [open,setOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();},[open]);
  return <>
    <section className="rep-workshop-card" aria-label="Day 4 Zillow Home Loans workshop">
      <img src="/workshops/house.jpg" alt="Home exterior" loading="lazy"/>
      <div><span className="rep-workshop-eyebrow">DAY 4 · 58-MINUTE WORKSHOP</span><h3>Zillow Home Loans</h3><p>Practice introducing a loan officer, answering buyer concerns, and following up. Includes a facilitator guide and saved practice notes.</p><div className="rep-workshop-actions"><button onClick={()=>setOpen(true)}>{presenter?'Present Day 4':'Open Day 4'}</button><a href="/workshops/day4-guide.html" target="_blank" rel="noreferrer">Facilitator guide ↗</a></div><small>Practice workshop · Existing certification scores are separate.</small></div>
    </section>
    {open&&<dialog ref={dialog} className="rep-workshop-overlay" aria-label="Zillow Home Loans workshop" onCancel={()=>setOpen(false)}><WorkshopLesson day={4} onBack={()=>setOpen(false)} onDone={()=>setOpen(false)} doneLabel="Return to training" preview={presenter}/></dialog>}
  </>;
}
