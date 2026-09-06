import { useState } from 'react';
import type { LeadRow } from '../lib/api';
import type { Row, RosterState } from '../lib/rosterData';
import { isClosing, isOfferPlus, stageClass } from '../../../shared/flags';

export function PulseProof({ row, leads, teams }: { row: Row; leads: LeadRow[]; teams: RosterState['teams'] }) {
  const [filter, setFilter] = useState('all');
  const shown = leads.filter(l => filter === 'all' || (filter === 'contracts' ? isClosing(stageClass(l.stage)) : isOfferPlus(stageClass(l.stage))));
  return <details className="pulse-proof" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <summary>Proof · {leads.length} {leads.length === 1 ? 'lead' : 'leads'}</summary>
    <div className="pulse-proof-body">
      <p><strong>{row.leads} leads ÷ {row.contracts} contracts</strong>{row.perContract !== null ? ` = ${row.perContract.toFixed(2)} leads per contract.` : ' · No ratio established.'}</p>
      <p>Created in the selected period, grouped by current owner. Current stages count toward offers/contracts, including later stages. These are not dated assignment or closing totals.</p>
      
      <label>Show evidence<select aria-label={'Evidence for '+row.name} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All leads</option><option value="offers">Offer numerator</option><option value="contracts">Contract numerator</option></select></label>
      <div className="pulse-proof-list">{shown.length === 0 ? <p>No matching records.</p> : shown.map((lead, i) => {
        const domain = teams.find(t => t.id === lead.team_id)?.fub_subdomain;
        const href = domain && /^[a-z0-9-]+$/i.test(domain) && lead.fub_person_id ? `https://${domain}.followupboss.com/2/people/view/${lead.fub_person_id}` : null;
        return <div key={`${lead.team_id}:${lead.fub_person_id ?? i}`} className="pulse-proof-lead">
          {href ? <a href={href} target="_blank" rel="noreferrer">{lead.name || 'Unnamed lead'} ↗</a> : <strong>{lead.name || 'Unnamed lead'}</strong>}
          <span>FUB #{lead.fub_person_id ?? 'ID unavailable'} · {lead.source_family || 'Source unavailable'}</span>
          <span>Created {lead.fub_created ? new Date(lead.fub_created).toLocaleString() : 'date unavailable'}</span>
          <span>Stage: {lead.stage || 'Unavailable'}</span>
          {!href && <span>Direct source link unavailable</span>}
        </div>;
      })}</div>
    </div>
  </details>;
}
