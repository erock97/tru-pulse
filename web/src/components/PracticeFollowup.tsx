import { useOperations } from './OperationsContext';
import { coachRoute } from '../lib/coachRoute';
export function PracticeFollowup({edit=false}:{edit?:boolean}){
  const ops=useOperations(),p=ops?.practice;if(!ops||!p)return null;
  return <section className="practice-followup"><h2>Practice follow-up · {p.name}</h2><p>{p.focus}</p><p>This is a planning draft for this visit, not a training assignment sent to the agent. Save the agreed commitment in their 1:1.</p>
    {edit?<><label>Review date<input type="date" value={p.due} onChange={e=>ops.setPractice({...p,due:e.target.value})}/></label><label>Evidence of progress<textarea placeholder="What changed in the next conversation? Include the lead and source." value={p.outcome} onChange={e=>ops.setPractice({...p,outcome:e.target.value})}/></label></>:<p>Review date: {p.due||'Not set'} · {p.outcome?'Outcome note drafted':'Outcome not yet reviewed'}</p>}
    <button className="brief-open" onClick={()=>{window.location.hash=coachRoute(p.agentId);}}>Open 1:1 to record the commitment →</button>
    <button className="brief-open" onClick={()=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob([`${p.name}\nFocus: ${p.focus}\nReview: ${p.due||'Not set'}\nEvidence: ${p.outcome||'Not recorded'}\nDraft only; record the agreed commitment in Coach.`],{type:'text/plain'}));a.href=url;a.download='practice-follow-up.txt';a.click();URL.revokeObjectURL(url);}}>Export draft</button>
  </section>;
}
