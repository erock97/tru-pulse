import { PracticeFollowup } from '../components/PracticeFollowup';
import CoachingAssignments from '../components/CoachingAssignments';
import {loadAssignments, type CoachingAssignment} from '../lib/coachingAssignments';
import {practiceAgenda} from '../lib/practiceAgenda';
import { useEffect, useState } from 'react';
import { HqShell } from '../components/hqShell';
import { DeckFocusProvider } from '../components/deckFocus';
import { useSavedTarget } from '../components/TargetControl';
import { isDemo, signOutClean } from '../lib/api';
import { loadRoster, loadOpenCommitments, toggleCheckinCommitment, type RosterAgent, type CheckinItem } from '../lib/coachData';
import { CADENCE_DAYS } from '../lib/deckMarks';
import { coachRoute } from '../lib/coachRoute';
import { coachingDue } from '../lib/todayActions';

export default function Today({org}:{org:{id:string;name:string}}) {
  return <DeckFocusProvider><div className="tru-dark"><TodayContent org={org}/></div></DeckFocusProvider>;
}
function TodayContent({org}:{org:{id:string;name:string}}) {
  const [roster,setRoster]=useState<RosterAgent[]|null>(null);
  const [items,setItems]=useState<CheckinItem[]>([]);
  const [error,setError]=useState('');
  const [loadingItems,setLoadingItems]=useState(true);
  const [failed,setFailed]=useState(0);
  const [saving,setSaving]=useState<string|null>(null);
  const [completed,setCompleted]=useState<CheckinItem[]>([]);
  const [assignments,setAssignments]=useState<CoachingAssignment[]>([]);
  const [assignmentFailures,setAssignmentFailures]=useState(0);
  const [selected,setSelected]=useState<CoachingAssignment|null>(null);
  const [generation,setGeneration]=useState(0);
  const complete = async (item:CheckinItem,done:boolean) => {setSaving(item.id);setError('');try{await toggleCheckinCommitment(item.id,done);if(done){setItems(v=>v.filter(x=>x.id!==item.id));setCompleted(v=>[...v,item]);}else{setCompleted(v=>v.filter(x=>x.id!==item.id));setItems(v=>[...v,item]);}}catch{setError('The commitment could not be updated. Its status has not been changed here.');}finally{setSaving(null);}};
  const target=useSavedTarget(org.id,'coaching-cadence-days',CADENCE_DAYS);
  useEffect(()=>{
    let active=true;
    setRoster(null);setItems([]);setCompleted([]);setAssignments([]);setSelected(null);setAssignmentFailures(0);setError('');setFailed(0);setLoadingItems(true);
    void loadRoster(90,{includeUnassessed:true}).then(async people=>{
      if(!active)return;
      setRoster(people);
      // Bound concurrency for large teams; never one simultaneous request per agent.
      const collected:CheckinItem[]=[];const work:CoachingAssignment[]=[];let failures=0;let workFailures=0;
      for(let i=0;i<people.length && active;i+=4){
        const batch=await Promise.all(people.slice(i,i+4).map(async p=>Promise.allSettled([loadOpenCommitments(p.id),loadAssignments(p.id)])));
        for(const [commitmentResult,assignmentResult] of batch) {
          if(commitmentResult.status==='fulfilled') collected.push(...commitmentResult.value);else failures++;
          if(assignmentResult.status==='fulfilled') work.push(...assignmentResult.value.assignments);else workFailures++;
        }
      }
      if(active){setItems(collected);setAssignments([...new Map(work.map(a=>[a.id,a])).values()]);setAssignmentFailures(workFailures);setFailed(failures);setLoadingItems(false);}
    }).catch(()=>{if(active){setError('Your coaching activity could not be loaded. Try refreshing.');setLoadingItems(false);}});
    return ()=>{active=false;};
  },[org.id,generation]);
  const go=(route:string)=>{window.location.hash=route;};
  const due=coachingDue(roster??[],target.saved);
  const unrecorded=(roster??[]).filter(a=>a.hasRecordedCheckin === false);
  const agenda=practiceAgenda(assignments);
  const assignmentName=(a:CoachingAssignment)=>roster?.find(p=>p.id===a.agentId)?.name??(isDemo?'Jordan Rivera · demo':'Agent');
  const actionRows=(rows:CoachingAssignment[],label:string)=>rows.map(a=><button className="today-action" key={a.id} onClick={()=>setSelected(a)}><span><strong>{assignmentName(a)}</strong><span>{a.commitment}</span><span>{a.dueDate?`Follow-up ${new Date(a.dueDate+'T12:00:00').toLocaleDateString()}`:'No due date'}</span></span><b>{label} →</b></button>);
  return <HqShell orgName={org.name} eyebrow="Your working day" title="Today" hideTopbar onSignOut={signOutClean} nav={{onOpenPulse:()=>go('/pulse'),onOpenCoach:()=>go('/coach'),onOpenRep:()=>go('/rep'),onOpenTeam:()=>go('/team')}}>
    <main className="dk-main today-page"><header className="today-heading"><p>{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p><h1>Today’s follow-through.</h1><p>Follow through on the work already in motion.</p></header>
      {error && <p role="alert">{error}</p>}
      {!roster && !error && <p role="status">Loading your team's activity…</p>}
      {roster && <div className="today-layout"><section className="today-actions">
        {selected?<><button className="brief-open" onClick={()=>{setSelected(null);setGeneration(g=>g+1);}}>← Back to agenda and refresh</button><h2>{assignmentName(selected)} · Practice review</h2><CoachingAssignments key={selected.id} agentId={selected.agentId} leader focusAssignmentId={selected.id}/></>:<>
        <h2>Practice to review {loadingItems?'':<small>{agenda.toReview.length}</small>}</h2><p>Submitted work awaiting your response, oldest agreed follow-up first. Includes practice with unfinished training.</p>
        {loadingItems?<p role="status">Loading assigned work…</p>:actionRows(agenda.toReview,'Review practice')}
        {assignmentFailures>0&&<p role="status">Assigned work unavailable for {assignmentFailures} people. This agenda is incomplete. <button className="brief-open" onClick={()=>setGeneration(g=>g+1)}>Retry</button></p>}
        {!loadingItems&&!assignmentFailures&&!agenda.toReview.length&&<p>No submitted practice awaiting review.</p>}
        <h2>Agreed follow-ups past due {loadingItems?'':<small>{agenda.overdue.length}</small>}</h2>
        {!loadingItems&&actionRows(agenda.overdue,'Open follow-up')}
        {!loadingItems&&!assignmentFailures&&!agenda.overdue.length&&<p>No other open assignments past their recorded follow-up date.</p>}
        <h2>Check-ins due <small>{due.length}</small></h2><p>Based on your saved {target.saved}-day coaching cadence. Longest gap first.</p>
        {due.map(a=><button className="today-action" key={a.id} onClick={()=>go(coachRoute(a.id))}><span><strong>{a.name}</strong><span>Last recorded 1:1 was {a.lastDays} days ago{a.lastFocus ? ' · '+a.lastFocus : ''}</span></span><b>Prepare 1:1 →</b></button>)}
        {!due.length && <p className="today-empty">No recorded check-ins are past your cadence.</p>}
        <PracticeFollowup/><h2>Commitments to revisit {loadingItems ? '' : <small>{items.length}</small>}</h2><p>Open commitments from recorded 1:1s. These have no recorded due date, so they are not labelled overdue.</p>
        {loadingItems && <p role="status">Checking open commitments…</p>}{failed>0 && <p role="status">Commitments unavailable for {failed} agents. This list is incomplete.</p>}
        {[...new Set(items.map(item => item.agentId))].sort((a,b) => (roster.find(p=>p.id===a)?.name ?? a).localeCompare(roster.find(p=>p.id===b)?.name ?? b)).map(agentId => {
          const commitments = items.filter(item => item.agentId === agentId);
          const name = roster.find(a => a.id === agentId)?.name ?? 'Agent';
          return <details className="today-agent-commitments" key={agentId}>
            <summary><strong>{name}</strong><span>{commitments.length} {commitments.length === 1 ? 'commitment' : 'commitments'}</span></summary>
            <div className="today-commitment-list"><a className="today-commitment-profile" href={'#'+coachRoute(agentId)}>Open {name}’s coaching</a>
              {commitments.map(item => <div className="today-commitment-row" key={item.id}><p>{item.body}</p><button className="brief-open" disabled={saving !== null} onClick={() => void complete(item,true)}>{saving === item.id ? 'Saving…' : 'Mark done'}</button></div>)}
            </div>
          </details>;
        })}
        {!!completed.length && <details><summary>Completed this visit ({completed.length})</summary>{completed.map(item => <div className="today-commitment-row" key={item.id}><p><strong>{roster.find(a=>a.id===item.agentId)?.name ?? 'Agent'}</strong><br/>{item.body}</p><button disabled={saving!==null} onClick={()=>void complete(item,false)}>Undo</button></div>)}</details>}
        {!loadingItems && !items.length && !failed && <p className="today-empty">No open commitments recorded.</p>}
      </>}</section><aside className="today-context"><h2>{unrecorded.length===roster.length&&roster.length?'Start your team’s coaching history':'History to complete'}</h2><p>{unrecorded.length} {unrecorded.length === 1 ? "agent has" : "agents have"} no recorded 1:1. Confirm their history before deciding what is overdue.</p><details><summary>See those agents</summary>{unrecorded.map(a=><button className="today-unrecorded" key={a.id} onClick={()=>go(coachRoute(a.id))}>{a.name} · Record a check-in →</button>)}</details><hr/><h2>Data coverage</h2><p>This agenda covers {roster.length} people currently included in Coach. <a href="#/team">Review people and eligibility</a>.</p><p>Lead assignment counts and capacity reasons are available in <a href="#/pulse">Pulse</a>.</p><hr/><h2>Your schedule</h2><p>Broker calendar events are not connected to this view yet. Meetings are not included in today's list.</p><hr/><h2>Review the evidence</h2><p>For the latest reported coaching observations and their sources, open Coach.</p><button className="brief-open" onClick={()=>go('/coach')}>Open coaching review →</button></aside></div>}
    </main>
  </HqShell>;
}
