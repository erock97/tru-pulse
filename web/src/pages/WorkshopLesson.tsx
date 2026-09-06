import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isDemo } from '../lib/api';
import { PracticeRecord, PACKS, type PracticeScenario } from './PracticeRecord';
import { DealMock } from './DealSlide';
import { mountWorkshop } from '../workshops/runtime';
import type { WorkshopData, WorkshopSlide } from '../workshops/types';
import shell from '../workshops/shell.html?raw';
import css from '../workshops/workshop.css?inline';
import fonts from '../workshops/fonts.css?inline';
import '../workshops/fonts.css';
import baseCss from '../workshops/practiceRecord.css?inline';

const reference: Record<number, string> = {
  1: '<h3>Before leaving a contact</h3><p>Check the true stage and saved change, a factual note, and a dated next task. Another agent should understand what happened and what to do next.</p><p>After the first appointment: Met with customer. After the second appointment: Showing homes. Record an accepted offer under Under contract and add the deal.</p>',
  2: '<h3>LEAD on the first call</h3><p>Lead with your name, brokerage, Zillow connection, and reason for calling. Extend the showing invitation early. Ask permission and listen. Deliver a summary and confirm the plan.</p><p>Make at least five unique personal attempts in the first seven days from arrival. Calls, including voicemail, and personal texts count. Automation and email do not. Day seven is not a stop rule.</p>',
  3: '<h3>After the showing</h3><p>Ask whether any home is worth pursuing. Learn what explains the rating and what is missing. Discuss financing preparation and the reason for timing. Agree on a useful next action, date, and owner.</p><p>Confirm current brokerage agreement requirements before touring. Save the true stage, specific preferences, timing, and a dated task.</p>',
  4: '<h3>Introducing a loan officer</h3><p>Reflect the buyer’s concern. Explain a relevant benefit. Ask permission. Confirm the introduction and agreed next step. Identify Zillow Home Loans and preserve the buyer’s lender choice.</p><p>Ask the loan officer to confirm eligibility, pricing, credit inquiries, conditions, and timing.</p><p><a href="https://www.zillow.com/homeloans/zillow-home-loans-faqs/" target="_blank" rel="noopener">ZHL FAQ ↗</a> · <a href="https://www.zillow.com/preferred/zillow-home-loans/" target="_blank" rel="noopener">ZHL agent tools ↗</a> · <a href="https://www.consumerfinance.gov/owning-a-home/compare/" target="_blank" rel="noopener">Comparing loan offers ↗</a></p>',
};

export default function WorkshopLesson({ day, onBack, onDone, doneLabel, preview = false }: {
  day: number; onBack: () => void; onDone: () => void; doneLabel?: string; preview?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({onBack,onDone,doneLabel});
  callbacks.current={onBack,onDone,doneLabel};
  const runtime = useRef<ReturnType<typeof mountWorkshop> | null>(null);
  const [natives, setNatives] = useState<{slide: WorkshopSlide; root: ShadowRoot}[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const el=host.current!;
    const root=el.shadowRoot ?? el.attachShadow({mode:'open'});
    const mounted = new Map<WorkshopSlide, HTMLElement>();
    setNatives([]);
    setLoading(true);setError('');
    fetch(`/workshops/day${day}.json`,{signal:controller.signal})
      .then(async r=>{if(!r.ok)throw new Error('Training could not be loaded.');return await r.json() as WorkshopData;})
      .then(data=>{
        if(controller.signal.aborted)return;
        // All markup comes from reviewed, versioned training assets in this repository.
        root.innerHTML=`<style>${fonts}\n${css}</style><div class="workshop">${shell}</div>`;
        root.querySelector('#course-label')!.textContent=`Zillow Preferred / Day ${day}`;
        root.querySelector('#duration')!.textContent=String(data.slides.reduce((a,s)=>a+s.time,0));
        root.querySelector('#resource-body')!.innerHTML=reference[day]+`<p><a href="/workshops/day${day}-resources.html" target="_blank" rel="noopener">Open printable agent worksheet ↗</a></p>`;
        runtime.current=mountWorkshop(root,el,data,{
          preview:preview||isDemo,
          doneLabel:callbacks.current.doneLabel,
          back:()=>callbacks.current.onBack(),done:()=>callbacks.current.onDone(),
          native:(slide,target)=>{
            if(!slide?.native||!target)return;
            target.closest('.slide')?.classList.add('native-slide');
            const existing=mounted.get(slide);
            if(existing){target.append(existing);return;}
            const holder=document.createElement('div');target.append(holder);
            const nested=holder.attachShadow({mode:'open'});
            mounted.set(slide,holder);
            setNatives(all=>[...all,{slide,root:nested}]);
          },
        });
        // Real screenshots open at full size without cropping away the surrounding UI.
        const enlarge=(e:Event)=>{
          const target=e.target as HTMLElement;
          if(!target.matches('.screen-figure img'))return;
          if(e instanceof KeyboardEvent&&e.key!=='Enter'&&e.key!==' ')return;
          e.preventDefault();
          const dialog=document.createElement('dialog');dialog.className='image-dialog';
          const close=document.createElement('button');close.textContent='Close image';close.onclick=()=>dialog.close();
          const img=document.createElement('img');img.src=(target as HTMLImageElement).src;img.alt=(target as HTMLImageElement).alt;
          dialog.append(close,img);root.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
        };
        root.addEventListener('click',enlarge,{signal:controller.signal});
        root.addEventListener('keydown',enlarge,{signal:controller.signal});
        setLoading(false);
        el.scrollIntoView({block:'start',behavior:'instant'});
      }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Training could not be loaded.');setLoading(false);}});
    return ()=>{controller.abort();runtime.current?.destroy();runtime.current=null;root.replaceChildren();};
  },[day,preview,retry]);
  return <>
    {loading&&<p role="status" style={{padding:24}}>Loading training…</p>}
    {error&&<div role="alert" style={{padding:24}}><p>{error}</p><button onClick={()=>setRetry(r=>r+1)}>Try again</button><button onClick={onBack}>All training</button></div>}
    <div ref={host} />
    {natives.map(native=>{const scenario=native.slide.scenario as PracticeScenario;return createPortal(<>
      <style>{baseCss}{`:host{display:block;color:#171d22;font-family:'DM Sans',sans-serif}*{box-sizing:border-box}button,input,textarea,select{font:inherit}button{border-radius:6px}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #487bac;outline-offset:2px}.btn{min-height:40px;padding:11px 18px;border:1px solid #899a91;background:#e5e7df;color:#171d22;font-weight:600}.err{color:#963e31}.native-lab{--gold:#bdd1ed;--ac:#bdd1ed;--ink:#171d22;--ac-text:#171d22;--ac-text-60:#51635c;background:#f2f0e9;padding:12px}.native-lab .pr{max-width:none}.native-lab .pr-after{color:#171d22}.native-lab button{cursor:pointer}.native-lab .pr-brieftitle{font-family:Manrope,sans-serif;font-weight:600}.native-lab .pr-jobs{--ac-text:#f2f0e9;--ac-text-60:#d4ded8;background:#20292c;position:relative;top:0}.native-lab .pr-checks li.ok{color:#23543b}.native-lab .pr-checks li.no{color:#963e31}.native-lab .lab-ok{color:#23543b}.native-lab .pr-scenario,.native-lab .pr-head{color:#171d22}.native-lab .ac-btn{background:#bdd1ed;color:#171d22}.native-lab h3{font-family:Manrope,sans-serif}`}</style>
      <div className="native-lab">{native.slide.native==='deal'?<div style={{maxWidth:720,margin:'30px auto',position:'relative',minHeight:340}}><p style={{marginBottom:24,fontSize:20,lineHeight:1.5}}>After an offer is accepted, record the property address, agreed price, and expected close date. Open the deal form and try it with fictional details.</p><DealMock/></div>:PACKS[scenario]?<PracticeRecord key={scenario} scenario={scenario} record={!preview} onPassed={()=>runtime.current?.pass(native.slide)}/>:<p>This exercise could not be loaded. Return to the training list and try again.</p>}</div>
    </>,native.root,native.slide.title);})}
  </>;
}
