import { useEffect, useState } from 'react';
import { HqShell } from '../components/hqShell';
import { DeckFocusProvider } from '../components/deckFocus';
import { useSavedTarget } from '../components/TargetControl';
import { signOutClean } from '../lib/api';
import { loadRoster, loadOpenCommitments, type RosterAgent, type CheckinItem } from '../lib/coachData';
import { CADENCE_DAYS } from '../lib/deckMarks';
import { coachRoute } from '../lib/coachRoute';

export default function Today({org}:{org:{id:string;name:string}}) {
  return <DeckFocusProvider><div className="tru-dark"><TodayContent org={org}/></div></DeckFocusProvider>;
}
function TodayContent({org}:{org:{id:string;name:string}}) {
  const [roster,setRoster]=useState<RosterAgent[]|null>(null);
  const [items,setItems]=useState<CheckinItem[]>([]);
  const [error,setError]=useState('');
  const [loadingItems,setLoadingItems]=useState(true);
  const [failed,setFailed]=useState(0);
  const target=useSavedTarget(org.id,'coaching-cadence-days',CADENCE_DAYS);
  useEffect(()=>{
    let active=true;
    setRoster(null);setItems([]);setError('');setFailed(0);setLoadingItems(true);
    void loadRoster(90,{includeUnassessed:true}).then(async people=>{
      if(!active)return;
      setRoster(people);
      // Bound concurrency for large teams; never one simultaneous request per agent.
      const collected:CheckinItem[]=[];let failures=0;
      for(let i=0;i<people.length && active;i+=4){
        const batch=await Promise.allSettled(people.slice(i,i+4).map(p=>loadOpenCommitments(p.id)));
        for(const result of batch) if(result.status==='fulfilled') collected.push(...result.value);else failures++;
      }
      if(active){setItems(collected);setFailed(failures);setLoadingItems(false);}
    }).catch(()=>{if(active){setError('Your coaching activity could not be loaded. Try refreshing.');setLoadingItems(false);}});
    return ()=>{active=false;};
  },[org.id]);
  const go=(route:string)=>{window.location.hash=route;};
  const due=(roster??[]).filter(a=>a.lastDays<99 && a.lastDays>=target.saved).sort((a,b)=>b.lastDays-a.lastDays);
  const unrecorded=(roster??[]).filter(a=>a.lastDays>=99);
  return <HqShell orgName={org.name} eyebrow="Your working day" title="Today" onSignOut={signOutClean} nav={{onOpenPulse:()=>go('/pulse'),onOpenCoach:()=>go('/coach'),onOpenRep:()=>go('/rep'),onOpenTeam:()=>go('/team')}}>
    <main className="dk-main today-page"><header className="today-heading"><p>{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p><h1>Start with the next conversation.</h1><p>Follow through on the work already in motion.</p></header>
      {error && <p role="alert">{error}</p>}
      {!roster && !error && <p role="status">Loading your team's activity…</p>}
      {roster && <div className="today-layout"><section className="today-actions"><h2>Check-ins due <small>{due.length}</small></h2><p>Based on your saved {target.saved}-day coaching cadence. Longest gap first.</p>
        {due.map(a=><button className="today-action" key={a.id} onClick={()=>go(coachRoute(a.id))}><span><strong>{a.name}</strong><span>Last recorded 1:1 was {a.lastDays} days ago{a.lastFocus ? ' · '+a.lastFocus : ''}</span></span><b>Prepare 1:1 →</b></button>)}
        {!due.length && <p className="today-empty">No recorded check-ins are past your cadence.</p>}
        <h2>Commitments to revisit {loadingItems ? '' : <small>{items.length}</small>}</h2><p>Open commitments from recorded 1:1s. These have no recorded due date, so they are not labelled overdue.</p>
        {loadingItems && <p role="status">Checking open commitments…</p>}{failed>0 && <p role="status">Commitments unavailable for {failed} agents. This list is incomplete.</p>}
        {items.map(item=><button className="today-action" key={item.id} onClick={()=>go(coachRoute(item.agentId))}><span><strong>{roster.find(a=>a.id===item.agentId)?.name ?? 'Agent'}</strong><span>{item.body}</span></span><b>Review →</b></button>)}
        {!loadingItems && !items.length && !failed && <p className="today-empty">No open commitments recorded.</p>}
      </section><aside className="today-context"><h2>Before you assume</h2><p>{unrecorded.length} agents have no recorded 1:1. Missing history is not evidence that coaching never happened.</p><details><summary>See those agents</summary>{unrecorded.map(a=><button className="today-unrecorded" key={a.id} onClick={()=>go(coachRoute(a.id))}>{a.name} →</button>)}</details><hr/><h2>Your schedule</h2><p>Broker calendar events are not connected to this view yet. Meetings are not included in today's list.</p><hr/><h2>Review the evidence</h2><p>For the latest reported coaching observations and their sources, open Coach.</p><button className="brief-open" onClick={()=>go('/coach')}>Open coaching review →</button></aside></div>}
    </main>
  </HqShell>;
}
