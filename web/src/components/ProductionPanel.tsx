import { useEffect, useState } from 'react';
import { loadDashboard, type DashboardData } from '../lib/api';
import { productionEvidence } from '../lib/productionEvidence';
import type { PulsePeriod } from '../lib/pulsePeriod';
export function ProductionPanel({period}:{period:PulsePeriod}) {
  const [data,setData]=useState<DashboardData|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;loadDashboard().then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError('Production history could not be loaded.');});return()=>{active=false;};},[]);
  if(error)return <p role="alert">{error}</p>;
  if(!data)return <p>Loading recorded production…</p>;
  const result=productionEvidence(data.stageLog??[],period);
  return <section className="production-panel"><h2>Recorded production</h2><p>Milestones dated in this period, including leads created earlier. Counts reflect available history; missing history is not zero production. First-observed dates may differ from the actual transaction date.</p>
    <div className="pulse-summary">{(['offer','uc','closed'] as const).map(k=><div key={k}><span>{k==='uc'?'Under-contract records':k==='closed'?'Closed records':'Offer records'}</span><strong>{data.stageLog?.length ? result.counts[k] : '—'}</strong><small>Direct milestone records</small></div>)}</div>
    <p>{result.excluded} records lack a usable date or team identity, or are undated seeds. Offers and contracts are counted separately; later stages do not invent missing earlier milestones.</p>
    <div className="operations-table"><table><thead><tr><th>Agent at milestone</th><th>Lead</th><th>Milestone</th><th>Recorded date</th><th>Date source</th></tr></thead><tbody>{result.records.map(h=><tr key={`${h.team_id}:${h.fub_person_id}:${h.stage_class}`}><td>{h.agent_name||'Unresolved agent'}</td><td>{data.leads.find(l=>l.team_id===h.team_id&&l.fub_person_id===h.fub_person_id)?.name||`FUB #${h.fub_person_id}`}</td><td>{h.stage_class==='uc'?'Under contract':h.stage_class}</td><td>{new Date(h.changed_at!).toLocaleString()}</td><td>{h.date_source==='live'?'First observed':h.date_source||'Unspecified'}</td></tr>)}</tbody></table></div>{!result.records.length&&<p>No usable milestone records in this period.</p>}
  </section>;
}
