import { useEffect, useState } from 'react';
import { loadDashboard, type DashboardData } from '../lib/api';
import { productionEvidence } from '../lib/productionEvidence';
import type { PulsePeriod } from '../lib/pulsePeriod';
export function ProductionPanel({period,orgId}:{period:PulsePeriod;orgId?:string}) {
  const [data,setData]=useState<DashboardData|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;setData(null);setError('');loadDashboard(orgId).then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError('Production history could not be loaded.');});return()=>{active=false;};},[orgId]);
  if(error)return <p role="alert">{error}</p>;
  if(!data)return <p>Loading recorded production…</p>;
  const result=productionEvidence(data.stageLog??[],period);
  return <section className="production-panel"><h2>Recorded production</h2><p>Milestones dated in this period, including leads created earlier. Counts reflect available history; missing history is not zero production. Dates come from the available records, not a separate confirmation of when a transaction happened.</p>
    <div className="pulse-summary">{(['offer','uc','closed'] as const).map(k=><div key={k}><span>{k==='uc'?'Under-contract records':k==='closed'?'Closed records':'Offer records'}</span><strong>{data.stageLog?.length ? result.counts[k] : '—'}</strong><small>Each lead counted once per stage</small></div>)}</div>
    <p>{result.excluded} records were left out because their date or team could not be confirmed. If a lead skipped an earlier stage, we count that step on the date it reached the later stage. The table shows how each date was established.</p>
    <div className="operations-table"><table><thead><tr><th>Current owner at collection</th><th>Lead</th><th>Milestone</th><th>Recorded date</th><th>Date source</th></tr></thead><tbody>{result.records.map(h=><tr key={`${h.team_id}:${h.fub_person_id}:${h.stage_class}`}><td>{h.agent_name||'Unresolved agent'}</td><td>{data.leads.find(l=>l.team_id===h.team_id&&l.fub_person_id===h.fub_person_id)?.name||`FUB #${h.fub_person_id}`}</td><td>{h.stage_class==='uc'?'Under contract':h.stage_class==='closed'?'Sale closed':'Offers'}</td><td>{new Date(h.changed_at!).toLocaleString()}</td><td>{({live:'First recorded by TRU',fub_change_log:'Follow Up Boss change log',cumulative_rule:'Counted from a later stage',deal_close_date:'Closing date on the deal',tableau:'Zillow report'} as Record<string,string>)[h.date_source??'']??'Date source not specified'}</td></tr>)}</tbody></table></div>{!result.records.length&&<p>No usable milestone records in this period.</p>}
  </section>;
}
