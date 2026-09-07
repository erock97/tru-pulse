import {useEffect,useState} from 'react';
import {isDemo,loadCourse,type CourseModule} from '../lib/api';
import {canOpenModule} from '../lib/agentHq';
import {loadAssignments,saveAssignment,assignmentClosed,assignmentStatus,type CoachingAssignment} from '../lib/coachingAssignments';
import './coachingAssignments.css';
const dateLabel=(date:string)=>new Date(date.length===10?`${date}T12:00:00`:date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
export default function CoachingAssignments({agentId,leader=false,compact=false,onOpen}:{agentId:string;leader?:boolean;compact?:boolean;onOpen?:(id:string)=>void}){
 const [rows,setRows]=useState<CoachingAssignment[]|null>(null);
 const [modules,setModules]=useState<CourseModule[]>([]);
 const [error,setError]=useState('');const [courseError,setCourseError]=useState(false);
 const [allowed,setAllowed]=useState(false);const [creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false);const [saved,setSaved]=useState('');
 const [generation,setGeneration]=useState(0);
 useEffect(()=>{let live=true;setRows(null);setModules([]);setAllowed(false);setError('');setCourseError(false);
  void loadAssignments(agentId).then(r=>{if(live){setRows(r.assignments);setAllowed(r.canAssign);}}).catch(e=>{if(live)setError(e.message);});
  void loadCourse(agentId).then(m=>{if(live)setModules(m);}).catch(()=>{if(live)setCourseError(true);});
  return()=>{live=false;};
 },[agentId,generation]);
 const merged=rows?.map(a=>{const m=modules.find(m=>m.id===a.moduleId);return m?.status==='passed'?{...a,trainingPassed:true,passedAt:m.passed_at}:a;})??[];
 const open=merged.filter(a=>!assignmentClosed(a)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 const closed=merged.filter(assignmentClosed).sort((a,b)=>(b.reviewedAt??'').localeCompare(a.reviewedAt??''));
 async function save(input:Record<string,unknown>){
  setBusy(true);setError('');setSaved('');
  try{const result=await saveAssignment(agentId,input);setRows(old=>result.assignment?[...(old??[]).filter(a=>a.id!==result.assignment!.id),result.assignment]:(old??[]).map(a=>a.id===input.id?{...a,...result.patch}:a));setSaved(input.action==='create'?'Assignment saved.':input.action==='practice'?'Practice saved for your coach.':'Review saved.');return true;}
  catch(e){setError(e instanceof Error?e.message:'This could not be saved. Please retry.');return false;}finally{setBusy(false);}
 }
 return <section className={`cw-work ${compact?'cw-compact':''}`} aria-label={leader?'Assigned training and practice':'Your coaching work'}>
  <div className="cw-heading"><div><span className="cw-eyebrow">{leader?'Between meetings':'From your coach'}</span><h2>{leader?'Training & practice':'Your next step'}</h2></div>{leader&&allowed&&<button className="cw-button" onClick={()=>setCreating(!creating)}>{creating?'Close assignment form':'Assign work'}</button>}</div>
  {isDemo&&<p className="cw-muted cw-demo">Shared demo workspace · changes appear in the agent preview.</p>}
  {error&&<p role="alert" className="cw-error">{error} {rows===null&&<button onClick={()=>setGeneration(g=>g+1)}>Retry</button>}</p>}
  {saved&&<p role="status" className="cw-saved">{saved}</p>}
  {rows===null&&!error&&<p role="status">Loading coaching work…</p>}
  {creating&&leader&&allowed&&<AssignForm modules={modules.filter(canOpenModule)} courseError={courseError} busy={busy} onSave={async input=>{if(await save(input))setCreating(false);}}/>}
  {rows!==null&&open.length===0&&<p className="cw-muted">{leader?'No open assignments. Agree on one thing to practice before the next meeting.':'No new assignment from your coach. You can continue your training below.'}</p>}
  {(compact?open.slice(0,1):open).map(a=><WorkItem key={a.id} assignment={a} compact={compact} leader={leader&&allowed} busy={busy} moduleAvailable={modules.some(m=>m.id===a.moduleId&&canOpenModule(m))} onOpen={onOpen} onSave={save}/>)}
  {compact&&open.length>1&&<p className="cw-muted">{open.length-1} more {open.length===2?'assignment':'assignments'} in Coach.</p>}
  {!compact&&closed.length>0&&<details className="cw-history"><summary>Previous assignments ({closed.length})</summary>{closed.map(a=><WorkItem key={a.id} assignment={a} leader={false} busy={busy} moduleAvailable={false} onSave={save}/>)}</details>}
 </section>;
}
function AssignForm({modules,courseError,busy,onSave}:{modules:CourseModule[];courseError:boolean;busy:boolean;onSave:(input:Record<string,unknown>)=>Promise<void>}){
 const [id]=useState(()=>crypto.randomUUID());const [commitment,setCommitment]=useState('');const [moduleId,setModuleId]=useState('');const [dueDate,setDueDate]=useState('');
 return <form className="cw-form" onSubmit={e=>{e.preventDefault();void onSave({action:'create',id,commitment,moduleId:moduleId||null,moduleTitle:modules.find(m=>m.id===moduleId)?.title??null,dueDate:new FormData(e.currentTarget).get('dueDate')});}}>
  <p className="cw-muted">The agent can see this assignment and your review. Private 1:1 notes stay separate.</p>
  <label>What will they practice?<textarea required maxLength={1200} value={commitment} onChange={e=>setCommitment(e.target.value)} placeholder="Agree on a specific action and how you’ll review it."/></label>
  <div className="cw-fields"><label>Training<select value={moduleId} onChange={e=>setModuleId(e.target.value)}><option value="">Practice only</option>{modules.map(m=><option key={m.id} value={m.id}>{m.title}{m.status==='passed'?' (already passed)':''}</option>)}</select></label><label>Follow-up date<input name="dueDate" type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></div>
  {courseError&&<p role="alert">Training could not be loaded. You can still assign practice, or close and retry later.</p>}
  <button className="cw-button" disabled={busy}>{busy?'Saving…':'Save assignment'}</button>
 </form>;
}
function WorkItem({assignment:a,compact=false,leader,busy,moduleAvailable,onOpen,onSave}:{assignment:CoachingAssignment;compact?:boolean;leader:boolean;busy:boolean;moduleAvailable:boolean;onOpen?:(id:string)=>void;onSave:(input:Record<string,unknown>)=>Promise<boolean>}){
 const [reflection,setReflection]=useState(a.reflection);const [reviewNote,setReviewNote]=useState('');const [outcome,setOutcome]=useState('complete');const [followUp,setFollowUp]=useState('');const [editing,setEditing]=useState(false);
 const closed=assignmentClosed(a);const overdue=!closed&&a.dueDate<new Date().toLocaleDateString('en-CA');
 return <article className="cw-item">
  <div className="cw-meta"><strong className={closed?'cw-status closed':'cw-status'}>{assignmentStatus(a)}</strong><span>{overdue?'Follow-up overdue · ':'Follow-up · '}{dateLabel(a.dueDate)}</span></div>
  <h3>{a.commitment}</h3>
  {a.moduleId&&<div className="cw-training"><span>{a.trainingPassed?'✓ Training passed':'Training to complete'}{a.passedAt?` · ${dateLabel(a.passedAt)}`:''}</span><strong>{a.moduleTitle}</strong>{!leader&&!closed&&(moduleAvailable&&onOpen?<button className="cw-link" onClick={()=>onOpen(a.moduleId!)}>{a.trainingPassed?'Review training':'Open training'} →</button>:<span className="cw-muted">Open Training to check availability.</span>)}</div>}
  {a.practiceAt&&<div className="cw-note"><span className="cw-eyebrow">Agent practice · {dateLabel(a.practiceAt)}</span><p>{a.reflection}</p></div>}
  {a.reviewedAt&&<div className="cw-note"><span className="cw-eyebrow">Coach review · {dateLabel(a.reviewedAt)}</span><p>{a.reviewNote}</p></div>}
  {!leader&&!closed&&(editing||(!compact&&(!a.practiceAt||a.outcome==='continue')))&&<form className="cw-form" onSubmit={e=>{e.preventDefault();void onSave({action:'practice',id:a.id,reflection}).then(ok=>{if(ok)setEditing(false);});}}><label>What did you practice, and what happened?<textarea required maxLength={1200} value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="Share one example. Leave out client names and contact information."/></label><button className="cw-button" disabled={busy}>{busy?'Saving…':'Save practice for coach'}</button><span className="cw-muted">This records practice. Training passes are recorded by the quiz.</span></form>}
  {!leader&&!closed&&!editing&&(compact||!!a.practiceAt)&&<button className="cw-link" onClick={()=>setEditing(true)}>{a.practiceAt?'Update practice note':'Record your practice'}</button>}
  {leader&&!closed&&<details className="cw-review"><summary>Review at your meeting</summary><form className="cw-form" onSubmit={e=>{e.preventDefault();void onSave({action:'review',id:a.id,reviewNote,outcome,...(outcome==='continue'?{dueDate:new FormData(e.currentTarget).get('followUp')}:{})});}}><label>Outcome<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="complete">Reviewed — assignment finished</option><option value="continue">Keep practicing</option><option value="cancelled">No longer needed</option></select></label>{outcome==='continue'&&<label>Next follow-up date<input name="followUp" type="date" required value={followUp} onChange={e=>setFollowUp(e.target.value)}/></label>}<label>What did you agree on?<textarea required maxLength={1200} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="Visible to the agent."/></label><button className="cw-button" disabled={busy}>{busy?'Saving…':'Save review'}</button></form></details>}
 </article>;
}
