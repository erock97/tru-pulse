import { useEffect, useRef, useState } from 'react';
import WorkshopLesson from '../pages/WorkshopLesson';
import { workshopMeta } from '../workshops/types';
import './repWorkshopLibrary.css';

type WorkshopEntry = { day: number; onOpen: () => void; disabled?: boolean; status: string };
export function RepWorkshopLibrary({ entries, presenter=false }: {entries: WorkshopEntry[]; presenter?: boolean}) {
  const [open,setOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();},[open]);
  const workshops = [...entries.filter(entry=>entry.day>=1&&entry.day<=3), {
    day: 4, onOpen: ()=>setOpen(true), disabled: false,
    status: 'Practice workshop · Does not count toward certification.',
  }].sort((a,b)=>a.day-b.day);
  return <>
    <section aria-label="Zillow Preferred training" className="rep-workshop-library">
      <h2>Zillow Preferred training</h2>
      <p><a href="#/rep/sessions">Join or run a live training session →</a></p>
      <img className="rep-workshop-cover" src="/workshops/house.jpg" alt="" loading="lazy"/>
      {workshops.map(entry=>{
        const meta=workshopMeta[entry.day];
        return <section key={entry.day} className="rep-workshop-card" aria-label={`Day ${entry.day} ${meta.title}`}>
          <div>
            <span className="rep-workshop-eyebrow">DAY {entry.day} · {meta.minutes} MINUTES · FACILITATED WORKSHOP</span>
            <h3>{meta.title}</h3><p>{meta.summary}</p>
            <div className="rep-workshop-actions">
              <button disabled={entry.disabled} onClick={entry.onOpen}>{presenter?'Present':'Open'} Day {entry.day}</button>
              <a href={`/workshops/day${entry.day}-guide.html`} target="_blank" rel="noreferrer">Facilitator guide ↗</a>
            </div><small>{entry.status}</small>
          </div>
        </section>;
      })}
    </section>
    {open&&<dialog ref={dialog} className="rep-workshop-overlay" aria-label="Zillow Home Loans workshop" onCancel={()=>setOpen(false)}><WorkshopLesson day={4} onBack={()=>setOpen(false)} onDone={()=>setOpen(false)} doneLabel="Return to training" preview={presenter}/></dialog>}
  </>;
}
