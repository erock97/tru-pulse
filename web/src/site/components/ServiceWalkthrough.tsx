import {useState,useEffect,useRef} from 'react';
import {BUSINESS} from '../../config/business';
import './serviceWalkthrough.css';
const steps=[
 {title:'Check the record',body:'We start with the numbers and the calls behind them. A conversion rate tells us where to look; the conversation tells us what to coach.'},
 {title:'Coach the agent',body:'In the meeting, we review a specific moment with the agent and agree on what to try next.'},
 {title:'Assign practice',body:'The agent gets a relevant lesson, a clear practice assignment, and a follow-up date in their own HQ.'},
 {title:'Review together',body:'At the next meeting, we look at the practice and agree on whether to keep working on it or move on.'},
];
export default function ServiceWalkthrough(){
 const [step,setStep]=useState(0);const [assigned,setAssigned]=useState(false);
 useEffect(()=>{if(window.location.hash!=='#software')return;let active=true;let frame=0;void document.fonts.ready.then(()=>{if(active)frame=requestAnimationFrame(()=>{if(window.location.hash==='#software')document.getElementById('software')?.scrollIntoView({block:'start',behavior:'instant'});});});return()=>{active=false;cancelAnimationFrame(frame);};},[]);
 const workspace=useRef<HTMLDivElement>(null);const focusNext=useRef(false);
 useEffect(()=>{if(focusNext.current){workspace.current?.focus();focusNext.current=false;}},[step]);
 function choose(index:number,focus=false){focusNext.current=focus;setStep(index);}
 return <section className="panel band service-walkthrough" id="software" aria-labelledby="service-walkthrough-title"><div className="wrap">
  <div className="sw-intro"><h2 id="service-walkthrough-title" className="h2">See how we coach an agent.</h2><p>TRU HQ supports the work we do with your team. Follow one example from the first review to the next meeting.</p></div>
  <div className="sw-stage">
   <nav className="sw-steps" aria-label="Coaching walkthrough steps">{steps.map((item,index)=><button key={item.title} className={step===index?'active':''} aria-current={step===index?'step':undefined} aria-controls="sw-example" onClick={()=>choose(index)}><span className="sw-step-number">{index+1}</span><span><strong>{item.title}</strong>{step===index&&<span className="sw-step-description">{item.body}</span>}</span></button>)}</nav>
   <div ref={workspace} tabIndex={-1} role="region" className="sw-example" id="sw-example" aria-label={`${steps[step].title}: sample workspace`}>
    <header className="sw-window"><span className="sw-brand">TRU <span>HQ</span></span><span>{step===0?'Pulse':step===2?'Agent Home':'Coach'}</span></header>
    <div className="sw-workspace">
     <div className="sw-person"><span className="sw-avatar" aria-hidden>JR</span><div><strong>Jordan Rivera</strong><span>Sample agent</span></div><span className="sw-example-label">Illustrative example</span></div>
     {step===0&&<div className="sw-scene">
      <div className="sw-measure"><span>Leads per contract</span><strong>0 for 15</strong><p>15 leads received. No contract recorded yet.</p></div>
      <div className="sw-task"><h3>Start with a recent call.</h3><p>Before choosing a coaching focus, listen to how Jordan introduced the call, invited an appointment, and learned what the buyer needed.</p></div>
      <button className="sw-action" onClick={()=>choose(1,true)}>Review the call</button>
     </div>}
     {step===1&&<div className="sw-scene">
      <div className="sw-document"><span className="sw-document-label">Sample call review</span><h3>The appointment invitation came late.</h3><p>Jordan answered several questions before inviting the buyer to meet. Review that moment together and practice making the invitation earlier.</p></div>
      <div className="sw-agreement"><strong>Agreed for the next call</strong><p>Introduce yourself, invite the appointment, then ask permission to learn more about the buyer.</p></div>
      <button className="sw-action" onClick={()=>choose(2,true)}>Choose the practice</button>
     </div>}
     {step===2&&<div className="sw-scene">
      <div className="sw-assignment"><span className="sw-document-label">{assigned?'Sample assignment added':'Your next step'}</span><h3>Practice the opening of a first call.</h3><p>Rehearse the opening with your coach. Bring one example to your next meeting and describe what happened.</p><dl><div><dt>Training</dt><dd>Winning the First Conversation</dd></div><div><dt>Follow-up</dt><dd>Next coaching meeting</dd></div></dl></div>
      <button className="sw-action" onClick={()=>{if(assigned)choose(3,true);else setAssigned(true);}}>{assigned?'See the follow-up':'Try assigning this practice'}</button>
      <p className="sw-demo-feedback" role="status">{assigned?'This is how the assignment appears on the agent’s Home.':'This example does not send an assignment to anyone.'}</p>
     </div>}
     {step===3&&<div className="sw-scene">
      <div className="sw-review-heading"><span className="sw-check" aria-hidden>✓</span><div><h3>Review what the agent tried.</h3><p>Sample follow-up meeting</p></div></div>
      <dl className="sw-review"><div><dt>Training</dt><dd>Quiz passed. Practice is reviewed separately.</dd></div><div><dt>Practice example</dt><dd>Jordan rehearsed the opening and made the appointment invitation earlier.</dd></div><div><dt>Coach’s follow-up</dt><dd>Listen to a fresh call together. Decide whether the skill is ready or needs more practice.</dd></div></dl>
      <p className="sw-outcome">A completed lesson is a starting point. The next conversation shows how the agent is using it.</p>
     </div>}
    </div>
    <footer className="sw-controls"><button disabled={step===0} onClick={()=>choose(step-1)}>Previous</button><span aria-live="polite">{step+1} of {steps.length} · {steps[step].title}</span><button onClick={()=>{if(step===3){setAssigned(false);choose(0);}else choose(step+1);}}>{step===3?'Start again':'Next'}</button></footer>
   </div>
  </div>
  <div className="sw-close"><p>We bring the coaching, follow-up, and HQ to your team’s existing systems.</p><a className="cta" href={BUSINESS.bookingUrl} target="_blank" rel="noopener noreferrer">Book a call</a></div>
 </div></section>;
}
