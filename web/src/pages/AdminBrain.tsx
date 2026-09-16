import {useCallback,useEffect,useState} from 'react';
import {HqShell} from '../components/hqShell';
import {workerFetch,signOutClean} from '../lib/api';
import './adminBrain.css';

type Row=Record<string,any>;
type Snapshot={tasks:Row[];alerts:Row[];workers:Row[];memory:Row[];projects:Row[];mail:Row[];paused:boolean;intakeEnabled:boolean;activationReady:boolean;connections:Record<string,string>};
const label=(s:string)=>s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const when=(s:string)=>s?new Date(s).toLocaleString():'Never connected';
const parse=(s:string)=>{try{return JSON.parse(s);}catch{return null;}};
async function api(path='',body?:Row){
  const response=await workerFetch(`/admin/brain${path}`,body?{method:'POST',body:JSON.stringify(body)}:{});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error([401,403].includes(response.status)?'TrueBrain requires your owner session. It is unavailable while acting as a team.':value.error||'TrueBrain could not complete this request'),{status:response.status});
  return value;
}

export function AdminBrain({onOpenPulse,onOpenCoach,onOpenRep}:{onOpenPulse:()=>void;onOpenCoach:()=>void;onOpenRep:()=>void}){
  const [data,setData]=useState<Snapshot|null>(null),[tab,setTab]=useState('Overview');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[selectedId,setSelectedId]=useState('');
  const [events,setEvents]=useState<Row[]>([]),[reason,setReason]=useState('');
  const [memoryProject,setMemoryProject]=useState(''),[memoryKey,setMemoryKey]=useState(''),[memoryText,setMemoryText]=useState('');
  const [supersedes,setSupersedes]=useState<string|null>(null);
  const [deviceLabel,setDeviceLabel]=useState(''),[deviceProject,setDeviceProject]=useState('');
  const [credential,setCredential]=useState<Row|null>(null),[adapters,setAdapters]=useState<string[]>([]);
  const clearPrivateState=useCallback(()=>{setData(null);setSelectedId('');setEvents([]);setReason('');setMemoryText('');setMemoryKey('');setSupersedes(null);setCredential(null);},[]);
  const load=useCallback(async()=>{try{setData(await api());setError('');}catch(e){if([401,403].includes((e as Row).status))clearPrivateState();setError((e as Error).message);}},[clearPrivateState]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
  useEffect(()=>{if(!selectedId)return;let active=true;void api(`/events?taskId=${encodeURIComponent(selectedId)}`).then(value=>{if(active)setEvents(value);}).catch(e=>setError(e.message));return()=>{active=false;};},[selectedId,data]);
  const act=async(body:Row)=>{
    setBusy(true);setError('');
    try{const result=await api('/control',body);await load();return result;}
    catch(e){if([401,403].includes((e as Row).status))clearPrivateState();setError((e as Error).message);return null;}finally{setBusy(false);}
  };
  const open=(id:string)=>{setSelectedId(id);setEvents([]);setReason('');setTab('Work');};
  const selected=data?.tasks.find(t=>t.id===selectedId);
  const decide=async(decision:string)=>{if(await act({action:'task_decision',id:selectedId,decision,reason}))setReason('');};
  const alerts=data?.alerts.filter(a=>!a.read_at)??[];
  const running=data?.tasks.filter(t=>['queued','investigating','coding','reviewing','testing','releasing'].includes(t.status))??[];
  const go=(route:string)=>()=>{location.hash=route;};
  return <div className="tru-dark"><HqShell orgName="TRU HQ" role="Platform owner" nav={{onOpenPulse,onOpenCoach,onOpenRep}} isAdmin hideTopbar onSignOut={()=>signOutClean()} onOpenAdmin={go('/admin')} onOpenTeamData={go('/admin/targets')} onOpenRevenue={go('/admin/revenue')} onOpenContracts={go('/admin/contracts')} onOpenCalendar={go('/admin/calendar')} onOpenFailureLogs={go('/admin/failure-logs')}>
    <main className="dk-main brain-main">
      <header className="dk-mast"><div><span className="dk-eyebrow"><i/>Private workspace</span><h1>True<em>Brain</em>.</h1><p className="dk-sub">Your projects, agents, and the work moving between them.</p></div><div className="brain-status">{data?(data.paused?'Automation paused':'Automation active'):'Connecting…'}</div></header>
      {error&&<div role="alert" className="brain-error">{error}<button onClick={()=>{setError('');void load();}}>Try again</button></div>}
      <nav className="brain-tabs" aria-label="TrueBrain views">{['Overview','Work','Memory','Connections'].map(name=><button key={name} aria-current={tab===name?'page':undefined} aria-selected={tab===name} onClick={()=>setTab(name)}>{name}{name==='Overview'&&alerts.length>0?` · ${alerts.length}`:''}</button>)}</nav>
      {!data&&!error&&<p role="status">Loading your workspace…</p>}
      {data&&tab==='Overview'&&<>
        <section className="brain-metrics"><div><strong>{running.length}</strong><span>In progress</span></div><div><strong>{data.tasks.filter(t=>t.status==='completed').length}</strong><span>Verified repairs</span></div><div><strong>{alerts.length}</strong><span>Need your attention</span></div><div><strong>{data.workers.filter(w=>!w.revoked_at&&Date.now()-Date.parse(w.last_seen)<120000).length}</strong><span>Connected workers</span></div></section>
        <section className="brain-toolbar"><p>Confirmed repairs and small quality-of-life improvements follow your standing instructions. Uncertain scope comes to you. Email replies are always drafts.</p><button disabled={busy||(data.paused&&!data.activationReady)} onClick={()=>void act({action:data.paused?'resume':'pause'})}>{data.paused?(data.activationReady?'Resume automation':'Setup and verification pending'):'Pause automation'}</button></section>
        <h2>Needs your attention</h2>
        {!alerts.length&&<p className="brain-empty">Nothing needs your attention. New drafts and questions will appear here.</p>}
        {alerts.map(a=><article key={a.id} className="brain-card"><span className="brain-tag">{label(a.kind)}</span><h3>{a.title}</h3><p>{a.body}</p><small>{when(a.created_at)}</small><div className="brain-actions">{a.task_id&&<button onClick={()=>open(a.task_id)}>View work</button>}{a.draft_id&&<a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">Review Gmail drafts ↗</a>}<button disabled={busy} onClick={()=>void act({action:'read_alert',id:a.id})}>Mark reviewed</button></div></article>)}
      </>}
      {data&&tab==='Work'&&<section className="brain-work"><div>
        {!data.tasks.length&&<p className="brain-empty">No work yet. Confirmed TrueHQ reports and agent handoffs will appear here.</p>}
        {data.tasks.map(t=><button className={`brain-work-item ${selectedId===t.id?'selected':''}`} key={t.id} onClick={()=>open(t.id)}><span className="brain-tag">{label(t.status)}</span><strong>{t.title}</strong><small>{when(t.updated_at)}</small></button>)}
      </div>{selected&&<article className="brain-card">
        <span className="brain-tag">{label(selected.change_kind)}</span><h2>{selected.title}</h2><p className="brain-pre">{selected.objective}</p><p>Scope: {label(selected.scope_status)} · Attempt {selected.attempt} of 3</p>
        {selected.result_json&&<details><summary>Latest evidence</summary><pre>{JSON.stringify(parse(selected.result_json),null,2)}</pre></details>}
        {events.map(e=><div className="brain-event" key={e.id}><strong>{label(e.type)}</strong><small>{when(e.created_at)}</small><p>{parse(e.payload_json)?.summary}</p></div>)}
        {data.mail.filter(m=>m.task_id===selected.id).map(m=><section key={m.id}><h3>Email response · {label(m.draft_status)}</h3><p className="brain-pre">{m.draft_body}</p>{m.draft_id&&<a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">Review Gmail drafts ↗</a>}{m.draft_status==='update_review'&&<p>Additional wording is suggested here. Your existing Gmail draft was preserved for review.</p>}</section>)}
        <label>Clarification or additional evidence<textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain the connection to TrueHQ, or add the missing details."/></label>
        <div className="brain-actions">
          {selected.status==='needs_scope'&&<><button disabled={busy||!reason.trim()} onClick={()=>void decide('confirm_scope')}>Confirm TrueHQ scope</button><button disabled={busy} onClick={()=>void decide('unrelated')}>Not TrueHQ</button></>}
          {selected.status==='needs_information'&&<button disabled={busy||!reason.trim()} onClick={()=>void decide('information_added')}>Add information and resume</button>}
          {selected.status==='needs_decision'&&<button disabled={busy||!reason.trim()} onClick={()=>void decide('resolve_decision')}>Record business decision</button>}
          {selected.status==='blocked'&&<button disabled={busy} onClick={()=>void decide('retry')}>Retry</button>}
          {!['completed','cancelled','dismissed'].includes(selected.status)&&<button disabled={busy} onClick={()=>void decide('cancel')}>Cancel task</button>}
        </div>
      </article>}</section>}
      {data&&tab==='Memory'&&<>
        <h2>What your agents know</h2><p>Sources and verification stay with each entry. Your instructions take priority over agent observations.</p>
        <div className="brain-grid">{data.memory.map(m=><article className="brain-card" key={m.id}><span className="brain-tag">{label(m.level)} · {label(m.verification)}</span><h3>{m.entry_key}</h3><p className="brain-pre">{m.content}</p><small>{m.source} · {when(m.created_at)}</small><div className="brain-actions"><button onClick={()=>{setMemoryProject(m.project_id??'');setMemoryKey(m.entry_key);setMemoryText(m.content);setSupersedes(m.id);}}>Correct this entry</button></div></article>)}</div>
        <form className="brain-card" onSubmit={e=>{e.preventDefault();void act({action:'memory',level:memoryProject?'project':'operating',projectId:memoryProject||null,key:memoryKey,content:memoryText,supersedes}).then(result=>{if(result){setMemoryText('');setMemoryKey('');setSupersedes(null);}});}}>
          <h3>{supersedes?'Correct memory':'Add an instruction'}</h3><label>Project<select value={memoryProject} disabled={Boolean(supersedes)} onChange={e=>setMemoryProject(e.target.value)}><option value="">My operating preferences</option>{data.projects.map(p=><option key={p.project_id} value={p.project_id}>{p.display_name}</option>)}</select></label><label>Topic<input required value={memoryKey} onChange={e=>setMemoryKey(e.target.value)}/></label><label>Instruction<textarea required value={memoryText} onChange={e=>setMemoryText(e.target.value)}/></label><button disabled={busy}>Save instruction</button>
        </form>
      </>}
      {data&&tab==='Connections'&&<>
        <h2>Your connected devices</h2><div className="brain-grid">{data.workers.map(w=><article className="brain-card" key={w.id}><h3>{w.label}</h3><p>{w.revoked_at?'Revoked':Date.now()-Date.parse(w.last_seen)<120000?'Connected':'Offline'}</p><p>{(parse(w.adapters_json)??[]).join(' · ')}</p><small>Last contact: {when(w.last_seen)}</small>{!w.revoked_at&&<div className="brain-actions"><button disabled={busy} onClick={()=>void act({action:'revoke_worker',id:w.id})}>Revoke device</button></div>}</article>)}</div>
        <section className="brain-card"><h3>Email and notifications</h3><p>Intake: {data.intakeEnabled?'Enabled':'Not activated'} · Replies: draft only</p><p>Gmail: {label(data.connections.gmail)} · WhatsApp: {label(data.connections.whatsapp)}</p><p>WhatsApp needs a connected sender before it can alert your regular WhatsApp account.</p><p>Notion: {label(data.connections.notion)}. Mirror outages do not stop work.</p></section>
        <form className="brain-card" onSubmit={e=>{e.preventDefault();void act({action:'enroll',label:deviceLabel,projects:[deviceProject],adapters,primary:false,canRelease:false}).then(r=>r&&setCredential(r));}}>
          <h3>Enroll a companion</h3><label>Device name<input required value={deviceLabel} onChange={e=>setDeviceLabel(e.target.value)}/></label><label>Project<select required value={deviceProject} onChange={e=>setDeviceProject(e.target.value)}><option value="">Choose a project</option>{data.projects.map(p=><option key={p.project_id} value={p.project_id}>{p.display_name}</option>)}</select></label>
          <fieldset><legend>Agents installed on this device</legend>{['codex','claude','grok','hermes','qwen'].map(name=><label className="brain-checkbox" key={name}><input type="checkbox" checked={adapters.includes(name)} onChange={e=>setAdapters(current=>e.target.checked?[...current,name]:current.filter(a=>a!==name))}/>{label(name)}</label>)}</fieldset>
          <button disabled={busy||!adapters.length}>Create enrollment token</button>
          {credential&&<div role="status"><p>Shown once. Paste this into companion setup on your device.</p><code className="brain-token">{credential.token}</code><button type="button" onClick={()=>setCredential(null)}>Hide token</button></div>}
        </form>
      </>}
    </main>
  </HqShell></div>;
}
