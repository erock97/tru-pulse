import { contractRateLabel } from '../lib/minimumExpectation';
import type { PulsePeriod } from '../lib/pulsePeriod';
import type { LeadRow, DashboardData } from '../lib/api';
import { conversionTrend, type ConversionCounts } from '../lib/conversionTrend';
import './conversionComparison.css';

export function ConversionComparison({current,period,through,leads,history}:{current:ConversionCounts;period:PulsePeriod;through?:string;leads?:LeadRow[];history?:DashboardData['historyInfo']}) {
  const trend=conversionTrend(leads,current,period,history);
  const date=trend.cutoff===null?null:new Date(trend.cutoff).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return <div className="conversion-comparison">
    <strong>{contractRateLabel(current.perContract,current.leads)}</strong>
    <small>Latest overall{through?` · through ${through}`:''}</small>
    <small>{date?`Compared with ${date}`:'No comparison date selected'}</small>
    <details><summary>{trend.direction?`${trend.direction} · Was ${contractRateLabel(trend.prior!.perContract,trend.prior!.leads)}`:trend.prior?'No earlier leads':'Historical comparison unavailable'}</summary>
      <p>{date?`Compare with ${date}. `:''}{trend.prior?`${trend.prior.contracts} contracts from ${trend.prior.leads} leads at that date. `:''}{trend.reason}</p>
      <p>Now: {current.contracts} contracts from {current.leads} leads across available history. Each converted lead counts once. Leads created later and milestones recorded later are excluded from the earlier count.</p>
      <p>Both counts use the agents currently assigned to these leads, matching Pulse. This compares their current book of leads over time; it does not reconstruct past reassignments. A closing also proves a contract, credited by its recorded milestone date.</p>
    </details>
  </div>;
}
