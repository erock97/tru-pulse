import { useEffect, useMemo, useRef, useState } from 'react';
import { isDemo, workerFetch } from '../lib/api';
import { WINDOWS } from '../lib/rosterData';
import { pulseCutoff, type PulsePeriod } from '../lib/pulsePeriod';
import { pipelineCounts, stageKey, PIPELINE_CATEGORIES, type PipelineReport, type PipelineFilters, type StageMapping, type PipelineTeam } from '../../../shared/pipeline';
import { pipelineFixture } from '../../../shared/pipelineFixture';
import { metricCandidates } from '../../../shared/pipelineInsightCandidates';
import type { PipelineInsightResult } from '../../../shared/pipelineInsights';
import './pipeline.css';
import { PipelineValue } from './PipelineValue';
import { reconcilePipeline } from '../../../shared/pipelineReconciliation';

const percent=(value:number|null)=>value===null?'—':value.toFixed(1)+'%';
const categoryLabel={active:'Active pipeline',under_contract:'Under contract',closed:'Closed',nurture:'Nurture',rejected:'Rejected',unmapped:'Unmapped stages'};
const localDay=(date:Date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
async function result<T>(response:Response):Promise<T>{
  const data=await response.json();
  if(!response.ok)throw Error(data.error || 'The report could not be loaded.');
  return data as T;
}
export function pipelineDateRange(period:PulsePeriod,custom:boolean,start:string,end:string,now:Date){
  if(custom){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw Error('Choose both dates.');
    const from=new Date(start+'T00:00:00'),through=new Date(end+'T00:00:00');
    through.setDate(through.getDate()+1);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(through.getTime())||from>=through||from>now||end>localDay(now))throw Error('Choose a valid range ending today or earlier.');
    return {from:from.toISOString(),through:new Date(Math.min(through.getTime(),now.getTime()+1)).toISOString()};
  }
  const cutoff=pulseCutoff(period,now);
  return {from:cutoff===null?null:new Date(cutoff).toISOString(),through:now.toISOString()};
}
export function PipelinePanel({orgId,period}:{orgId:string;period:PulsePeriod}){
  const [selectedPeriod,setSelectedPeriod]=useState<PulsePeriod>(period),[custom,setCustom]=useState(false);
  const [start,setStart]=useState(localDay(new Date(new Date().getFullYear(),new Date().getMonth(),1)));
  const [end,setEnd]=useState(localDay(new Date()));
  const [teamId,setTeamId]=useState(''),[source,setSource]=useState(''),[refresh,setRefresh]=useState(0);
  const [report,setReport]=useState<PipelineReport|null>(null),[teams,setTeams]=useState<PipelineTeam[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  const [agentKey,setAgentKey]=useState(''),[query,setQuery]=useState(''),[sort,setSort]=useState('total');
  const [proof,setProof]=useState<{title:string;keys:string[];progressKey?:string}|null>(null);
  const [insights,setInsights]=useState<PipelineInsightResult|null>(null),[aiError,setAiError]=useState(''),[aiBusy,setAiBusy]=useState(false);
  const requestVersion=useRef(0),insightVersion=useRef(0),proofRef=useRef<HTMLElement>(null),detailRef=useRef<HTMLElement>(null);
  const [mapping,setMapping]=useState<Record<string,StageMapping>>({}),[mapBusy,setMapBusy]=useState(false),[mapMessage,setMapMessage]=useState('');
  useEffect(()=>{setSelectedPeriod(period);setCustom(false);},[period]);
  const range=useMemo(()=>{
    try{return {value:pipelineDateRange(selectedPeriod,custom,start,end,new Date()),error:''};}
    catch(e){return {value:null,error:(e as Error).message};}
  },[selectedPeriod,custom,start,end,refresh]);
  const filters=useMemo<PipelineFilters|null>(()=>range.value?{
    orgId,teamId:teamId||null,...range.value,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,sources:source?[source]:[],
  }:null,[orgId,teamId,source,range]);
  useEffect(()=>{
    const version=++requestVersion.current,controller=new AbortController();
    ++insightVersion.current;setInsights(null);setAiBusy(false);setAiError('');setProof(null);setError('');setBusy(true);
    if(!filters){setBusy(false);return;}
    const load=async()=>{
      try{
        let data:PipelineReport;
        if(isDemo){data=pipelineFixture({...filters,orgId:'demo'});data.snapshotId='demo:'+JSON.stringify(filters);}
        else{
          const params=new URLSearchParams({orgId:filters.orgId,through:filters.through,timezone:filters.timezone});
          if(filters.from)params.set('from',filters.from);if(filters.teamId)params.set('teamId',filters.teamId);
          filters.sources.forEach(s=>params.append('source',s));
          data=await result<PipelineReport>(await workerFetch('/data/pipeline?'+params,{signal:controller.signal}));
        }
        if(version!==requestVersion.current)return;
        setReport(data);setTeams(old=>!filters.teamId?data.teams:old.length?old:data.teams);
        setMapping(data.teams.find(t=>t.id===filters.teamId)?.pipeline_stage_mappings || {});
        setMapMessage('');
      }catch(e){if(version===requestVersion.current){setReport(null);setError((e as Error).message);}}
      finally{if(version===requestVersion.current)setBusy(false);}
    };
    void load();
    return()=>{controller.abort();requestVersion.current++;insightVersion.current++;};
  },[filters]);
  useEffect(()=>{setAgentKey('');},[orgId,teamId]);
  const agent=report?.agents.find(a=>a.key===agentKey),selected=report?.leads.filter(l=>!agent||l.ownerKey===agent.key)||[];
  const counts=pipelineCounts(selected);
  const reconciliation=useMemo(()=>report?reconcilePipeline(report):null,[report]);
  const owners=(report?.agents || []).filter(a=>a.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):
    (b[sort as 'total'|'conversionShare'|'nurturePct'|'conversionRate']??-1)-(a[sort as 'total'|'conversionShare'|'nurturePct'|'conversionRate']??-1));
  const showLeads=(title:string,keys:string[],progressKey?:string)=>{setProof({title,keys,progressKey});setTimeout(()=>proofRef.current?.focus(),0);};
  const chooseAgent=(key:string)=>{setAgentKey(key);setProof(null);setInsights(null);setAiError('');setAiBusy(false);insightVersion.current++;
    if(key)setTimeout(()=>{detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView?.({behavior:'smooth',block:'start'});},0);
  };
  async function generate(){
    if(!report||!agent||!filters)return;
    const version=++insightVersion.current;setAiBusy(true);setAiError('');
    try{
      if(isDemo){
        setInsights({snapshotId:report.snapshotId,generatedAt:new Date().toISOString(),evidenceVersion:'demo',promptVersion:'demo',cached:false,
          insights:metricCandidates(report,agent).slice(0,3),
          coverage:'Illustrative preview only. These are sample pipeline questions, with no AI run or real conversation evidence. The signed-in version also considers published coaching findings.'});
        return;
      }
      const data=await result<PipelineInsightResult>(await workerFetch('/data/pipeline/insights',{method:'POST',body:JSON.stringify({...filters,agentKey:agent.key,snapshotId:report.snapshotId})}));
      if(version===insightVersion.current)setInsights(data);
    }catch(e){if(version===insightVersion.current)setAiError((e as Error).message);}
    finally{if(version===insightVersion.current)setAiBusy(false);}
  }
  async function saveMappings(){
    if(!report||!filters||!teamId)return;setMapBusy(true);setMapMessage('');
    try{
      const prior=report.teams.find(t=>t.id===teamId)?.pipeline_stage_mappings || {};
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(prior)));
      const mappingVersion=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
      await result(await workerFetch('/data/pipeline/mappings',{method:'PUT',body:JSON.stringify({...filters,mappings:mapping,mappingVersion})}));
      setRefresh(v=>v+1);
    }catch(e){setMapMessage((e as Error).message);}finally{setMapBusy(false);}
  }
  const countButton=(label:string,value:number,keys:string[])=><button className="pipeline-number" aria-label={label+': '+value+' leads'} onClick={()=>showLeads(label,keys)}>{value.toLocaleString()}</button>;
  return <section className="pipeline-panel" aria-label="Pipeline report">
    <header className="pipeline-intro"><div><span className="pipeline-eyebrow">The current picture</span><h2>Every lead has a place.</h2><p>See where your leads sit, who owns them, and where to focus your next coaching conversation.</p></div>
      <button className="pipeline-button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>{busy?'Updating report…':'Refresh report'}</button></header>
    {isDemo&&<p className="pipeline-notice">Demonstration · fictitious names and sample leads, using the reference report’s counts. AI readouts here are illustrative.</p>}
    <div className="pipeline-filters">
      <label>Leads received<select value={custom?'custom':String(selectedPeriod)} onChange={e=>{setCustom(e.target.value==='custom');if(e.target.value!=='custom'){const p=WINDOWS.find(w=>String(w.days)===e.target.value);setSelectedPeriod(p?.days??null);}}}>
        {WINDOWS.map(w=><option key={w.key} value={String(w.days)}>{w.label}</option>)}<option value="custom">Custom dates</option></select></label>
      {custom&&<><label>From<input type="date" value={start} max={end} onChange={e=>setStart(e.target.value)}/></label><label>Through<input type="date" value={end} min={start} max={localDay(new Date())} onChange={e=>setEnd(e.target.value)}/></label></>}
      <label>Team<select value={teamId} onChange={e=>{setTeamId(e.target.value);setSource('');}}><option value="">All available teams</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Source<select value={source} onChange={e=>setSource(e.target.value)}><option value="">All enabled sources</option>{(report?.sources || []).map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <p className="pipeline-caption">Received-date filter · current owner · {filters?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}. Stage progression retains completed steps. Current conversions = currently under contract + closed, each lead once.</p>
    {(error||range.error)&&<div role="alert" className="pipeline-notice">{error||range.error} <button onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>}
    {busy&&<div className="pipeline-loading" role="status" aria-live="polite"><span className="pipeline-spinner" aria-hidden="true"/><div><strong>Updating your pipeline</strong><p>Your filters have been received. Loading leads and their stage history…</p></div></div>}
    {!busy&&!error&&!range.error&&report&&<>
      <div className="pipeline-summary" aria-label="Team pipeline summary">
        {[{label:'Team leads',value:report.totals.total,keys:report.leads.map(l=>l.key),detail:'In the selected received-date period'},
          {label:'Current conversions',value:report.totals.conversions,keys:report.leads.filter(l=>['under_contract','closed'].includes(l.category)).map(l=>l.key),detail:percent(report.totals.conversionRate)+' of team leads'},
          {label:'Nurture',value:report.totals.nurture,keys:report.leads.filter(l=>l.category==='nurture').map(l=>l.key),detail:percent(report.totals.nurturePct)+' of team leads'},
          {label:'Rejected',value:report.totals.rejected,keys:report.leads.filter(l=>l.category==='rejected').map(l=>l.key),detail:percent(report.totals.rejectedPct)+' of team leads'}].map(c=><div key={c.label}><span>{c.label}</span>{countButton(c.label,c.value,c.keys)}<small>{c.detail}</small></div>)}
      </div>
      <div className="pipeline-health">
        <details><summary>How these counts reconcile</summary>
          <p>{reconciliation?.ok?'All report counts reconcile to their matching leads.':'Report reconciliation needs review. Refresh before relying on these counts.'}</p>
          <p>{reconciliation?.leadCount.toLocaleString()} unique leads checked across ownership, current stages and retained progression. Open any count to inspect its matching records and FUB links.</p>
          <p>This checks the report’s arithmetic and drilldowns. It does not prove that every upstream FUB update or historical event is available. Review Coverage and definitions for those gaps.</p>
          <p>Report reference: <code>{report.snapshotId}</code></p>
        </details>
        <span>Latest observation: {report.freshness.newestSync?new Date(report.freshness.newestSync).toLocaleString():'not available'}</span>
        <details><summary>Coverage and definitions</summary>
          <p>{report.coverage.undated} leads without a received date are excluded. {report.coverage.unknownStages} leads have an unmapped stage. {report.coverage.unresolvedOwners} lead owners need a refreshed FUB identity.</p>
          <p>{report.coverage.historicalOnly} leads are available only from historical records; their recorded stage is included, but their current owner and stage are unverified. They appear in a separate ownership row.</p>
          <p>Historical coverage: {report.coverage.historyState}{report.coverage.historyThrough?' · through '+report.coverage.historyThrough:''}. Oldest current observation: {report.freshness.oldestSync?new Date(report.freshness.oldestSync).toLocaleString():'not available'}. {report.freshness.unknown} leads have no observation timestamp.</p>
          <p>Stage progression includes every step through the furthest stage recorded, using the historical backfill and retained FUB changes. Leads can appear at multiple completed steps, so these percentages do not add to 100%. Rejected includes FUB’s Trash stage. Nurture and rejected show current status and never remove earlier progress. Conversion figures above describe current contracts and closings. An agent’s share always uses the whole selected team as its denominator.</p>
          <p>{report.leads.filter(l=>['nurture','rejected','unmapped'].includes(l.category)&&Object.keys(l.progress).length===1).length} leads outside the known progression have no earlier progress available in this report. Missing history is not evidence of missing work.</p>
        </details>
      </div>
      <PipelineValue report={report} agentKey={agent?.key || ''}/>
      <div className="pipeline-workspace">
        <section className="pipeline-card pipeline-roster"><div className="pipeline-card-head"><div><span className="pipeline-eyebrow">Contribution</span><h3>Your agents</h3></div><span>{report.agents.length} ownership rows</span></div>
          <div className="pipeline-table-tools"><input aria-label="Find a pipeline agent" placeholder="Find an agent…" value={query} onChange={e=>setQuery(e.target.value)}/>
            <select aria-label="Sort pipeline agents" value={sort} onChange={e=>setSort(e.target.value)}><option value="total">Most leads</option><option value="conversionShare">Conversion share</option><option value="conversionRate">Conversion rate</option><option value="nurturePct">Nurture share</option><option value="name">Name</option></select></div>
          <div className="pipeline-table-scroll"><table><thead><tr><th>Agent / owner</th><th>Leads</th><th>Team lead share</th><th>Team current conversion share</th><th>Current conversion rate</th><th>Nurture</th><th>Rejected</th></tr></thead>
            <tbody>{owners.map(a=>{const own=report.leads.filter(l=>l.ownerKey===a.key);return <tr key={a.key} aria-selected={agentKey===a.key}>
              <th scope="row"><button className="pipeline-agent" onClick={()=>chooseAgent(a.key)}>{a.name}<small>{report.teams.find(t=>t.id===a.teamId)?.name}{a.kind==='former'?' · former/excluded team member':''}</small></button></th>
              <td>{countButton(a.name+' leads',a.total,a.leadKeys)}</td><td>{percent(a.leadShare)}</td><td>{percent(a.conversionShare)}</td><td>{percent(a.conversionRate)}</td>
              <td>{countButton(a.name+' nurture',a.nurture,own.filter(l=>l.category==='nurture').map(l=>l.key))}<small>{percent(a.nurturePct)}</small></td>
              <td>{countButton(a.name+' rejected',a.rejected,own.filter(l=>l.category==='rejected').map(l=>l.key))}<small>{percent(a.rejectedPct)}</small></td>
            </tr>;})}</tbody></table></div>
          {!owners.length&&<p>No agents match this search.</p>}
        </section>
        <section ref={detailRef} tabIndex={-1} className="pipeline-card pipeline-detail" aria-label="Stage breakdown">
          <div className="pipeline-card-head"><div><span className="pipeline-eyebrow">{agent?'Agent pipeline':'Team pipeline'}</span><h3>{agent?.name || 'How far leads have progressed'}</h3></div>{agent&&<button className="pipeline-button" onClick={()=>chooseAgent('')}>Team view</button>}</div>
          <p className="pipeline-caption">{counts.total} leads · {percent(counts.conversionRate)} current conversion rate{agent?' · '+percent(agent.leadShare)+' of team leads · '+percent(agent.conversionShare)+' of team current conversions':''}</p>
          <p className="pipeline-caption">Reaching a stage includes the steps before it. Moving to Nurture or Rejected keeps that progress. Agents do not need to enter each intermediate stage. A lead can count at multiple steps.</p>
          <div className="pipeline-stage-legend"><span>Stage</span><span>{agent?'Agent / team':'Team'} share</span></div>
          <div className="pipeline-stage-group"><h4>Stage progression</h4>{report.progression.map(s=>{
            const keys=selected.filter(l=>!!l.progress[s.key]).map(l=>l.key),share=counts.total?keys.length/counts.total*100:0;
            return <button className="pipeline-stage" key={s.key} onClick={()=>showLeads((agent?agent.name+' · ':'')+s.label,keys,s.key)} aria-label={s.label+': '+keys.length+' leads'}>
              <span className="pipeline-stage-label">{s.label}</span><span className="pipeline-track" aria-hidden><i style={{width:share+'%'}}/>{agent&&<b style={{left:(s.percent||0)+'%'}}/>}</span>
              <span><strong>{keys.length}</strong> · {percent(counts.total?share:null)}{agent&&<small>team {percent(s.percent)} ({s.count})</small>}</span>
            </button>;
          })}</div>
          <div className="pipeline-stage-group"><h4>Outside the active pipeline · current status</h4>{(['nurture','rejected'] as const).map(category=>{
            const keys=selected.filter(l=>l.category===category).map(l=>l.key),share=counts.total?keys.length/counts.total*100:0;
            const teamCount=report.leads.filter(l=>l.category===category).length;
            return <button className="pipeline-stage" key={category} onClick={()=>showLeads(categoryLabel[category],keys)} aria-label={categoryLabel[category]+': '+keys.length+' leads'}>
              <span className="pipeline-stage-label">{categoryLabel[category]}</span><span className="pipeline-track" aria-hidden><i style={{width:share+'%'}}/></span>
              <span><strong>{keys.length}</strong> · {percent(counts.total?share:null)}{agent&&<small>team {percent(report.totals.total?teamCount/report.totals.total*100:null)} ({teamCount})</small>}</span>
            </button>;
          })}</div>
          <details><summary>Current FUB stages · {report.coverage.unknownStages} unmapped leads</summary>
          {PIPELINE_CATEGORIES.map(category=>{
            const stages=report.stages.filter(s=>s.category===category);if(!stages.length)return null;
            return <div className="pipeline-stage-group" key={category}><h4>{category==='nurture'?'Outside the active pipeline · Nurture':category==='rejected'?'Outside the active pipeline · Rejected':categoryLabel[category]}</h4>
              {stages.map(s=>{const keys=selected.filter(l=>l.stageKey===s.key).map(l=>l.key),share=counts.total?keys.length/counts.total*100:0;return <button className="pipeline-stage" key={s.key} onClick={()=>showLeads((agent?agent.name+' · ':'')+s.rawName,keys)} aria-label={'Current '+s.rawName+': '+keys.length+' leads'}>
                <span className="pipeline-stage-label">{s.rawName}{report.teams.length>1&&<small>{report.teams.find(t=>t.id===s.teamId)?.name}</small>}</span>
                <span className="pipeline-track" aria-hidden><i style={{width:share+'%'}}/>{agent&&<b style={{left:(s.percent||0)+'%'}}/>}</span>
                <span><strong>{keys.length}</strong> · {percent(counts.total?share:null)}{agent&&<small>team {percent(s.percent)} ({s.count})</small>}</span>
              </button>;})}</div>;
          })}
          </details>
          {!counts.total&&<p>No leads in this selection. Try another period or source.</p>}
          {agent&&<div className="pipeline-agent-actions"><button className="pipeline-button pipeline-primary" disabled={aiBusy||!agent.agentId||agent.kind!=='agent'||!agent.total||!report.insightsEnabled} onClick={()=>void generate()}>{aiBusy?'Preparing insights…':'AI insights'}</button>
            {agent.agentId&&<a href={'#/coach/'+encodeURIComponent(agent.agentId)}>Open Coach ↗</a>}
            {!report.insightsEnabled&&<small>AI insights will be available after release validation.</small>}
            {(agent.kind==='unresolved'||agent.kind==='historical')&&<small>Coaching requires a verified current agent identity.</small>}
          </div>}
          {aiError&&<p className="pipeline-notice" role="alert">{aiError}</p>}
          {insights&&<div className="pipeline-insights" aria-label="AI coaching insights"><p className="pipeline-caption">{insights.coverage} Prepared {new Date(insights.generatedAt).toLocaleString()}.</p>
            {insights.insights.map((insight,i)=><article key={insight.id}><span className="pipeline-eyebrow">Focus {i+1} · {insight.kind==='metric'?'Pipeline observation':'Published coaching evidence'}</span><h4>{insight.title}</h4><p>{insight.observation}</p><p>{insight.interpretation}</p><div className="pipeline-coach-action"><strong>How to coach</strong><p>{insight.action}</p></div>
              <details><summary>View evidence</summary>{insight.metric&&<p>{insight.metric.label}: {insight.metric.numerator} / {insight.metric.denominator}. Uses the report’s selected filters and current owner.</p>}
                {insight.evidence.map(e=><blockquote key={e.id}><p>“{e.quote}”</p><footer>{e.lead} · {e.occurredAt || e.period}{e.url&&<> · <a href={e.url} target="_blank" rel="noreferrer">Open FUB record ↗</a></>}</footer></blockquote>)}
              </details></article>)}</div>}
        </section>
      </div>
      {proof&&<section ref={proofRef} tabIndex={-1} className="pipeline-card pipeline-proof" aria-label="Matching leads"><div className="pipeline-card-head"><div><h3>{proof.title}</h3><p>{proof.keys.length} matching leads</p></div><button className="pipeline-button" onClick={()=>setProof(null)}>Close lead list</button></div>
        <ul>{report.leads.filter(l=>proof.keys.includes(l.key)).map(l=><li key={l.key}><span>{l.fubUrl?<a href={l.fubUrl} target="_blank" rel="noreferrer">{l.name || 'Unnamed lead'} ↗</a>:l.name || 'Unnamed lead'}<small>{l.stage || 'No stage'} · {l.source_family} · received {new Date(l.fub_created!).toLocaleDateString()}{l.historicalOnly?' · historical only':''}</small>{proof.progressKey&&l.progress[proof.progressKey]&&<small>Progress includes {l.progress[proof.progressKey].basis} · {l.progress[proof.progressKey].source}{l.progress[proof.progressKey].at?' · basis recorded '+new Date(l.progress[proof.progressKey].at!).toLocaleDateString():''}</small>}</span><span>{l.assigned_to || l.pond || 'Unassigned'}</span></li>)}</ul>
        {!proof.keys.length&&<p>No leads match this count.</p>}
      </section>}
      {report.canMapStages&&<details className="pipeline-card pipeline-mappings"><summary>Stage reporting settings</summary><p>Map your team’s FUB stages into reporting categories. Raw FUB names stay visible and are never changed in Follow Up Boss.</p>
        {!teamId?<p>Select one team above to edit its mappings.</p>:<><div className="pipeline-mapping-grid">{report.stages.map(s=>{const record=report.leads.find(l=>l.stageKey===s.key)!;const key=stageKey(record);return <label key={s.key}>{s.rawName}<select value={mapping[key]?.category || s.category} onChange={e=>setMapping(old=>({...old,[key]:{category:e.target.value as StageMapping['category'],order:PIPELINE_CATEGORIES.indexOf(e.target.value as StageMapping['category'])*20}}))}>{PIPELINE_CATEGORIES.map(c=><option key={c} value={c}>{categoryLabel[c]}</option>)}</select></label>;})}</div><button className="pipeline-button" disabled={mapBusy} onClick={()=>void saveMappings()}>{mapBusy?'Saving…':'Save reporting mappings'}</button>{mapMessage&&<p role="alert">{mapMessage}</p>}</>}
      </details>}
    </>}
  </section>;
}
