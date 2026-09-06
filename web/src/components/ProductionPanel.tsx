import { useEffect, useState } from 'react';
import { loadDashboard, type DashboardData, type StageLogRow } from '../lib/api';
import { productionEvidence } from '../lib/productionEvidence';
import type { PulsePeriod } from '../lib/pulsePeriod';
export function ProductionPanel({period,orgId}:{period:PulsePeriod;orgId?:string}) {
  const [data,setData] = useState<DashboardData|null>(null), [error,setError] = useState('');
  useEffect(()=>{let active=true;setData(null);setError('');loadDashboard(orgId).then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError('Production history could not be loaded.');});return()=>{active=false;};},[orgId]);
  if(error)return <p role="alert">{error}</p>;
  if(!data)return <p>Loading recorded production…</p>;
  const result=productionEvidence(data.stageLog??[],period);
  const groups=new Map<string,{name:string;leads:Map<string,StageLogRow[]>}>();
  for(const h of result.records){const key=`${h.team_id}:${h.agent_user_id??h.agent_name??'unknown'}`,g=groups.get(key)??{name:h.agent_name||'Unresolved agent',leads:new Map<string,StageLogRow[]>()};const leadKey=`${h.team_id}:${h.fub_person_id}`,rows=g.leads.get(leadKey)??[];rows.push(h);g.leads.set(leadKey,rows);groups.set(key,g);}
  const labels:Record<string,string>={offer:'Offers',uc:'Under contract',closed:'Sale closed'};
  const sources:Record<string,string>={live:'First recorded by TRU',fub_change_log:'Follow Up Boss change log',cumulative_rule:'Counted from a later stage',deal_close_date:'Closing date on the deal',tableau:'Zillow report'};
  return <section className="production-panel"><h2>Recorded production</h2><p>Milestones dated in this period, including leads created earlier. Open an agent to see each contact once, with its milestones together.</p>
    <div className="pulse-summary">{(['offer','uc','closed'] as const).map(k=><div key={k}><span>{labels[k]}</span><strong>{data.stageLog?.length ? result.counts[k] : '—'}</strong><small>Each lead counted once per stage</small></div>)}</div>
    <p>{result.excluded} records excluded because their date or team could not be confirmed. Skipped earlier stages are credited on the date of the later stage. Agent grouping reflects ownership recorded with the evidence.</p>
    {[...groups].sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([key,g])=><details className="contact-agent" key={key}><summary><strong>{g.name}</strong><span>{g.leads.size} contacts</span></summary><div className="operations-table"><table><thead><tr><th>Contact</th><th>Milestones and proof</th></tr></thead><tbody>{[...g.leads].map(([id,hits])=>{const h=hits[0],lead=data.leads.find(l=>l.team_id===h.team_id&&l.fub_person_id===h.fub_person_id),domain=data.teams.find(t=>t.id===h.team_id)?.fub_subdomain;const url=domain&&/^[a-z0-9-]+$/.test(domain)?`https://${domain}.followupboss.com/2/people/view/${h.fub_person_id}`:null;return <tr key={id}><td>{url?<a href={url} target="_blank" rel="noopener noreferrer">{lead?.name||`FUB #${h.fub_person_id}`} ↗</a>:lead?.name||`FUB #${h.fub_person_id}`}</td><td>{hits.map(hit=><p key={hit.stage_class}><strong>{labels[hit.stage_class!]}</strong> · {new Date(hit.changed_at!).toLocaleString()}<br/><small>{sources[hit.date_source??'']||'Date source not specified'}</small></p>)}</td></tr>;})}</tbody></table></div></details>)}
    {!result.records.length&&<p>No usable milestone records in this period.</p>}
  </section>;
}
