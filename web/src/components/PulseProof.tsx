import { hasContractMilestone } from '../lib/conversionMilestones';
import { useState } from 'react';
import type { LeadRow } from '../lib/api';
import type { Row, RosterState } from '../lib/rosterData';
import { isOfferPlus, stageClass } from '../../../shared/flags';

export function PulseProof({ row, leads, teams }: { row: Row; leads: LeadRow[]; teams: RosterState['teams'] }) {
  const [filter, setFilter] = useState('all');
  const shown = leads.filter(l => filter === 'all' || (filter === 'contracts' ? hasContractMilestone(l) : filter === 'closed' ? (l.history?!!l.history.closed:stageClass(l.stage)==='closed') : l.history?!!l.history.offer:isOfferPlus(stageClass(l.stage))));
  return <details className="pulse-proof" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <summary>Proof · {leads.length} {leads.length === 1 ? 'lead' : 'leads'}</summary>
    <div className="pulse-proof-body">
      <p><strong>{row.leads} leads ÷ {row.contracts} contracts</strong>{row.perContract !== null ? ` = ${row.perContract.toFixed(2)} leads per contract. The displayed ratio rounds down to 1 in ${Math.floor(row.perContract)}.` : ' · No ratio established.'}</p>
      <p>Raw conversion counts leads that reached under contract or closed, once per lead. Closed leads remain included in the Under contract milestone. We count leads created during your selected dates and group them by their assigned agent when the data was collected. {leads.some(l=>l.history)?'The Follow Up Boss change log tells us which stages each lead reached, even if it later returned to Nurture. When a lead skips a stage, a later stage also counts toward the earlier steps—for example, under contract also counts as met with and offers.':'We use each lead’s current stage. Later stages also count toward offers and contracts.'} These totals describe this group of leads, not the number of assignments or closings that happened during those dates.</p>
      {leads.some(l=>l.history)&&<p>Met with: {row.met??0} · Closed: {row.closed??0} · Raw conversion: {(row.rawConversion??0).toFixed(2)}% ({row.contracts} ÷ {row.leads}; under contract or closed, each lead counted once) · Currently in Nurture: {row.nurture??0} ({row.leads?((row.nurture??0)/row.leads*100).toFixed(1):'0'}%).</p>}
      
      <label>Show leads<select aria-label={'Evidence for '+row.name} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All counted leads</option><option value="offers">Counted toward offers</option><option value="contracts">Reached under contract or closed</option><option value="closed">Closed leads</option></select></label>
      <div className="pulse-proof-list">{shown.length === 0 ? <p>No matching records.</p> : shown.map((lead, i) => {
        const domain = teams.find(t => t.id === lead.team_id)?.fub_subdomain;
        const href = domain && /^[a-z0-9-]+$/i.test(domain) && lead.fub_person_id ? `https://${domain}.followupboss.com/2/people/view/${lead.fub_person_id}` : null;
        return <div key={`${lead.team_id}:${lead.fub_person_id ?? i}`} className="pulse-proof-lead">
          {href ? <a href={href} target="_blank" rel="noreferrer">{lead.name || 'Unnamed lead'} ↗</a> : <strong>{lead.name || 'Unnamed lead'}</strong>}
          <span>FUB #{lead.fub_person_id ?? 'ID unavailable'} · {lead.source_family || 'Source unavailable'}</span>
          <span>Created {lead.fub_created ? new Date(lead.fub_created).toLocaleString() : 'date unavailable'}</span>
          <span>Stage when collected: {lead.stage || 'Unavailable'}</span>
          {lead.history&&<details><summary>How this lead was counted</summary>{Object.entries(lead.history).filter(([,p])=>p).map(([category,p])=><p key={category}><strong>{({uc:'Under contract',met:'Met with',offer:'Offers',closed:'Sale closed',nurture:'Nurture'} as Record<string,string>)[category]??category}</strong> · {p!.kind==='observed'?'Recorded in the change log':'Counted because a later stage was reached'} · {p!.description} · {new Date(p!.date).toLocaleString()} · Change log entry #{p!.eventId}{p!.direction==='from'?' · This entry shows the lead leaving this stage; it does not tell us when the lead entered it.':''}</p>)}</details>}
          {!href && <span>Direct source link unavailable</span>}
        </div>;
      })}</div>
    </div>
  </details>;
}
